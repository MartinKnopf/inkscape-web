// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/pencil-tool.cpp, src/ui/tools/pencil-tool.h
/*
 * Pencil event context implementation.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2000 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2002 Lauris Kaplinski
 * Copyright (C) 2004 Monash University
 */
import {
  get_last_segment,
  Preferences,
  path_from_curve,
  pathvector_append_continuous,
} from '@inkscape-web/core';
import {
  BezierCurve,
  bezier_fit_cubic_full,
  bezier_fit_cubic_r,
  CubicBezier,
  type Curve,
  LineSegment,
  Path,
  Point,
  unit_vector,
} from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { SPDrawAnchor } from '../draw-anchor.ts';
import {
  FreehandBase,
  set_pathvector,
  spdc_concat_colors_and_flush,
  spdc_create_single_dot,
  spdc_endpoint_snap_free,
  spdc_endpoint_snap_rotation,
  spdc_test_inside,
} from './freehand-base.ts';
import {
  type ModifierState,
  mod_ctrl,
  mod_ctrl_only,
  mod_freehand_angle_snapping,
  mod_select_add_to,
} from './tool-base.ts';

export enum PencilState {
  SP_PENCIL_CONTEXT_IDLE,
  SP_PENCIL_CONTEXT_ADDLINE,
  SP_PENCIL_CONTEXT_FREEHAND,
  SP_PENCIL_CONTEXT_SKETCH,
}

// Modifiers from share/keys/inkscape.xml (upstream Modifiers::Modifier).
/** freehand-dot: Ctrl */
const mod_freehand_dot = (s: ModifierState): boolean => mod_ctrl(s);
/** move-snapping ("No Move Snapping"): no modifier in share/keys/inkscape.xml. */
const mod_move_no_snapping = (_s: ModifierState): boolean => false;

const in_svg_plane = (p: Point): boolean => Math.max(Math.abs(p.x), Math.abs(p.y)) < 1e18;

/**
 * The pencil (freehand) tool (upstream PencilTool). A drag draws a freehand
 * path: the points are fitted with cubic Beziers while drawing and fitted
 * again at the release with the smoothing of /tools/freehand/pencil/tolerance.
 * A click starts a straight line, a second click ends it. Ctrl+click makes a
 * dot; Ctrl snaps the angle of straight lines. Esc cancels. A path started or
 * ended at an end anchor of the selected path continues that path.
 * TODO: pressure (power pencil), sketch mode (Alt), the spiro and bspline
 * modes, simplify and shape LPEs, snapping, status bar messages, cursor.
 */
export class PencilTool extends FreehandBase {
  p_array: Point[] = Array.from({ length: 16 }, () => new Point(0, 0));
  ps: Point[] = [];
  sketch_n = 0; // number of sketches done

  _req_tangent = new Point(0, 0);
  _is_drawing = false;
  _state = PencilState.SP_PENCIL_CONTEXT_IDLE;
  _npoints = 0;

