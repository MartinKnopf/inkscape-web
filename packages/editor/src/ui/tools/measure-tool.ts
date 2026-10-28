// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/measure-tool.cpp, src/ui/tools/measure-tool.h
/*
 * Our nice measuring tool
 *
 * Authors:
 *   Felipe Correa da Silva Sanches <juca@members.fsf.org>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Jabiertxo Arraiza <jabier.arraiza@marker.es>
 *
 * Copyright (C) 2011 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { convertUnit, Preferences, SnapCandidatePoint, SnapSourceType, SPShape } from '@inkscape-web/core';
import {
  type Affine,
  deg_from_rad,
  lineCrossings,
  PathVector,
  Point,
  Rect,
  Rotate,
} from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import type { CanvasItem } from '../../display/control/canvas-item.ts';
import { CanvasItemCtrl, CanvasItemCtrlType } from '../../display/control/canvas-item-ctrl.ts';
import { CanvasItemCurve } from '../../display/control/canvas-item-curve.ts';
import { CanvasItemText } from '../../display/control/canvas-item-text.ts';
import { spdc_endpoint_snap_rotation } from './freehand-base.ts';
import { mod_freehand_angle_snapping, ToolBase } from './tool-base.ts';

/** CANVAS_ITEM_PRIMARY and CANVAS_ITEM_SECONDARY colors of upstream CANVAS_ITEM_COLORS. */
const COLOR_PRIMARY = 0x0000ff7f;
const COLOR_SECONDARY = 0xff00007f;
/** Where the labels of the segments between the crossings are, in screen px from the line. */
const DIMENSION_OFFSET = 70;

/** A label of the length of a segment of the measure line and where it is (upstream LabelPlacement). */
export interface LabelPlacement {
  label: string;
  /** The length in the measure unit (before the scale). */
  lengthVal: number;
  /** The distance of the label from the line, in screen px. */
  offset: number;
  /** The middle of the segment, desktop coordinates. */
  start: Point;
  /** The position of the label, desktop coordinates. */
  end: Point;
}

/** The angle of the vector from start to end, in radians in (-pi, pi] (upstream atan2(end_p - start_p)). */
export function measure_angle(start: Point, end: Point, base: Point | null = null): number {
  const v = end.sub(start);
  let angle = Math.atan2(v.y, v.x);
  if (base) {
    // The angle is measured from the explicit base direction; keep it in [-pi, pi].
    const b = base.sub(start);
    angle -= Math.atan2(b.y, b.x);
    if (angle > Math.PI) angle -= 2 * Math.PI;
    if (angle < -Math.PI) angle += 2 * Math.PI;
  }
  return angle;
}

/**
 * The text of a measure label (upstream setMeasureCanvasText): the amount with
 * `precision` decimals, the unit ("°" for an angle) and an optional label in front.
 */
export function measure_text(
  amount: number,
  precision: number,
  unit: string,
  is_angle = false,
  label = '',
): string {
  const text = `${amount.toFixed(precision)} ${is_angle ? '°' : unit}`;
  return label ? `${label}: ${text}` : text;
}

/** A length in px as the amount shown: in unit, times scale (a percentage / 100). */
export function measure_length(px: number, unit: string, scale: number): number {
  return convertUnit(px, 'px', unit) * scale;
}

/**
 * The points where the segment from start to end (document coordinates) crosses the paths (each
 * with the transform to document coordinates), sorted along the segment. With show_in_between false
 * only the first and the last remain; with ignore_1st_and_last false the ends are crossings too.
 */
export function measure_intersections(
  start: Point,
  end: Point,
  shapes: readonly { pathv: PathVector; i2doc: Affine }[],
  show_in_between: boolean,
  ignore_1st_and_last: boolean,
): Point[] {
  const times = shapes
    .flatMap((s) => lineCrossings(start, end, PathVector.transformed(s.pathv, s.i2doc)))
    .sort((a, b) => a - b);
  const at = (t: number) => start.add(end.sub(start).mul(t));
  let points = times.map(at);
  if (!show_in_between && times.length > 1) {
    const first = points[0] as Point;
    const last = points[points.length - 1] as Point;
    points = [first, last];
  }
  if (!ignore_1st_and_last) points = [start, ...points, end];
  return points;
}

