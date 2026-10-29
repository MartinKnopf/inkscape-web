// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/freehand-base.cpp, src/ui/tools/freehand-base.h
/*
 * Generic drawing context
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2000 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2002 Lauris Kaplinski
 * Copyright (C) 2012 Johan Engelen
 */
import {
  C_,
  closepath_current,
  DocumentUndo,
  is_closed,
  type Node,
  Preferences,
  pathvector_append,
  pathvector_append_continuous,
  type Selection,
  SnapCandidatePoint,
  SnapSourceType,
  SPItem,
  SPPath,
  sp_svg_write_path,
  spReprCssAttrNew,
  spReprCssProperty,
  spReprCssSet,
  spReprCssSetProperty,
} from '@inkscape-web/core';
import { distance, type Path, type PathVector, type Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { SPDrawAnchor } from '../draw-anchor.ts';
import { type ModifierState, mod_alt, mod_shift, ToolBase } from './tool-base.ts';

/** Max time and distance (GTK defaults) between two presses of a double click. */
const DOUBLE_CLICK_TIME = 400;
const DOUBLE_CLICK_DISTANCE = 5;

/**
 * Base class of the pen and pencil tools (upstream FreehandBase). The path
 * being drawn is kept in colored curves, all in desktop coordinates:
 * red is the segment being drawn, green the finished segments, blue the
 * path after a spiro/bspline LPE (unused yet). White is the selected path,
 * which the new path continues when it starts or ends at one of its end
 * anchors. spdc_concat_colors_and_flush() writes the result to the document.
 * TODO: the sketch canvas group, LPE shapes (spdc_check_for_and_apply_waiting_LPE), tablets.
 */
export class FreehandBase extends ToolBase {
  readonly selection: Selection;

  red_color = 0xff00007f;
  blue_color = 0x0000ff7f;
  green_color = 0x00ff007f;
  highlight_color = 0x0000007f;

  // Red - Last segment as it's drawn.
  red_bpath: CanvasItemBpath;
  red_curve: PathVector = [];

  // Blue - New path after LPE as it's drawn.
  blue_bpath: CanvasItemBpath;
  blue_curve: PathVector = [];

  // Green - New path as it's drawn.
  green_bpaths: CanvasItemBpath[] = [];
  /** Kept as the same array (the green anchor refers to it); cleared in place. */
  green_curve: PathVector = [];
  green_anchor: SPDrawAnchor | null = null;
  /** a flag meaning we hit the green anchor, so close the path on itself */
  green_closed = false;

  // White
  white_item: SPItem | null = null;
  white_curves: PathVector[] = [];
  white_anchors: SPDrawAnchor[] = [];

  // Temporary modified curve when start anchor
  sa_overwrited: PathVector = [];

  // Start anchor
  sa: SPDrawAnchor | null = null;

  // End anchor
  ea: SPDrawAnchor | null = null;

  red_curve_is_valid = false;
  anchor_statusbar = false;

  readonly #disconnect: (() => void)[];
  /** The last button press, to count the presses of a double click. */
  #lastPress: { time: number; button: number; w: Point } | null = null;

  constructor(desktop: SPDesktop, prefsPath: string) {
    super(desktop, prefsPath);
    this.selection = desktop.getSelection();

    // Connect signals to track selection changes
    this.#disconnect = [
      this.selection.connectChanged(() => this._attachSelection()),
      this.selection.connectModified(() => this.onSelectionModified()),
    ];

    // Create red bpath
    this.red_bpath = new CanvasItemBpath(desktop.getCanvasControls());
    this.red_bpath.set_stroke(this.red_color);

    // Create blue bpath
    this.blue_bpath = new CanvasItemBpath(desktop.getCanvasControls());
    this.blue_bpath.set_stroke(this.blue_color);

    // The right button finishes the pen path; there is no canvas context menu.
    this._element.addEventListener('contextmenu', this.#onContextMenu);

    this._attachSelection();
  }

  override destroy(): void {
    for (const f of this.#disconnect) f();
    this._element.removeEventListener('contextmenu', this.#onContextMenu);
    this.ungrabCanvasEvents();
    spdc_free_colors(this);
    super.destroy();
  }

  readonly #onContextMenu = (event: Event): void => {
    if (this._desktop.getTool() === this) event.preventDefault();
  };

  /**
   * The number of presses of a button press: 2 for the second press of a
   * double click (upstream ButtonPressEvent::num_press), else 1.
   */
  protected _numPress(event: PointerEvent): number {
    const w = this._windowPoint(event);
    const last = this.#lastPress;
    const double =
      last !== null &&
      last.button === event.button &&
      event.timeStamp - last.time <= DOUBLE_CLICK_TIME &&
      distance(last.w, w) <= DOUBLE_CLICK_DISTANCE;
    // A third press starts a new click count.
    this.#lastPress = double ? null : { time: event.timeStamp, button: event.button, w };
    return double ? 2 : 1;
  }

  /** The world point of a pointer event (upstream: event positions in window coordinates). */
  protected _worldPoint(event: MouseEvent): Point {
    return this._desktop.getCanvas().canvas_to_world(this._windowPoint(event));
  }

  /** The desktop point of a pointer event (upstream _desktop->w2d(event.pos)). */
  protected _eventDesktopPoint(event: MouseEvent): Point {
    return this._desktopPoint(this._windowPoint(event));
  }

  /** Whether this is the pen tool (upstream SP_IS_PEN_CONTEXT). */
  isPenTool(): boolean {
    return false;
  }

  red_curve_get_last_point(): Point | null {
    const last = this.red_curve[this.red_curve.length - 1];
    return last ? last.finalPoint() : null;
  }

  /* fixme: We have to ensure this is not delayed (Lauris) */
  onSelectionModified(): void {
    this._attachSelection();
  }

  /** Take the selected path as the white curves, with anchors at its open ends. */
  _attachSelection(): void {
    // We reset white and forget white/start/end anchors
    this.white_curves = [];
    for (const a of this.white_anchors) a.destroy();
    this.white_anchors = [];
    this.white_item = null;
    this.sa = null;
    this.ea = null;

    const item = this.selection.singleItem();
    if (item instanceof SPPath) {
      // Create new white data
      // Item
      this.white_item = item;

      // Curve list
      // We keep it in desktop coordinates to eliminate calculation errors
      const curve = item.curve();
      if (!curve) return;
      const i2dt = item.i2dtAffine();
      this.white_curves = curve.map((p) => [p.transformed(i2dt)]);

      // Anchor list
      for (const c of this.white_curves) {
        if (!is_closed(c) && (c[0]?.size() ?? 0) > 0) {
          const path = c[0] as Path;
          this.white_anchors.push(new SPDrawAnchor(this, c, true, path.initialPoint()));
          this.white_anchors.push(new SPDrawAnchor(this, c, false, path.finalPoint()));
        }
      }
      // fixme: recalculate active anchor?
    }
  }
}

/** Set the green curve to curve, in place (the green anchor refers to the array). */
export function set_pathvector(to: PathVector, curve: PathVector): void {
  to.length = 0;
  to.push(...curve);
}

/**
 * Snaps node or handle to PI/rotationsnapsperpi degree increments: p is
 * moved onto the nearest line through o at such an angle, and snapped to
 * objects along these lines (SnapManager.constrainedAngularSnap).
 * MOVE_NO_SNAPPING (no modifier in share/keys) would disable all but the angular snapping.
 */
export function spdc_endpoint_snap_rotation(
  tool: ToolBase,
  p: Point,
  o: Point,
  _state: ModifierState,
): Point {
  const prefs = Preferences.get();
  const snaps = Math.trunc(
    Math.min(Math.max(prefs.getDouble('/options/rotationsnapsperpi/value', 12.0), 0.1), 1800.0),
  );
  const dt = tool._desktop;
  const m = dt.getSnapManager();
  m.setup(dt);
  const dummy = m.constrainedAngularSnap(
    new SnapCandidatePoint(p, SnapSourceType.SNAPSOURCE_NODE_HANDLE),
    null,
    o,
    snaps,
  );
  m.unSetup();
  return dummy.getPoint();
}

/**
 * Snap p freely. start_of_line is the start of the segment that ends at p
 * (for perpendicular and tangential snapping). The item being drawn (the
 * single selected item) is not snapped to.
 * TODO: Allow snapping to the stationary parts of the item, and only ignore the last segment
 */
export function spdc_endpoint_snap_free(tool: ToolBase, p: Point, start_of_line: Point | null): Point {
  const dt = tool._desktop;
  const m = dt.getSnapManager();
  // selection.singleItem() is the item that is currently being drawn. This item will not be snapped to (to avoid self-snapping)
  m.setup(dt, true, dt.getSelection().singleItem());
  const scp = new SnapCandidatePoint(p, SnapSourceType.SNAPSOURCE_NODE_HANDLE);
  if (start_of_line) scp.addOrigin(start_of_line);
  const sp = m.freeSnap(scp);
  m.unSetup();
  return sp.getPoint();
}

/**
 * Concats red, blue and green.
 * If any anchors are defined, process these, optionally removing curves from white list
 * Invoke _flush_white to write result back to object.
 */
export function spdc_concat_colors_and_flush(dc: FreehandBase, forceclosed: boolean): void {
  // Green
  let c: PathVector = dc.green_curve.map((p) => p.clone());
  dc.green_curve.length = 0;
  for (const b of dc.green_bpaths) b.unlink();
  dc.green_bpaths = [];

  // Blue
  pathvector_append_continuous(c, dc.blue_curve);
  dc.blue_curve = [];
  dc.blue_bpath.set_bpath([]);

  // Red
  if (dc.red_curve_is_valid) {
    pathvector_append_continuous(c, dc.red_curve);
  }
  dc.red_curve = [];
  dc.red_bpath.set_bpath([]);

  if (c.length === 0) return;

  // Step A - test, whether we ended on green anchor
  if ((forceclosed && (!dc.sa || dc.sa.curve.length === 0)) || dc.green_anchor?.active) {
    // We hit green anchor, closing Green-Blue-Red
    // TODO: flash _("Path is closed.") in the message stack.
    closepath_current(c[c.length - 1] as Path);
    // Closed path, just flush
    spdc_flush_white(dc, c);
    return;
  }

  // Step B - both start and end anchored to same curve
  if (dc.sa && dc.ea && dc.sa.curve === dc.ea.curve && (dc.sa !== dc.ea || is_closed(dc.sa.curve))) {
    // We hit bot start and end of single curve, closing paths
    // TODO: flash _("Closing path.") in the message stack.
    pathvector_append_continuous(dc.sa_overwrited, c);
    closepath_current(dc.sa_overwrited[dc.sa_overwrited.length - 1] as Path);
    removeWhiteCurve(dc, dc.sa.curve);
    dc.white_curves.push(dc.sa_overwrited);
    dc.sa_overwrited = [];
    spdc_flush_white(dc, null);
    return;
  }
  // Step C - test start
  if (dc.sa) {
    removeWhiteCurve(dc, dc.sa.curve);
    pathvector_append_continuous(dc.sa_overwrited, c);
    c = dc.sa_overwrited;
    dc.sa_overwrited = [];
  } /* Step D - test end */ else if (dc.ea) {
    let e = dc.ea.curve;
    removeWhiteCurve(dc, e);
    if (!dc.ea.start) {
      e = e.map((p) => p.reversed()).reverse();
    }
    // TODO: the spiro and bspline modes (freehand-mode 1 and 2).
    pathvector_append_continuous(c, e);
  }
  if (forceclosed) {
    // TODO: flash _("Path is closed.") in the message stack.
    closepath_current(c[c.length - 1] as Path);
  }
  spdc_flush_white(dc, c);
}

function removeWhiteCurve(dc: FreehandBase, curve: PathVector): void {
  const i = dc.white_curves.indexOf(curve);
  if (i >= 0) dc.white_curves.splice(i, 1);
}

/**
 * Flushes white curve(s) and additional curve into object.
 *
 * No cleaning of colored curves - this has to be done by caller
 * No rereading of white data, so if you cannot rely on ::modified, do it in caller
 */
function spdc_flush_white(dc: FreehandBase, gc: PathVector | null): void {
  let c: PathVector;

  if (dc.white_curves.length > 0) {
    c = [];
    for (const wc of dc.white_curves) pathvector_append(c, wc);
    dc.white_curves = [];
    if (gc) pathvector_append(c, gc);
  } else if (gc) {
    c = gc;
  } else {
    return;
  }

  const desktop = dc._desktop;
  const doc = desktop.getDocument();
  const xml_doc = doc.getReprDoc();

  // Now we have to go back to item coordinates at last
  const m = dc.white_item ? dc.white_item.dt2iAffine() : desktop.dt2doc();
  c = c.map((p) => p.transformed(m));

  if (c.length > 0) {
    // We actually have something to write
    let repr: Node;
    if (dc.white_item) {
      repr = dc.white_item.getRepr();
    } else {
      repr = xml_doc.createElement('svg:path');
      // Set style
      desktop.applyCurrentOrToolStyle(repr, dc.getPrefsPath(), false);
    }

    // TODO: inkscape:original-d for items with path effects.
    repr.setAttribute('d', sp_svg_write_path(c));

    const layer = dc.currentLayer();
    if (!dc.white_item && layer) {
      // Attach repr
      const item = layer.appendChildRepr(repr);
      if (item instanceof SPItem) {
        dc.white_item = item;
        spdc_check_for_and_apply_waiting_LPE(dc, item);
        dc.selection.set(item);
      }
    }
    DocumentUndo.done(doc, C_('Undo', 'Draw path'), dc.isPenTool() ? 'draw-path' : 'draw-freehand');

    // When quickly drawing several subpaths with Shift, the next subpath may be finished and
    // flushed before the selection_modified signal is fired by the previous change, which
    // results in the tool losing all of the selected path's curve except that last subpath. To
    // fix this, we force the selection_modified callback now, to make sure the tool's curve is
    // in sync immediately.
    dc.onSelectionModified();
  }

  // Flush pending updates
  doc.ensureUpToDate();
}

/**
 * Apply the waiting LPE and shape of the tool to the new item. Only the
 * layer transform is applied so far (written into the path data).
 * TODO: the shapes (powerstroke, pattern along path, bend), simplify, spiro and bspline LPEs.
 */
function spdc_check_for_and_apply_waiting_LPE(dc: FreehandBase, item: SPItem): void {
  const layer = dc.currentLayer();
  if (!layer) return;
  item.transform = layer.i2docAffine().inverse();
  item.updateRepr();
  item.doWriteTransform(item.transform, null, true);
}

/** Returns FIRST active anchor (the activated one). w is a world point. */
export function spdc_test_inside(dc: FreehandBase, w: Point): SPDrawAnchor | null {
  let active: SPDrawAnchor | null = null;

  // Test green anchor
  if (dc.green_anchor) {
    active = dc.green_anchor.anchorTest(w, true);
  }

  for (const i of dc.white_anchors) {
    const na = i.anchorTest(w, !active);
    if (!active && na) active = na;
  }

  return active;
}

function spdc_free_colors(dc: FreehandBase): void {
  // Red
  dc.red_bpath.unlink();

  // Blue
  dc.blue_bpath.unlink();
  dc.blue_curve = [];

  // Overwrite start anchor curve
  dc.sa_overwrited = [];
  // Green
  for (const b of dc.green_bpaths) b.unlink();
  dc.green_bpaths = [];
  dc.green_curve.length = 0;
  dc.green_anchor?.destroy();
  dc.green_anchor = null;

  // White
  dc.white_item = null;
  dc.white_curves = [];
  for (const a of dc.white_anchors) a.destroy();
  dc.white_anchors = [];
}

/**
 * Create a single dot represented by a circle: filled with the stroke color
 * of the tool style, the diameter is the stroke width times dot-size;
 * Shift doubles it, Alt varies it randomly (freehand-dot-double, freehand-dot-random).
 */
export function spdc_create_single_dot(
  tool: ToolBase,
  pt: Point,
  path: string,
  event_state: ModifierState,
): void {
  const desktop = tool._desktop;
  const layer = tool.currentLayer();
  if (!layer) return;
  const repr = desktop.getDocument().getReprDoc().createElement('svg:path');
  repr.setAttribute('sodipodi:type', 'arc');
  const item = layer.appendChildRepr(repr);
  if (!(item instanceof SPItem)) return;
  item.transform = layer.i2docAffine().inverse();

  // apply the tool's current style
  const tool_css = desktop.getCurrentOrToolStyle(path, false) ?? spReprCssAttrNew();

  // find out stroke width (TODO: units other than px)
  const stroke_width = Number.parseFloat(spReprCssProperty(tool_css, 'stroke-width', '1')) || 1;

  const css = spReprCssAttrNew();
  if (path === '/tools/calligraphic') {
    // Calligraphic: Preserve fill and stroke
    spReprCssSetProperty(css, 'fill', spReprCssProperty(tool_css, 'fill', 'none'));
    spReprCssSetProperty(css, 'stroke', spReprCssProperty(tool_css, 'stroke', 'none'));
  } else {
    // Not calligraphic: Make a dot with no stroke and filled with current stroke color
    spReprCssSetProperty(css, 'fill', spReprCssProperty(tool_css, 'stroke', 'none'));
    spReprCssSetProperty(css, 'stroke', 'none');
  }
  spReprCssSet(repr, css, 'style');

  // put the circle where the mouse click occurred and set the diameter to the
  // current stroke width, multiplied by the amount specified in the preferences
  const prefs = Preferences.get();
  const pp = pt.transformed(item.i2dtAffine().inverse());

  let rad = 0.5 * prefs.getDouble(`${path}/dot-size`, 3.0);
  if (mod_alt(event_state)) {
    // TODO: We vary the dot size between 0.5*rad and 1.5*rad, where rad is the dot size
    // as specified in prefs. Very simple, but it might be sufficient in practice. If not,
    // we need to devise something more sophisticated.
    rad *= 1 + (Math.random() - 0.5);
  }
  if (mod_shift(event_state)) {
    // double the point size
    rad *= 2;
  }

  repr.setAttributeSvgDouble('sodipodi:cx', pp.x);
  repr.setAttributeSvgDouble('sodipodi:cy', pp.y);
  repr.setAttributeSvgDouble('sodipodi:rx', rad * stroke_width);
  repr.setAttributeSvgDouble('sodipodi:ry', rad * stroke_width);
  item.updateRepr();
  item.doWriteTransform(item.transform, null, true);

  desktop.getSelection().set(item);

  // TODO: flash _("Creating single dot") in the message stack.
  DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Create single dot'), '');
}
