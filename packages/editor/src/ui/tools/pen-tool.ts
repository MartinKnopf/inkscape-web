// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/pen-tool.cpp, src/ui/tools/pen-tool.h
/*
 * Pen event context implementation.
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
  backspace,
  get_last_segment,
  last_point_additive_move,
  Preferences,
  pathvector_append_continuous,
} from '@inkscape-web/core';
import { are_near, CubicBezier, LineSegment, Path, PathVector, Point } from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { CanvasItemCtrl, CanvasItemCtrlType } from '../../display/control/canvas-item-ctrl.ts';
import { CanvasItemCurve } from '../../display/control/canvas-item-curve.ts';
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
  mod_alt,
  mod_ctrl,
  mod_freehand_angle_snapping,
  mod_select_add_to,
  mod_shift,
  mod_shift_only,
} from './tool-base.ts';

export enum PenMode {
  MODE_CLICK,
  MODE_DRAG,
}

export enum PenState {
  POINT,
  CONTROL,
  CLOSE,
  STOP,
  DEAD,
}

// Modifiers from share/keys/inkscape.xml (upstream Modifiers::Modifier).
/** freehand-dot: Ctrl */
const mod_freehand_dot = (s: ModifierState): boolean => mod_ctrl(s);
/** move-snapping ("No Move Snapping"): no modifier in share/keys/inkscape.xml. */
const mod_move_no_snapping = (_s: ModifierState): boolean => false;

const NO_MODIFIERS: ModifierState = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };

/**
 * The pen (Bezier) tool (upstream PenTool). In drag mode (the default) a
 * click adds a line node and a drag adds a curve node with symmetric
 * handles; in click mode a click adds a node and a second click sets its
 * handle. Ctrl snaps angles. Enter, a double click or the right button
 * finishes the path, Shift+Enter closes it, a click on the start anchor
 * closes it, Esc cancels it and Backspace removes the last node. Ctrl+Z and
 * Ctrl+Shift+Z undo and redo nodes while drawing. A path started or ended at
 * an end anchor of the selected path continues that path; Shift adds the new
 * path to the selected path as a subpath. Arrow keys move the last node,
 * Shift+L makes the last segment a line, Shift+U a curve.
 * TODO: the spiro, bspline, polyline and paraxial modes (freehand-mode 1–4),
 * waiting LPEs, snapping, status bar messages, cursor, Shift+G (to guides).
 */
export class PenTool extends FreehandBase {
  p_array: Point[] = Array.from({ length: 5 }, () => new Point(0, 0));
  previous = new Point(0, 0);
  /** \invar npoints in {0, 2, 5}. */
  // npoints somehow determines the type of the node (what does it mean, exactly? the number of Bezier handles?)
  npoints = 0;
  mode = PenMode.MODE_CLICK;
  state = PenState.POINT;
  polylines_only = false;
  polylines_paraxial = false;
  spiro = false; // Spiro mode active?
  bspline = false; // BSpline mode active?

  /** Origin, Start, Center, End point of path. TODO: the node and rotate handle types. */
  readonly ctrl: CanvasItemCtrl[];
  readonly cl0: CanvasItemCurve;
  readonly cl1: CanvasItemCurve;

  events_disabled = false;

  // NOTE: undoing work in progress always deletes the last added point,
  // so there's no need for an undo stack.
  /** History of undone events */
  #redo_stack: PathVector[] = [];
  #did_redo = false;

  pen_drag_origin_w = new Point(0, 0);
  pen_within_tolerance = false;
  #button1on = false;

  constructor(desktop: SPDesktop, prefsPath = '/tools/freehand/pen') {
    super(desktop, prefsPath);

    // Pen indicators (temporary handles shown when adding a new node).
    const canvas = desktop.getCanvasControls();
    this.cl0 = new CanvasItemCurve(canvas);
    this.cl1 = new CanvasItemCurve(canvas);
    this.cl0.set_visible(false);
    this.cl1.set_visible(false);
    this.ctrl = Array.from({ length: 4 }, () => {
      const c = new CanvasItemCtrl(canvas, CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_DEFAULT);
      c.set_pickable(false);
      c.set_visible(false);
      return c;
    });

    this.sp_event_context_read('mode');

    this.anchor_statusbar = false;

    this.setPolylineMode();

    if (Preferences.get().getBool('/tools/freehand/pen/selcue')) this.enableSelectionCue();
  }