/**
 * Move the labels that overlap (upstream repositionOverlappingLabels): each label, from the one
 * with the smallest y, is moved away from the line in steps until it overlaps none before it.
 * `normal` is the unit normal of the measure line in screen px, `zoom` the desktop zoom, and
 * `w2d` converts a screen vector to a desktop vector.
 */
export function reposition_overlapping_labels(
  placements: LabelPlacement[],
  w2d: (v: Point) => Point,
  normal: Point,
  fontsize: number,
  precision: number,
): void {
  const sort = (a: LabelPlacement, b: LabelPlacement) =>
    a.end.y === b.end.y ? a.end.x - b.end.x : a.end.y - b.end.y;
  placements.sort(sort);
  const border = 3;
  const tmp = w2d(new Point(fontsize * (6 + precision) + border * 2, fontsize + border * 2));
  const box = new Rect(new Point(-tmp.x / 2, -tmp.y / 2), new Point(tmp.x / 2, tmp.y / 2));
  const boxAt = (p: Point) => new Rect(box.min().add(p), box.max().add(p));

  // Starting at one, since the first item can't overlap itself.
  for (let i = 1; i < placements.length; i++) {
    const place = placements[i] as LabelPlacement;
    for (let guard = 0; guard < 1000; guard++) {
      const current = boxAt(place.end);
      let overlaps = false;
      for (let j = i; j > 0 && !overlaps; j--) {
        if (current.intersects(boxAt((placements[j - 1] as LabelPlacement).end))) overlaps = true;
      }
      if (!overlaps) break;
      place.offset += fontsize + border;
      place.end = place.start.sub(w2d(normal.mul(place.offset)));
    }
    const head = placements.slice(0, i + 1).sort(sort);
    placements.splice(0, i + 1, ...head);
  }
}

/**
 * Where the label of the angle goes (upstream calcAngleDisplayAnchor): on the bisector of the angle at
 * the distance of the line, moved off the cursor and into the visible area.
 */
export function angle_display_anchor(
  desktop: SPDesktop,
  angle: number,
  base_angle: number,
  start: Point,
  end: Point,
  fontsize: number,
): Point {
  const length = end.sub(start).length();
  const effective = base_angle + angle / 2;
  let where = new Point(length, 0).transformed(Rotate(effective)).add(start);

  // When the angle is tight, the label would end up under the cursor and/or lines. Bump it.
  const scaled_fontsize = Math.abs(
    fontsize * desktop.w2d(new Point(0, 1)).sub(desktop.w2d(new Point(0, 0))).y,
  );
  if (Math.abs(where.sub(end).length()) < scaled_fontsize)
    where = new Point(where.x, where.y + scaled_fontsize * 2);

  // We now have the ideal position, but need to see if it will fit.
  let screen_world = desktop.getCanvas().get_area_world();
  const inside = (r: Rect, p: Point) =>
    p.x > r.left() && p.x < r.right() && p.y > r.top() && p.y < r.bottom();
  if (inside(screen_world, desktop.d2w(start)) || inside(screen_world, desktop.d2w(end))) {
    screen_world = screen_world.expandBy(-fontsize * 3, -fontsize / 2);
    const w = desktop.d2w(where);
    where = desktop.w2d(
      new Point(
        Math.min(Math.max(w.x, screen_world.left()), screen_world.right()),
        Math.min(Math.max(w.y, screen_world.top()), screen_world.bottom()),
      ),
    );
  } // else likely initialized the measurement tool, keep display near the measurement.
  return where;
}

/**
 * The four Bezier points of the arc of the angle (upstream createAngleDisplayCurve): from the
 * point of end that is as far from center as anchor is, around center by -angle.
 * Returns null for a zero length line.
 */