  pencil_drag_origin_w = new Point(0, 0);
  pencil_within_tolerance = false;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/freehand/pencil');
    if (Preferences.get().getBool('/tools/freehand/pencil/selcue')) this.enableSelectionCue();
  }

  /** Snaps new node relative to the previous node. */
  _endpointSnap(p: Point, state: ModifierState): Point {
    if (mod_freehand_angle_snapping(state)) {
      // constrained snapping (default: Ctrl)
      if (this._npoints > 0) return spdc_endpoint_snap_rotation(this, p, this.p_array[0] as Point, state);
      return p;
    }
    // "no snapping" (default: Shift) disables all snapping, except the angular snapping above.
    // After all, the user explicitly asked for angular snapping by pressing Ctrl.
    if (!mod_move_no_snapping(state)) {
      return spdc_endpoint_snap_free(this, p, this._npoints > 0 ? (this.p_array[0] as Point) : null);
    }
    return p;
  }

  /** Callback for handling all pencil context events. */
  override root_handler(event: Event): boolean {
    let ret = false;
    switch (event.type) {
      case 'pointerdown':
        ret = this._handleButtonPress(event as PointerEvent);
        break;
      case 'pointermove':
        ret = this._handleMotionNotify(event as PointerEvent);
        break;
      case 'pointerup':
        ret = this._handleButtonRelease(event as PointerEvent);
        break;
      case 'keydown':
        ret = this._handleKeyPress(event as KeyboardEvent);
        // Keep the window shortcuts (doc.undo, ...) from handling the key.
        if (ret) event.preventDefault();
        break;
    }
    return ret || super.root_handler(event);
  }

  _handleButtonPress(event: PointerEvent): boolean {
    let ret = false;
    if (event.button === 0 && this._numPress(event) === 1) {
      if (!have_viable_layer(this._desktop)) return true;

      /* Grab mouse, so release will not pass unnoticed */
      this.grabCanvasEvents(event);

      /* Find desktop coordinates */
      let p = this._eventDesktopPoint(event);

      /* Test whether we hit any anchor. */
      const anchor = spdc_test_inside(this, this._worldPoint(event));
      this.pencil_drag_origin_w = this._windowPoint(event);
      this.pencil_within_tolerance = true;

      switch (this._state) {
        case PencilState.SP_PENCIL_CONTEXT_ADDLINE:
          /* Current segment will be finished with release */
          ret = true;
          break;
        default:
          /* Set first point of sequence */
          if (mod_freehand_dot(event)) {
            // TODO: snap the dot.
            spdc_create_single_dot(this, p, '/tools/freehand/pencil', event);
            ret = true;
            break;
          }
          if (anchor) {
            p = anchor.dp;
            //Put the start overwrite curve always on the same direction
            this.sa_overwrited = anchor.start
              ? anchor.curve.map((c) => c.reversed()).reverse()
              : anchor.curve.map((c) => c.clone());
            // TODO: flash _("Continuing selected path") in the message stack.
          } else if (!mod_select_add_to(event)) {
            // This is the first click of a new curve; deselect item so that
            // this curve is not combined with it (unless it is drawn from its
            // anchor, which is handled by the sibling branch above)
            this.selection.clear();
          }
          this.sa = anchor;
          this._setStartpoint(p);
          ret = true;
          break;
      }

      this._is_drawing = true;
    }
    return ret;
  }

  _handleMotionNotify(event: PointerEvent): boolean {
    if (mod_freehand_dot(event) && event.buttons & 1) {
      // mouse was accidentally moved during Ctrl+click;
      // ignore the motion and create a single point
      this._is_drawing = false;
      return true;
    }

    if (event.buttons & 4) {
      // allow scrolling
      return false;
    }

    /* Find desktop coordinates */
    let p = this._eventDesktopPoint(event);

    const w = this._windowPoint(event);
    if (this.pencil_within_tolerance) {
      const tolerance = Math.min(
        Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0),
        100,
      );
      const d = w.sub(this.pencil_drag_origin_w);
      if (Math.max(Math.abs(d.x), Math.abs(d.y)) < tolerance) {
        return false; // Do not drag if we're within tolerance from origin.
      }
    }

    // Once the user has moved farther than tolerance from the original location
    // (indicating they intend to move the object, not click), then always process the
    // motion notify coordinates as given (no snapping back to origin)
    this.pencil_within_tolerance = false;

    const anchor = spdc_test_inside(this, this._worldPoint(event));

    let ret = false;

    switch (this._state) {
      case PencilState.SP_PENCIL_CONTEXT_ADDLINE:
        /* Set red endpoint */
        p = anchor ? anchor.dp : this._endpointSnap(p, event);
        this._setEndpoint(p);
        ret = true;
        break;
      default:
        /* We may be idle or already freehand */
        if (event.buttons & 1 && this._is_drawing) {
          this._state = PencilState.SP_PENCIL_CONTEXT_FREEHAND;

          if (!this.sa && !this.green_anchor) {
            /* Create green anchor */
            this.green_anchor = new SPDrawAnchor(this, this.green_curve, true, this.p_array[0] as Point);
          }
          if (anchor) p = anchor.dp;
          if (this._npoints !== 0) {
            // buttonpress may have happened before we entered draw context!
            if (this.ps.length === 0) {
              // Only in freehand mode we have to add the first point also to ps (apparently)
              // - We cannot add this point in spdc_set_startpoint, because we only need it for freehand
              // - We cannot do this in the button press handler because at that point we don't know yet
              //   whether we're going into freehand mode or not
              this.ps.push(this.p_array[0] as Point);
            }
            // The motion history (upstream event.history).
            for (const hist of event.getCoalescedEvents?.().slice(0, -1) ?? []) {
              this._addFreehandPoint(this._eventDesktopPoint(hist), event, false);
            }
            this._addFreehandPoint(p, event, false);
            ret = true;
          }
          if (anchor && !this.anchor_statusbar) {
            // TODO: _("<b>Release</b> here to close and finish the path.") in the message context.
            this.anchor_statusbar = true;
            this.ea = anchor;
          } else if (!anchor) {
            this.anchor_statusbar = false;
            this.ea = null;
          }
        } else {
          this.anchor_statusbar = !!anchor;
        }
        break;
    }
    return ret;
  }

  _handleButtonRelease(event: PointerEvent): boolean {
    let ret = false;

    if (event.button === 0 && this._is_drawing) {
      this._is_drawing = false;

      /* Find desktop coordinates */
      let p = this._eventDesktopPoint(event);

      /* Test whether we hit any anchor. */
      const anchor = spdc_test_inside(this, this._worldPoint(event));

      switch (this._state) {
        case PencilState.SP_PENCIL_CONTEXT_IDLE:
          /* Releasing button in idle mode means single click */
          /* We have already set up start point/anchor in button_press */
          if (!mod_freehand_dot(event)) {
            // Ctrl+click creates a single point so only set context in ADDLINE mode when Ctrl isn't pressed
            this._state = PencilState.SP_PENCIL_CONTEXT_ADDLINE;
          }
          break;
        case PencilState.SP_PENCIL_CONTEXT_ADDLINE:
          /* Finish segment now */
          p = anchor ? anchor.dp : this._endpointSnap(p, event);
          this.ea = anchor;
          this._setEndpoint(p);
          this._finishEndpoint();
          this._state = PencilState.SP_PENCIL_CONTEXT_IDLE;
          break;
        case PencilState.SP_PENCIL_CONTEXT_FREEHAND: {
          // TODO: sketch mode (pencil-sketch, Alt): _sketchInterpolate().
          /* Finish segment now */
          /// \todo fixme: Clean up what follows (Lauris)
          if (anchor) {
            p = anchor.dp;
          } else {
            const p_end = this._endpointSnap(p, event);
            if (!p_end.equals(p)) {
              // then we must have snapped!
              this._addFreehandPoint(p_end, event, true);
            }
          }

          this.ea = anchor;
          /* Write curves to object */
          // TODO: flash _("Finishing freehand") in the message stack.
          this._interpolate();
          spdc_concat_colors_and_flush(this, false);
          this.sa = null;
          this.ea = null;
          this.ps = [];
          this.green_anchor?.destroy();
          this.green_anchor = null;
          this._state = PencilState.SP_PENCIL_CONTEXT_IDLE;
          // reset sketch mode too
          this.sketch_n = 0;
          break;
        }
        default:
          break;
      }

      this.ungrabCanvasEvents(event);

      ret = true;
    }
    return ret;
  }

  _cancel(): void {
    this.ungrabCanvasEvents();

    this._is_drawing = false;
    this._state = PencilState.SP_PENCIL_CONTEXT_IDLE;

    this.red_curve = [];
    this.red_bpath.set_bpath([]);

    for (const b of this.green_bpaths) b.unlink();
    this.green_bpaths = [];
    this.green_curve.length = 0;
    this.green_anchor?.destroy();
    this.green_anchor = null;

    // TODO: flash _("Drawing cancelled") in the message context.
  }

  _handleKeyPress(event: KeyboardEvent): boolean {
    let ret = false;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        // Prevent the zoom field from activation.
        if (!mod_ctrl_only(event)) ret = true;
        break;
      case 'Escape':
        if (this._npoints !== 0) {
          // if drawing, cancel, otherwise pass it up for deselecting
          if (this._state !== PencilState.SP_PENCIL_CONTEXT_IDLE) {
            this._cancel();
            ret = true;
          }
        }
        break;
      case 'z':
      case 'Z':
        if (mod_ctrl_only(event) && this._npoints !== 0) {
          // if drawing, cancel, otherwise pass it up for undo
          if (this._state !== PencilState.SP_PENCIL_CONTEXT_IDLE) {
            this._cancel();
            ret = true;
          }
        }
        break;
      // TODO: Shift+G (to guides).
      default:
        break;
    }
    return ret;
  }

  /** Reset points and set new starting point. */
  _setStartpoint(p: Point): void {
    this._npoints = 0;
    this.red_curve_is_valid = false;
    if (in_svg_plane(p)) this.p_array[this._npoints++] = p;
  }

  /**
   * Change moving endpoint position.
   * Ctrl constrains to moving to H/V direction, snapping in given direction.
   * Otherwise we snap freely to whatever attractors are available.
   *
   * Number of points is (re)set to 2 always, 2nd point is modified.
   * We change RED curve.
   */
  _setEndpoint(p: Point): void {
    if (this._npoints === 0) {
      return;
      /* May occur if first point wasn't in SVG plane (e.g. weird w2d transform, perhaps from bad
       * zoom setting).
       */
    }

    this.red_curve = [];
    const p0 = this.p_array[0] as Point;
    if (p.equals(p0) || !in_svg_plane(p)) {
      this._npoints = 1;
    } else {
      this.p_array[1] = p;
      this._npoints = 2;

      this.red_curve = [path_from_curve(new LineSegment(p0, p))];
      this.red_curve_is_valid = true;
      this.red_bpath.set_bpath(this.red_curve);
    }
  }

  /**
   * Finalize addline.
   *
   * \todo
   * fixme: I'd like remove red reset from concat colors (lauris).
   * Still not sure, how it will make most sense.
   */
  _finishEndpoint(): void {
    const first = this.red_curve[0];
    if (!first || first.empty() || first.at(0).isDegenerate()) {
      this.red_curve = [];
      this.red_bpath.set_bpath([]);
    } else {
      /* Write curves to object. */
      spdc_concat_colors_and_flush(this, false);
      this.sa = null;
      this.ea = null;
    }
  }

  /**
   * Add a virtual point to the future pencil path.
   *
   * @param p the point to add.
   * @param state event state
   * @param last the point is the last of the user stroke.
   */
  _addFreehandPoint(p: Point, _state: ModifierState, _last: boolean): void {
    if (this._npoints <= 0 || this._npoints >= this.p_array.length) return;

    if (!p.equals(this.p_array[this._npoints - 1] as Point) && in_svg_plane(p)) {
      this.p_array[this._npoints++] = p;
      this._fitAndSplit();
      this.ps.push(p);
    }
    // TODO: pressure (tablet_enabled).
  }

  /** Fit the points of the whole stroke with the smoothing tolerance into the green curve. */
  _interpolate(): void {
    if (this.ps.length <= 1) return;

    const prefs = Preferences.get();
    const tol =
      Math.min(Math.max(prefs.getDouble('/tools/freehand/pencil/tolerance', 10.0), 0.0), 100.0) * 0.4;
    // TODO: /tools/freehand/pencil/simplify (base-simplify).
    this.green_curve.length = 0;
    this.red_curve = [];
    this.red_curve_is_valid = false;

    const tolerance_sq = 0.02 * (this._desktop.w2d().descrim() * tol) ** 2 * Math.exp(0.2 * tol - 2);

    const n_points = this.ps.length;

    // worst case gives us a segment per point
    const max_segs = 4 * n_points;

    const b: Point[] = new Array(max_segs);
    const n_segs = bezier_fit_cubic_r(b, this.ps, n_points, tolerance_sq, max_segs);
    if (n_segs > 0) {
      /* Fit and draw and reset state */
      const path = new Path(b[0]);
      // TODO: the bspline mode (freehand-mode 2).
      for (let c = 0; c < n_segs; c++) {
        path.appendCurve(
          new CubicBezier(
            path.finalPoint(),
            b[4 * c + 1] as Point,
            b[4 * c + 2] as Point,
            b[4 * c + 3] as Point,
          ),
        );
      }
      set_pathvector(this.green_curve, [path]);
      this.red_bpath.set_bpath(this.green_curve);

      /* Fit and draw and copy last point */
      /* Set up direction of next curve. */
      const last_seg = get_last_segment(this.green_curve) as Curve;
      this.p_array[0] = last_seg.finalPoint();
      this._npoints = 1;
      this._req_tangent = unitTangentAtEnd(last_seg);
    }
  }

  /**
   * Fit the points since the last split with one cubic Bezier into the red
   * curve; when that fails, move the red curve to the green curve and start
   * again at its end.
   */
  _fitAndSplit(): void {
    const tolerance_sq = 0;

    const b: Point[] = new Array(4);
    const n_segs = bezier_fit_cubic_full(
      b,
      null,
      this.p_array,
      this._npoints,
      this._req_tangent,
      new Point(0, 0),
      tolerance_sq,
      1,
    );
    if (n_segs > 0 && this._npoints < this.p_array.length) {
      /* Fit and draw and reset state */
      // TODO: the bspline mode (freehand-mode 2).
      this.red_curve = [
        path_from_curve(new CubicBezier(b[0] as Point, b[1] as Point, b[2] as Point, b[3] as Point)),
      ];
      this.red_bpath.set_bpath(this.red_curve);
      this.red_curve_is_valid = true;
    } else {
      /* Fit and draw and copy last point */
      const last_seg = get_last_segment(this.red_curve);
      if (!last_seg) return;

      /* Set up direction of next curve. */
      this.p_array[0] = last_seg.finalPoint();
      this._npoints = 1;
      this._req_tangent = unitTangentAtEnd(last_seg);

      pathvector_append_continuous(this.green_curve, this.red_curve);

      /// \todo fixme:
      // TODO: the highlight color of the layer.
      const cshape = new CanvasItemBpath(this._desktop.getCanvasControls(), this.red_curve, true);
      cshape.set_stroke(this.green_color);
      this.green_bpaths.push(cshape);

      this.red_curve_is_valid = false;
    }
  }
}

/** The unit tangent at the end of curve (upstream unitTangentAt(1)), or (0, 0). */
function unitTangentAtEnd(curve: Curve): Point {
  if (!(curve instanceof BezierCurve)) return new Point(0, 0);
  const pts = curve.controlPoints();
  const end = pts[pts.length - 1] as Point;
  for (let i = pts.length - 2; i >= 0; i--) {
    const d = end.sub(pts[i] as Point);
    if (!d.isZero() && in_svg_plane(d)) return unit_vector(d);
  }
  return new Point(0, 0);
}