  override destroy(): void {
    if (this.npoints !== 0) {
      // switching context - finish path
      this.ea = null; // unset end anchor if set (otherwise crashes)
      if (this.state !== PenState.DEAD) this._finish(false);
    }
    for (const c of this.ctrl) c.unlink();
    this.cl0.unlink();
    this.cl1.unlink();
    super.destroy();
  }

  override isPenTool(): boolean {
    return true;
  }

  /** Read the mode of the toolbar (/tools/freehand/pen/freehand-mode). TODO: modes other than Bezier. */
  setPolylineMode(): void {
    const mode = Preferences.get().getInt('/tools/freehand/pen/freehand-mode', 0);
    // change the nodes to make space for bspline mode
    this.polylines_only = mode === 3 || mode === 4;
    this.polylines_paraxial = mode === 4;
    this.spiro = mode === 1;
    this.bspline = mode === 2;
    // TODO: _bsplineSpiroColor(), _redrawAll() for the spiro and bspline modes.
  }

  _cancel(): void {
    this.state = PenState.STOP;
    this._resetColors();
    for (const c of this.ctrl) c.set_visible(false);
    this.cl0.set_visible(false);
    this.cl1.set_visible(false);
    // TODO: flash _("Drawing cancelled") in the message context.
    this.#redo_stack = [];
  }

  /** Callback that sets key to value in pen context. */
  override set(name: string): void {
    if (name === 'mode') {
      const value = Preferences.get().getString(`${this.getPrefsPath()}/mode`);
      this.mode = value === 'drag' ? PenMode.MODE_DRAG : PenMode.MODE_CLICK;
    }
  }

  hasWaitingLPE(): boolean {
    // TODO: waiting LPEs.
    return false;
  }

  /** Snaps new node relative to the previous node. */
  _endpointSnap(p: Point, state: ModifierState): Point {
    // Paraxial kicks in after first line has set the angle (before then it's a free line)
    const poly = this.polylines_paraxial && PathVector.curveCount(this.green_curve) !== 0;

    if (mod_freehand_angle_snapping(state) && !poly) {
      // angular snapping (default: Ctrl)
      if (this.npoints > 0) return spdc_endpoint_snap_rotation(this, p, this.p_array[0] as Point, state);
      return spdc_endpoint_snap_free(this, p, null);
    }
    // We cannot use shift here to disable snapping because the shift-key is already used
    // to toggle the paraxial direction; if the user wants to disable snapping (s)he will
    // have to use the %-key, the menu, or the snap toolbar
    // TODO: paraxial mode (_setToNearestHorizVert).
    // snap freely
    const origin = this.npoints > 0 ? (this.p_array[0] as Point) : null;
    return spdc_endpoint_snap_free(this, p, origin); // pass the origin, to allow for perpendicular / tangential snapping
  }

  /** Snaps new node's handle relative to the new node. */
  _endpointSnapHandle(p: Point, state: ModifierState): Point {
    if (this.npoints !== 2 && this.npoints !== 5) return p;
    const origin = this.p_array[this.npoints - 2] as Point;
    if (mod_freehand_angle_snapping(state)) {
      // angular snapping (default: Ctrl)
      return spdc_endpoint_snap_rotation(this, p, origin, state);
    }
    // "no snapping" disables all snapping, except the angular snapping above (default: Shift)
    if (!mod_move_no_snapping(state)) return spdc_endpoint_snap_free(this, p, origin);
    return p;
  }