export function angle_arc_points(
  center: Point,
  end: Point,
  anchor: Point,
  angle: number,
): [Point, Point, Point, Point] | null {
  const text_len = Math.abs(anchor.sub(center).length());
  const side_len = Math.abs(end.sub(center).length());
  if (!(side_len > 0)) return null;
  const factor = Math.min(1.0, text_len / side_len);

  // arc start
  const p1 = end.sub(center).mul(factor).add(center);
  // arc end
  const p4 = p1.sub(center).transformed(Rotate(-angle)).add(center);

  // from Riskus
  const ax = p1.x - center.x;
  const ay = p1.y - center.y;
  const bx = p4.x - center.x;
  const by = p4.y - center.y;
  const q1 = ax * ax + ay * ay;
  const q2 = q1 + ax * bx + ay * by;
  const cross = ax * by - ay * bx;

  let k2: number;
  // The denominator can become 0 (see upstream for the limits).
  if (!(cross < 1e-11 && cross > -1e-11)) {
    k2 = ((4.0 / 3.0) * (Math.sqrt(2 * q1 * q2) - q2)) / cross;
  } else if (angle > 3.14 || angle < -3.14) {
    // The angle is (almost) +-180 degrees: the limit of k2 is -+4/3.
    k2 = angle > 0 ? -4.0 / 3.0 : 4.0 / 3.0;
  } else {
    // The angle is (almost) 0.
    k2 = 0.0;
  }

  const p2 = new Point(center.x + ax - k2 * ay, center.y + ay + k2 * ax);
  const p3 = new Point(center.x + bx + k2 * by, center.y + by - k2 * bx);
  return [p1, p2, p3, p4];
}

/** Read a point saved as "x,y" in the preferences (upstream readMeasurePoint). */
function read_point(path: string): Point {
  const [x, y] = Preferences.get()
    .getString(path)
    .split(',')
    .map((s) => Number.parseFloat(s));
  return Number.isFinite(x) && Number.isFinite(y)
    ? new Point(x as number, y as number)
    : new Point(Infinity, Infinity);
}

/**
 * The measure tool (upstream MeasureTool): drag to measure the distance and the angle between two
 * points. The points snap, with Ctrl the angle snaps. Where the line crosses objects, the length of
 * each segment between the crossings is shown. The unit, precision, scale and font size are the
 * preferences /tools/measure/{unit,precision,scale,fontsize}.
 * TODO: the hover info box and the measuring of path segments and corners (PathMeasure), the
 * knots to move the end points, the conversion to items, guides and phantom, dimension marking,
 * the delta labels (dX, dY), explicit base (Ctrl), text and flowed text crossings, the clipboard
 * (Alt+C), "show only visible crossings" uses the pointer picker, cursor.
 */