  /** Callback to handle all pen events. */
  override root_handler(event: Event): boolean {
    let ret = false;
    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        const num_press = this._numPress(e);
        if (num_press === 1) ret = this._handleButtonPress(e);
        else if (num_press === 2) ret = this._handle2ButtonPress(e);
        if (e.button === 0) this.#button1on = true;
        break;
      }
      case 'pointermove':
        ret = this._handleMotionNotify(event as PointerEvent);
        break;
      case 'pointerup': {
        const e = event as PointerEvent;
        ret = this._handleButtonRelease(e);
        if (e.button === 0) this.#button1on = false;
        break;
      }
      case 'keydown':
        ret = this._handleKeyPress(event as KeyboardEvent);
        // Keep the window shortcuts (doc.undo, ...) from handling the key.
        if (ret) event.preventDefault();
        break;
    }
    return ret || super.root_handler(event);
  }

  /** Handle mouse single button press event. */
  _handleButtonPress(event: PointerEvent): boolean {
    if (this.events_disabled) {
      // skip event processing if events are disabled
      return false;
    }

    const event_w = this._windowPoint(event);
    const event_dt = this._eventDesktopPoint(event);
    //Test whether we hit any anchor.
    const anchor = spdc_test_inside(this, this._worldPoint(event));

    let ret = false;

    if (event.button === 0) {
      if (!have_viable_layer(this._desktop)) return true;

      this.grabCanvasEvents(event);

      this.pen_drag_origin_w = event_w;
      this.pen_within_tolerance = true;

      switch (this.mode) {
        case PenMode.MODE_CLICK:
          // In click mode we add point on release
          if (this.state === PenState.STOP) {
            // This is allowed, if we just canceled curve
            this.state = PenState.POINT;
          }
          break;
        case PenMode.MODE_DRAG:
          switch (this.state) {
            case PenState.STOP:
            // This is allowed, if we just canceled curve
            case PenState.POINT:
              if (this.npoints === 0) {
                if (mod_freehand_dot(event) && (this.polylines_only || this.polylines_paraxial)) {
                  // TODO: snap the dot.
                  spdc_create_single_dot(this, event_dt, '/tools/freehand/pen', event);
                  ret = true;
                  break;
                }

                // Set start anchor
                this.sa = anchor;
                let p: Point;
                if (anchor) {
                  //Put the start overwrite curve always on the same direction
                  this.sa_overwrited = anchor.start
                    ? anchor.curve.map((c) => c.reversed()).reverse()
                    : anchor.curve.map((c) => c.clone());
                }
                if (anchor && (!this.hasWaitingLPE() || this.bspline || this.spiro)) {
                  // Adjust point to anchor if needed; if we have a waiting LPE, we need
                  // a fresh path to be created so don't continue an existing one
                  p = anchor.dp;
                  // TODO: flash _("Continuing selected path") in the message stack.
                } else {
                  // This is the first click of a new curve; deselect item so that
                  // this curve is not combined with it (unless it is drawn from its
                  // anchor, which is handled by the sibling branch above)
                  if (!mod_select_add_to(event) || this.hasWaitingLPE()) {
                    // if we have a waiting LPE, we need a fresh path to be created
                    // so don't append to an existing one
                    this.selection.clear();
                  }

                  // Create green anchor
                  p = this._endpointSnap(event_dt, event);
                  this.green_anchor?.destroy();
                  this.green_anchor = new SPDrawAnchor(this, this.green_curve, true, p);
                }
                this._setInitialPoint(p);
              } else {
                // Set end anchor
                this.ea = anchor;
                if (anchor) {
                  // we hit an anchor, will finish the curve (either with or without closing)
                  // in release handler
                  this.state = PenState.CLOSE;

                  if (this.green_anchor?.active) {
                    // we clicked on the current curve start, so close it even if
                    // we drag a handle away from it
                    this.green_closed = true;
                  }
                  ret = true;
                  break;
                }
                // Snap node only if not hitting anchor.
                this._setSubsequentPoint(this._endpointSnap(event_dt, event), true);
              }
              // avoid the creation of a control point so a node is created in the release event
              this.state =
                this.spiro || this.bspline || this.polylines_only ? PenState.POINT : PenState.CONTROL;
              ret = true;
              break;
            default:
              break;
          }
          break;
      }
    } else if (event.button === 2 && this.npoints !== 0 && !this.#button1on) {
      // right click - finish path, but only if the left click isn't pressed.
      this.ea = null; // unset end anchor if set (otherwise crashes)
      this._finish(false);
      ret = true;
    }

    return ret;
  }

  /** Handle mouse double button press event. */
  _handle2ButtonPress(event: PointerEvent): boolean {
    let ret = false;
    // Only end on LMB double click. Otherwise horizontal scrolling causes ending of the path
    if (this.npoints !== 0 && event.button === 0 && this.state !== PenState.CLOSE) {
      this._finish(false);
      ret = true;
    }
    return ret;
  }

  /** Handle motion_notify event. */
  _handleMotionNotify(event: PointerEvent): boolean {
    let ret = false;

    if (event.buttons & 4) {
      // allow scrolling
      return false;
    }

    if (this.events_disabled) {
      // skip motion events if pen events are disabled
      return false;
    }

    const event_w = this._windowPoint(event);

    //we take out the function the const "tolerance" because we need it later
    const tolerance = Math.min(Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0), 100);

    if (this.pen_within_tolerance) {
      const d = event_w.sub(this.pen_drag_origin_w);
      if (Math.max(Math.abs(d.x), Math.abs(d.y)) < tolerance) {
        return false; // Do not drag if we're within tolerance from origin.
      }
    }
    // Once the user has moved farther than tolerance from the original location
    // (indicating they intend to move the object, not click), then always process the
    // motion notify coordinates as given (no snapping back to origin)
    this.pen_within_tolerance = false;

    // Find desktop coordinates
    let p = this._eventDesktopPoint(event);

    // Test, whether we hit any anchor
    const anchor = spdc_test_inside(this, this._worldPoint(event));

    switch (this.mode) {
      case PenMode.MODE_CLICK:
        switch (this.state) {
          case PenState.POINT:
            if (this.npoints !== 0) {
              // Only set point, if we are already appending
              this._setSubsequentPoint(this._endpointSnap(p, event), true);
              ret = true;
            }
            break;
          case PenState.CONTROL:
          case PenState.CLOSE:
            // Placing controls is last operation in CLOSE state
            this._setCtrl(this._endpointSnap(p, event), event);
            ret = true;
            break;
          default:
            break;
        }
        break;
      case PenMode.MODE_DRAG:
        switch (this.state) {
          case PenState.POINT:
            if (this.npoints > 0) {
              // Only set point, if we are already appending
              if (!anchor) {
                // Snap node only if not hitting anchor
                this._setSubsequentPoint(this._endpointSnap(p, event), true, event);
              } else if (this.green_anchor?.active && PathVector.curveCount(this.green_curve) !== 0) {
                // The green anchor is the end point, use the initial point explicitly.
                this._setSubsequentPoint((this.green_curve[0] as Path).initialPoint(), false, event);
              } else {
                this._setSubsequentPoint(anchor.dp, false, event);
              }
              // TODO: status bar messages for anchors.
              this.anchor_statusbar = !!anchor;
              ret = true;
            } else {
              this.anchor_statusbar = !!anchor;
            }
            break;
          case PenState.CONTROL:
          case PenState.CLOSE:
            // Placing controls is last operation in CLOSE state

            // snap the handle
            p = this._endpointSnapHandle(p, event);

            if (!this.polylines_only) {
              this._setCtrl(p, event);
            } else {
              this._setCtrl(this.p_array[1] as Point, event);
            }
            ret = true;
            break;
          default:
            break;
        }
        break;
    }
    // TODO: _bsplineSpiroMotion() for the spiro and bspline modes.
    return ret;
  }

  /** Handle mouse button release event. */
  _handleButtonRelease(event: PointerEvent): boolean {
    if (this.events_disabled) {
      // skip event processing if events are disabled
      return false;
    }

    let ret = false;

    if (event.button === 0) {
      // Find desktop coordinates
      let p = this._eventDesktopPoint(event);

      // Test whether we hit any anchor.
      const anchor = spdc_test_inside(this, this._worldPoint(event));

      switch (this.mode) {
        case PenMode.MODE_CLICK:
          switch (this.state) {
            case PenState.POINT:
              this.ea = anchor;
              if (anchor) p = anchor.dp;
              this.state = PenState.CONTROL;
              break;
            case PenState.CONTROL:
              // End current segment
              this._finishSegment(this._endpointSnap(p, event), event);
              this.state = PenState.POINT;
              break;
            case PenState.CLOSE:
              // End current segment
              if (!anchor) {
                // Snap node only if not hitting anchor
                p = this._endpointSnap(p, event);
              }
              this._finishSegment(p, event);
              this._finish(true);
              this.state = PenState.POINT;
              break;
            case PenState.STOP:
              // This is allowed, if we just canceled curve
              this.state = PenState.POINT;
              break;
            default:
              break;
          }
          break;
        case PenMode.MODE_DRAG:
          switch (this.state) {
            case PenState.POINT:
            case PenState.CONTROL:
              this._finishSegment(this._endpointSnap(p, event), event);
              break;
            case PenState.CLOSE:
              this._finishSegment(this._endpointSnap(p, event), event);
              if (this.green_closed) {
                // finishing at the start anchor, close curve
                this._finish(true);
              } else {
                // finishing at some other anchor, finish curve but not close
                this._finish(false);
              }
              break;
            default:
              break;
          }
          this.state = PenState.POINT;
          break;
      }

      this.ungrabCanvasEvents(event);

      ret = true;

      this.green_closed = false;
    }

    return ret;
  }

  _redrawAll(): void {
    // green
    if (this.green_bpaths.length > 0) {
      // remove old piecewise green canvasitems
      for (const b of this.green_bpaths) b.unlink();
      // one canvas bpath for all of green_curve
      const canvas_shape = new CanvasItemBpath(this._desktop.getCanvasControls(), this.green_curve, true);
      canvas_shape.set_stroke(this.green_color);
      this.green_bpaths = [canvas_shape];
    }
    if (this.green_anchor) this.green_anchor.ctrl.set_position(this.green_anchor.dp);

    const [p0, p1, p2, p3] = this.p_array as [Point, Point, Point, Point];
    const red = new Path(p0);
    red.appendCurve(new CubicBezier(p0, p1, p2, p3));
    this.red_curve = [red];
    this.red_bpath.set_bpath(this.red_curve, true);

    for (const c of this.ctrl) c.set_visible(false);
    // handles
    // hide the handlers in bspline and spiro modes
    if (this.npoints === 5) {
      this.#showCtrl(0, p0);
      this.#showCtrl(3, p3);
    }

    if (!p0.equals(p1) && !this.spiro && !this.bspline) {
      this.#showCtrl(1, p1);
      this.cl1.set_coords(p0, p1);
      this.cl1.set_visible(true);
    } else {
      this.cl1.set_visible(false);
    }

    const last_seg = get_last_segment(this.green_curve);
    if (last_seg) {
      // hide the handlers in bspline and spiro modes
      if (
        last_seg instanceof CubicBezier &&
        !last_seg.controlPoint(2).equals(p0) &&
        !this.spiro &&
        !this.bspline
      ) {
        const c2 = last_seg.controlPoint(2);
        this.#showCtrl(2, c2);
        this.cl0.set_coords(c2, p0);
        this.cl0.set_visible(true);
      } else {
        this.cl0.set_visible(false);
      }
    }
  }

  #showCtrl(i: number, p: Point): void {
    const c = this.ctrl[i] as CanvasItemCtrl;
    c.set_position(p);
    c.set_visible(true);
  }

  /** Move the last node by (x, y) in document units (y up when the y axis points up). */
  _lastpointMove(x: number, y: number): void {
    if (this.npoints !== 5) return;

    const delta = new Point(x, y * -this._desktop.yaxisdir());
    // TODO: /options/moverotated/value with a rotated canvas.

    // green
    if (PathVector.curveCount(this.green_curve) !== 0) {
      last_point_additive_move(this.green_curve, delta);
    } else {
      // start anchor too
      if (this.green_anchor) this.green_anchor.dp = this.green_anchor.dp.add(delta);
    }

    // red
    this.p_array[0] = (this.p_array[0] as Point).add(delta);
    this.p_array[1] = (this.p_array[1] as Point).add(delta);
    this._redrawAll();
  }

  _lastpointMoveScreen(x: number, y: number): void {
    this._lastpointMove(x / this._desktop.current_zoom(), y / this._desktop.current_zoom());
  }

  /** Make the last segment a curve with a handle at a third of its length (Shift+U). */
  _lastpointToCurve(): void {
    // avoid that if the "red_curve" contains only two points ( rect ), it doesn't stop here.
    if (this.npoints !== 5 && !this.spiro && !this.bspline) return;

    const seg = get_last_segment(this.red_curve);
    const red_final = this.red_curve_get_last_point();
    if (!seg || !red_final) return;
    this.p_array[1] = seg.initialPoint().add(red_final.sub(seg.initialPoint()).mul(1 / 3));
    // TODO: the spiro and bspline modes.
    this._redrawAll();
  }

  /** Make the last segment a line (Shift+L). */
  _lastpointToLine(): void {
    // avoid that if the "red_curve" contains only two points ( rect) it doesn't stop here.
    if (this.npoints !== 5 && !this.bspline) return;
    // TODO: the spiro and bspline modes.
    this.p_array[1] = this.p_array[0] as Point;
    this._redrawAll();
  }

  _handleKeyPress(event: KeyboardEvent): boolean {
    let ret = false;
    const nudge = Math.min(Math.max(Preferences.get().getDouble('/options/nudgedistance/value', 2), 0), 1000); // in px
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const primary = mod_ctrl(event);

    // Check for undo/redo.
    if (this.npoints > 0 && primary && !event.shiftKey && key === 'z') {
      return this._undoLastPoint(true);
    }
    if (primary && ((event.shiftKey && key === 'z') || (!event.shiftKey && key === 'y'))) {
      return this._redoLastPoint();
    }
    // tool.pen.to-line: Shift+L, tool.pen.to-curve: Shift+U
    if (mod_shift_only(event) && key === 'l') {
      this._lastpointToLine();
      ret = true;
    } else if (mod_shift_only(event) && key === 'u') {
      this._lastpointToCurve();
      ret = true;
    }

    const arrow = ARROWS[event.key];
    if (arrow) {
      if (!primary) {
        const [dx, dy] = arrow;
        const f = mod_shift(event) ? 10 : 1;
        if (mod_alt(event)) this._lastpointMoveScreen(dx * f, dy * f);
        else this._lastpointMove(dx * f * nudge, dy * f * nudge);
        ret = true;
      }
      return ret;
    }

    switch (event.key) {
      case 'Enter':
        if (this.npoints !== 0) {
          this.ea = null; // unset end anchor if set (otherwise crashes)
          if (mod_shift_only(event)) {
            // All this is needed to stop the last control
            // point dispeating and stop making an n-1 shape.
            const p = new Point(0, 0);
            if (this.red_curve.length === 0) this.red_curve.push(new Path(p));
            this._finishSegment(p, NO_MODIFIERS);
            this._finish(true);
          } else {
            this._finish(false);
          }
          ret = true;
        }
        break;
      case 'Escape':
        if (this.npoints !== 0) {
          // if drawing, cancel, otherwise pass it up for deselecting
          this._cancel();
          ret = true;
        }
        break;
      case 'Backspace':
      case 'Delete':
        ret = this._undoLastPoint();
        break;
      default:
        break;
    }
    return ret;
  }

  _resetColors(): void {
    // Red
    this.red_curve = [];
    this.red_bpath.set_bpath([]);

    // Blue
    this.blue_curve = [];
    this.blue_bpath.set_bpath([]);

    // Green
    for (const b of this.green_bpaths) b.unlink();
    this.green_bpaths = [];
    this.green_curve.length = 0;
    this.green_anchor?.destroy();
    this.green_anchor = null;

    this.sa = null;
    this.ea = null;

    this.sa_overwrited = [];

    this.npoints = 0;
    this.red_curve_is_valid = false;
  }

  _setInitialPoint(p: Point): void {
    this.p_array[0] = p;
    this.p_array[1] = p;
    this.npoints = 2;
    this.red_bpath.set_bpath([]);
  }

  _setSubsequentPoint(p: Point, _statusbar: boolean, _status: ModifierState = NO_MODIFIERS): void {
    // todo: Check callers to see whether 2 <= npoints is guaranteed.
    this.p_array[2] = p;
    this.p_array[3] = p;
    this.p_array[4] = p;
    this.npoints = 5;
    const p0 = this.p_array[0] as Point;
    const p1 = this.p_array[1] as Point;
    const red = new Path(p0);
    // TODO: the paraxial mode (an L-shaped path to an anchor).
    // one of the 'regular' modes
    if (!p1.equals(p0) || this.spiro) {
      red.appendCurve(new CubicBezier(p0, p1, p, p));
    } else {
      red.appendCurve(new LineSegment(p0, p));
    }
    this.red_curve = [red];

    this.red_bpath.set_bpath(this.red_curve, true);
    // TODO: the angle/distance status bar message.
  }

  _setCtrl(q: Point, state: ModifierState): void {
    for (const c of this.ctrl) c.set_visible(false);

    (this.ctrl[1] as CanvasItemCtrl).set_visible(true);
    this.cl1.set_visible(true);

    const [p0] = this.p_array as [Point];
    if (this.npoints === 2) {
      this.p_array[1] = q;
      this.cl0.set_visible(false);
      this.#showCtrl(1, q);
      this.cl1.set_coords(p0, q);
    } else if (this.npoints === 5) {
      this.p_array[4] = q;
      this.cl0.set_visible(true);
      const p3 = this.p_array[3] as Point;
      if (
        (this.mode === PenMode.MODE_CLICK && mod_freehand_angle_snapping(state)) ||
        (this.mode === PenMode.MODE_DRAG && !mod_move_no_snapping(state))
      ) {
        const delta = q.sub(p3);
        this.p_array[2] = p3.sub(delta);
        const red = new Path(p0);
        red.appendCurve(new CubicBezier(p0, this.p_array[1] as Point, this.p_array[2] as Point, p3));
        this.red_curve = [red];
        this.red_bpath.set_bpath(this.red_curve, true);
      }
      // Avoid conflicting with initial point ctrl
      if (PathVector.curveCount(this.green_curve) > 0) this.#showCtrl(0, p0);
      this.#showCtrl(3, p3);
      this.#showCtrl(2, this.p_array[2] as Point);
      this.#showCtrl(1, q);

      this.cl0.set_coords(p3, this.p_array[2] as Point);
      this.cl1.set_coords(p3, q);
    }
  }

  _finishSegment(_q: Point, _state: ModifierState): void {
    // TODO: paraxial mode (nextParaxialDirection), spiro and bspline (_bsplineSpiro).
    if (PathVector.curveCount(this.red_curve) !== 0) {
      const p0 = this.p_array[0] as Point;
      if (PathVector.curveCount(this.green_curve) !== 0 && !are_near(lastPoint(this.green_curve), p0)) {
        const cubic = get_last_segment(this.green_curve);
        if (cubic instanceof CubicBezier) {
          const [c0, c1, c2, c3] = cubic.controlPoints() as [Point, Point, Point, Point];
          const lsegment = new Path(c0);
          const red_initial = (this.red_curve[0] as Path).initialPoint();
          lsegment.appendCurve(new CubicBezier(c0, c1, p0.sub(c2.sub(c3)), red_initial));
          backspace(this.green_curve);
          pathvector_append_continuous(this.green_curve, [lsegment]);
        }
      }
      pathvector_append_continuous(this.green_curve, this.red_curve);

      /// \todo fixme:
      const canvas_shape = new CanvasItemBpath(this._desktop.getCanvasControls(), this.red_curve, true);
      canvas_shape.set_stroke(this.green_color);
      this.green_bpaths.push(canvas_shape);

      this.p_array[0] = this.p_array[3] as Point;
      this.p_array[1] = this.p_array[4] as Point;
      this.npoints = 2;

      this.red_curve = [];
      this.#redo_stack = [];
    }
  }

  /** Remove the last node of the path being drawn; true if there was one. */
  _undoLastPoint(user_undo = false): boolean {
    let ret = false;

    const crv = get_last_segment(this.green_curve);
    if (PathVector.curveCount(this.green_curve) === 0 || !crv) {
      if (PathVector.curveCount(this.red_curve) === 0) {
        return ret; // do nothing; this event should be handled upstream
      }
      this._cancel();
      ret = true;
    } else {
      this.red_curve = [];
      if (user_undo) {
        if (this.#did_redo) {
          this.#redo_stack = [];
          this.#did_redo = false;
        }
        this.#redo_stack.push(this.green_curve.map((p) => p.clone()));
      }
      // The code below assumes that this->green_curve has only ONE path !
      this.p_array[0] = crv.initialPoint();
      this.p_array[1] = crv instanceof CubicBezier ? crv.controlPoint(1) : (this.p_array[0] as Point);

      const pt = this.npoints < 4 ? crv.finalPoint() : (this.p_array[3] as Point);

      this.npoints = 2;
      // delete the last segment of the green curve and green bpath
      if (PathVector.curveCount(this.green_curve) === 1) {
        this.npoints = 5;
        this.green_bpaths.pop()?.unlink();
        this.green_curve.length = 0;
      } else {
        backspace(this.green_curve);
        if (this.green_bpaths.length > 1) {
          this.green_bpaths.pop()?.unlink();
        } else if (this.green_bpaths.length === 1) {
          this.green_bpaths[0]?.set_bpath(this.green_curve, true);
        }
      }

      for (const c of this.ctrl) c.set_visible(false);
      this.cl0.set_visible(false);
      this.cl1.set_visible(false);
      this.state = PenState.POINT;

      this._setSubsequentPoint(pt, true);
      ret = true;
    }

    return ret;
  }

  /** Re-add the last undone point to the path being drawn */
  _redoLastPoint(): boolean {
    const redo = this.#redo_stack.pop();
    if (!redo) return false;

    set_pathvector(this.green_curve, redo);

    const last_seg = get_last_segment(this.green_curve);
    if (last_seg) {
      const freshly_added = new Path(last_seg.initialPoint());
      freshly_added.appendCurve(last_seg);
      const bpath = new CanvasItemBpath(this._desktop.getCanvasControls(), [freshly_added], true);
      bpath.set_stroke(this.green_color);
      this.green_bpaths.push(bpath);
    }

    if (this.green_curve.length > 0) {
      const p = lastPoint(this.green_curve);
      this.p_array[0] = p;
      this.p_array[1] = p;
    }
    this._setSubsequentPoint(this.p_array[3] as Point, true);

    this.#did_redo = true;
    return true;
  }

  /** Write the path to the document; closed closes it. */
  _finish(closed: boolean): void {
    this.events_disabled = true;

    // TODO: flash _("Drawing finished") in the message stack.

    // cancel line without a created segment
    this.red_curve = [];
    spdc_concat_colors_and_flush(this, closed);
    this.sa = null;
    this.ea = null;

    this.npoints = 0;
    this.state = PenState.POINT;

    for (const c of this.ctrl) c.set_visible(false);

    this.cl0.set_visible(false);
    this.cl1.set_visible(false);

    this.green_anchor?.destroy();
    this.green_anchor = null;
    this.#redo_stack = [];
    this.events_disabled = false;
  }
}

/** Arrow keys: the direction of the last node move (y up). */
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowUp: [0, 1],
  ArrowRight: [1, 0],
  ArrowDown: [0, -1],
};

function lastPoint(pv: PathVector): Point {
  return (pv[pv.length - 1] as Path).finalPoint();
}