export class MeasureTool extends ToolBase {
  start_p: Point;
  end_p: Point;
  /** The window position of the last pointer move of the drag. */
  last_end: Point | null = null;
  #items: CanvasItem[] = [];

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/measure');
    this.start_p = read_point('/tools/measure/measure-start');
    this.end_p = read_point('/tools/measure/measure-end');
    this.showCanvasItems();
  }

  override destroy(): void {
    this.#clear();
    this.ungrabCanvasEvents();
    super.destroy();
  }

  override root_handler(event: Event): boolean {
    let ret = false;
    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        this.last_end = null;
        const w = this._windowPoint(e);
        this.saveDragOrigin(w);
        this.start_p = this.#snapFree(this._desktopPoint(w), null);
        this.grabCanvasEvents(e);
        ret = true;
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        const w = this._windowPoint(e);
        if (!(e.buttons & 1)) {
          // Show where the end would snap to.
          const m = this._desktop.getSnapManager();
          m.setup(this._desktop);
          const scp = new SnapCandidatePoint(this._desktopPoint(w), SnapSourceType.SNAPSOURCE_OTHER_HANDLE);
          if (this.start_p.x !== Infinity) scp.addOrigin(this.start_p);
          m.preSnap(scp);
          m.unSetup();
          break;
        }
        this.tolerance = Math.min(
          Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0),
          100,
        );
        if (!this.checkDragMoved(w)) break;
        this.end_p = this.#snapEnd(this._desktopPoint(w), e);
        this.showCanvasItems();
        this.last_end = w;
        ret = true;
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        if (this.last_end) this.end_p = this.#snapEnd(this._desktopPoint(this.last_end), e);
        this.showCanvasItems();
        this.ungrabCanvasEvents(e);
        ret = true;
        break;
      }
    }
    return ret || super.root_handler(event);
  }

  /** Snap p freely as OTHER_HANDLE with the origin of the line (upstream: the snap manager of the namedview). */
  #snapFree(p: Point, origin: Point | null): Point {
    const m = this._desktop.getSnapManager();
    m.setup(this._desktop);
    const scp = new SnapCandidatePoint(p, SnapSourceType.SNAPSOURCE_OTHER_HANDLE);
    if (origin) scp.addOrigin(origin);
    const r = m.freeSnap(scp).getPoint();
    m.unSetup();
    return r;
  }

  /** The end of the line for pointer position p: angle snapped with Ctrl, else snapped to the snap targets. */
  #snapEnd(p: Point, state: PointerEvent): Point {
    return mod_freehand_angle_snapping(state)
      ? spdc_endpoint_snap_rotation(this, p, this.start_p, state)
      : this.#snapFree(p, this.start_p);
  }

  /** The vector of a screen vector v in desktop coordinates. */
  #w2dVector(v: Point): Point {
    const dt = this._desktop;
    return dt.w2d(v).sub(dt.w2d(new Point(0, 0)));
  }

  #clear(): void {
    for (const item of this.#items) item.unlink();
    this.#items = [];
  }

  /** Draw the measurement of the points start_p and end_p (upstream showCanvasItems()), also called by the toolbar. */
  showCanvasItems(): void {
    const dt = this._desktop;
    this.#clear();
    const { start_p, end_p } = this;
    if (!Number.isFinite(start_p.x + start_p.y + end_p.x + end_p.y) || start_p.equals(end_p)) return;
    const prefs = Preferences.get();
    prefs.setString('/tools/measure/measure-start', `${start_p.x},${start_p.y}`);
    prefs.setString('/tools/measure/measure-end', `${end_p.x},${end_p.y}`);

    const show_in_between = prefs.getBool('/tools/measure/show_in_between', true);
    const all_layers = prefs.getBool('/tools/measure/all_layers', true);
    const only_selected = prefs.getBool('/tools/measure/only_selected', false);
    const show_hidden = prefs.getBool('/tools/measure/show_hidden', true);
    const ignore_1st_and_last = prefs.getBool('/tools/measure/ignore_1st_and_last', true);
    const unit = prefs.getString('/tools/measure/unit') || dt.getNamedView().getDisplayUnit();
    const scale = prefs.getDouble('/tools/measure/scale', 100.0) / 100.0;
    const fontsize = prefs.getDouble('/tools/measure/fontsize', 10.0);
    const precision = prefs.getInt('/tools/measure/precision', 2);
    const doc = dt.getDocument();
    const dt2doc = dt.dt2doc();
    const doc2dt = dt.doc2dt();

    const start_doc = start_p.transformed(dt2doc);
    const end_doc = end_p.transformed(dt2doc);
    const angle = measure_angle(start_p, end_p);
    const base_angle = 0;

    // The crossings of the line with the shapes.
    const current_layer = dt.layerManager().currentLayer();
    const selection = dt.getSelection();
    const shapes = doc
      .getItemsPartiallyInBox(dt.dkey, new Rect(start_doc, end_doc), false, true, false, true)
      .filter(
        (item) =>
          (!only_selected || selection.includes(item)) &&
          (all_layers || dt.layerManager().layerForObject(item) === current_layer),
      )
      .flatMap((item) =>
        item instanceof SPShape && item.curve() ? [{ pathv: item.curve() as PathVector, item }] : [],
      );
    const crossings = (extra_filter: (t: Point) => boolean) =>
      measure_intersections(
        start_doc,
        end_doc,
        shapes.map((s) => ({ pathv: s.pathv, i2doc: s.item.i2docAffine() })),
        show_in_between,
        ignore_1st_and_last,
      ).filter((p, i, all) => (i === 0 || i === all.length - 1 ? true : extra_filter(p)));
    const intersections = show_hidden
      ? crossings(() => true)
      : crossings(() => true).filter((p) => {
          // Keep the crossings where the shape is the topmost item next to the crossing.
          const w = dt.d2w(p.transformed(doc2dt)).sub(dt.getCanvas().get_pos());
          return !!dt.getItemAtPoint(w, true);
        });

    // Normal will be used for lines and text.
    const windowNormal = dt.d2w(end_p).sub(dt.d2w(start_p)).normalized().rot90();
    const normal = this.#w2dVector(windowNormal);

    const placements: LabelPlacement[] = [];
    const seg_min_len = 0.1;
    for (let idx = 1; idx < intersections.length; idx++) {
      const a = intersections[idx - 1] as Point;
      const b = intersections[idx] as Point;
      const lengthVal = convertUnit(b.sub(a).length(), 'px', unit);
      if (lengthVal > seg_min_len) {
        const start = a.add(b).div(2).transformed(doc2dt);
        placements.push({
          label: '',
          lengthVal,
          offset: DIMENSION_OFFSET / 2,
          start,
          end: start.sub(normal.mul(DIMENSION_OFFSET / 2)),
        });
      }
    }
    reposition_overlapping_labels(placements, (v) => this.#w2dVector(v), windowNormal, fontsize, precision);

    const items = this.#items;
    const text = (
      amount: number,
      is_angle: boolean,
      position: Point,
      background: number,
      to_left = false,
    ) => {
      const t = new CanvasItemText(
        dt.getCanvasTemp(),
        position,
        measure_text(amount, precision, unit, is_angle),
      );
      t.set_fontsize(fontsize);
      t.set_fill(0xffffffff);
      t.set_background(background);
      t.set_anchor_x(to_left ? 0 : 0.5);
      items.push(t);
    };
    const marker = (position: Point) => {
      const c = new CanvasItemCtrl(
        dt.getCanvasTemp(),
        CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_MARKER,
        position,
      );
      c.set_pickable(false);
      c.lower_to_bottom();
      items.push(c);
    };
    const line = (a: Point, b: Point, color: number) => {
      const l = new CanvasItemCurve(dt.getCanvasTemp());
      l.set_coords(a, b);
      l.set_stroke(color);
      l.lower_to_bottom();
      items.push(l);
    };

    for (const place of placements) text(place.lengthVal * scale, false, place.end, 0x0000007f);

    const angle_pt = angle_display_anchor(dt, angle, base_angle, start_p, end_p, fontsize);
    text(deg_from_rad(angle), true, angle_pt, 0x337f337f);

    const total = measure_length(end_p.sub(start_p).length(), unit, scale);
    text(total, false, end_p.add(this.#w2dVector(new Point(3 * fontsize, -fontsize))), 0x3333337f, true);

    if (placements.length > 1) {
      const first = intersections[0] as Point;
      const last = intersections[intersections.length - 1] as Point;
      const between = convertUnit(last.sub(first).length(), 'px', unit) * scale;
      text(
        between,
        false,
        first.add(last).div(2).transformed(doc2dt).add(normal.mul(DIMENSION_OFFSET)),
        0x33337f7f,
      );
    }

    // Initial point, then the crossings.
    marker(start_p);
    for (const p of intersections) marker(p.transformed(doc2dt));

    // Since adding goes to the bottom, do all lines last. The main control line:
    line(start_p, end_p, COLOR_PRIMARY);
    const length = Math.abs(end_p.sub(start_p).length());
    line(start_p, new Point(start_p.x + length, start_p.y), COLOR_SECONDARY);
    const arc = angle_arc_points(start_p, end_p, angle_pt, angle);
    if (arc) {
      const curve = new CanvasItemCurve(dt.getCanvasTemp());
      curve.set_coords(...arc);
      curve.set_stroke(COLOR_SECONDARY);
      curve.lower_to_bottom();
      items.push(curve);
    }

    if (placements.length > 1) {
      const first = (intersections[0] as Point).transformed(doc2dt);
      const last = (intersections[intersections.length - 1] as Point).transformed(doc2dt);
      const off = normal.mul(DIMENSION_OFFSET);
      line(first.add(off), last.add(off), COLOR_PRIMARY);
      line(first, first.add(off), COLOR_PRIMARY);
      line(last, last.add(off), COLOR_PRIMARY);
    }

    // call-out lines
    for (const place of placements) line(place.start, place.end, COLOR_SECONDARY);
  }
}
