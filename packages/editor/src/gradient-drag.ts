// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/gradient-drag.cpp, src/gradient-drag.h
/*
 * On-canvas gradient dragging
 *
 * Authors:
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Tavmjong Bah <tavmjong@free.fr>
 *
 * Copyright (C) 2007 Johan Engelen
 * Copyright (C) 2005,2010 Authors
 */
import {
  allPaintTargets,
  C_,
  cssNumber,
  DocumentUndo,
  GrPointType,
  getGradient,
  getGradientCoords,
  N_,
  PaintTarget,
  type SPCSSAttr,
  SPGradient,
  type SPItem,
  SPLinearGradient,
  type SPObject,
  SPRadialGradient,
  type SPStop,
  sp_get_stop_i,
  sp_gradient_get_forked_vector_if_necessary,
  sp_item_gradient_reverse_vector,
  sp_item_gradient_set_coords,
  sp_item_gradient_stop_set_style,
  sp_last_stop,
  sp_vector_add_stop,
  spReprCssAttr,
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssProperty,
  spReprCssPropertyIsUnset,
  spReprCssSetProperty,
  spReprCssUnsetProperty,
  spSvgReadPercentage,
} from '@inkscape-web/core';
import { distance, LineSegment, nearest_time, type Point, type Rect } from '@inkscape-web/geom';
import type { SPDesktop } from './desktop.ts';
import { CanvasItemCtrlType } from './display/control/canvas-item-ctrl.ts';
import { CanvasItemCurve } from './display/control/canvas-item-curve.ts';
import { SPKnot } from './ui/knot/knot.ts';
import type { ModifierState } from './ui/tools/tool-base.ts';

const ICON = 'color-gradient';

// The modifiers of tool-base.ts (not imported: tool-base.ts creates the GrDrag).
const mod_shift = (s: ModifierState) => s.shiftKey;
const mod_ctrl = (s: ModifierState) => s.ctrlKey || s.metaKey;
const mod_alt = (s: ModifierState) => s.altKey;

/** absolute distance between gradient points for them to become a single dragger when the drag is created: */
const MERGE_DIST = 0.1;

/** Canvas item colors (upstream CANVAS_ITEM_COLORS): primary for fill, secondary for stroke. */
const CANVAS_ITEM_PRIMARY = 0x0000ff7f;
const CANVAS_ITEM_SECONDARY = 0xff00007f;

/** knot shapes corresponding to GrPointType enum (in sp-gradient.h) */
const gr_knot_types: Partial<Record<GrPointType, CanvasItemCtrlType>> = {
  [GrPointType.POINT_LG_BEGIN]: CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_SIZER,
  [GrPointType.POINT_LG_END]: CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ROTATE,
  [GrPointType.POINT_LG_MID]: CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_SHAPER,
  [GrPointType.POINT_RG_CENTER]: CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_SIZER,
  [GrPointType.POINT_RG_R1]: CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ROTATE,
  [GrPointType.POINT_RG_R2]: CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ROTATE,
  [GrPointType.POINT_RG_FOCUS]: CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_MARKER,
  [GrPointType.POINT_RG_MID1]: CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_SHAPER,
  [GrPointType.POINT_RG_MID2]: CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_SHAPER,
};

/** Names of the handles, for the tool messages (upstream gr_knot_descr). */
export const gr_knot_descr: Partial<Record<GrPointType, string>> = {
  [GrPointType.POINT_LG_BEGIN]: N_('Linear gradient <b>start</b>'),
  [GrPointType.POINT_LG_END]: N_('Linear gradient <b>end</b>'),
  [GrPointType.POINT_LG_MID]: N_('Linear gradient <b>mid stop</b>'),
  [GrPointType.POINT_RG_CENTER]: N_('Radial gradient <b>center</b>'),
  [GrPointType.POINT_RG_R1]: N_('Radial gradient <b>radius</b>'),
  [GrPointType.POINT_RG_R2]: N_('Radial gradient <b>radius</b>'),
  [GrPointType.POINT_RG_FOCUS]: N_('Radial gradient <b>focus</b>'),
  [GrPointType.POINT_RG_MID1]: N_('Radial gradient <b>mid stop</b>'),
  [GrPointType.POINT_RG_MID2]: N_('Radial gradient <b>mid stop</b>'),
};

const isMid = (t: GrPointType) =>
  t === GrPointType.POINT_LG_MID || t === GrPointType.POINT_RG_MID1 || t === GrPointType.POINT_RG_MID2;

/** One point of one gradient of one item that a dragger moves. */
export class GrDraggable {
  constructor(
    readonly item: SPItem,
    readonly point_type: GrPointType,
    readonly point_i: number,
    readonly fill_or_stroke: PaintTarget,
  ) {}

  getServer(): SPObject | null {
    return this.fill_or_stroke === PaintTarget.FOR_FILL
      ? this.item.style.getFillPaintServer()
      : this.item.style.getStrokePaintServer();
  }

  mayMerge(da2: GrDraggable): boolean {
    if (this.item === da2.item && this.fill_or_stroke === da2.fill_or_stroke) {
      // we must not merge the points of the same gradient!
      const centerFocus =
        (this.point_type === GrPointType.POINT_RG_FOCUS && da2.point_type === GrPointType.POINT_RG_CENTER) ||
        (this.point_type === GrPointType.POINT_RG_CENTER && da2.point_type === GrPointType.POINT_RG_FOCUS);
      if (!centerFocus) return false;
    }
    // disable merging of midpoints.
    return !isMid(this.point_type) && !isMid(da2.point_type);
  }
}

/**
 * A handle on the canvas for the draggables at one point (several gradients may share a point,
 * and the center and focus of a radial gradient are one dragger until they are separated).
 * TODO: snapping, angle snapping with Ctrl (constrainedAngularSnap), tips, mesh handles.
 */
export class GrDragger {
  readonly parent: GrDrag;
  readonly knot: SPKnot;
  point: Point;
  point_original: Point;
  draggables: GrDraggable[] = [];
  readonly #disconnect: (() => void)[];

  constructor(parent: GrDrag, p: Point, draggable: GrDraggable | null) {
    this.parent = parent;
    this.point = p;
    this.point_original = p;
    this.knot = new SPKnot(parent.desktop, '', CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_SIZER);
    this.knot.moveto(p);
    this.knot.show();
    const mid = draggable && isMid(draggable.point_type);
    this.#disconnect = [
      this.knot.moved_signal.connect((_k, ppointer, state) =>
        mid
          ? gr_knot_moved_midpoint_handler(this, ppointer, state)
          : gr_knot_moved_handler(this, ppointer, state),
      ),
      this.knot.click_signal.connect((_k, state) => gr_knot_clicked_handler(this, state)),
      this.knot.ungrabbed_signal.connect((_k, state) => gr_knot_ungrabbed_handler(this, state)),
    ];
    if (draggable) this.addDraggable(draggable);
    this.updateKnotShape();
  }

  destroy(): void {
    for (const off of this.#disconnect) off();
    this.knot.destroy();
    this.draggables = [];
  }

  /** Act upon all draggables of the dragger, setting them to the dragger's point. */
  fireDraggables(write_repr: boolean, scale_radial = false, merging_focus = false): void {
    for (const draggable of this.draggables) {
      // set local_change flag so that selection_changed callback does not regenerate draggers
      this.parent.local_change = true;
      // change gradient, optionally writing to repr; prevent focus from moving if it's snapped
      // to the center, unless it's the first update upon merge when we must snap it to the point
      if (
        merging_focus ||
        !(
          draggable.point_type === GrPointType.POINT_RG_FOCUS &&
          this.isA(draggable.item, GrPointType.POINT_RG_CENTER, draggable.point_i, draggable.fill_or_stroke)
        )
      ) {
        sp_item_gradient_set_coords(
          draggable.item,
          draggable.point_type,
          draggable.point_i,
          this.point,
          draggable.fill_or_stroke,
          write_repr,
          scale_radial,
        );
      }
    }
  }

  /** Whether the dragger has a draggable with this point_type (and item, point_i, fill_or_stroke if given; point_i -1 matches all). */
  isA(point_type: GrPointType): boolean;
  isA(item: SPItem, point_type: GrPointType, fill_or_stroke: PaintTarget): boolean;
  isA(item: SPItem, point_type: GrPointType, point_i: number, fill_or_stroke: PaintTarget): boolean;
  isA(a: SPItem | GrPointType, b?: GrPointType, c?: number | PaintTarget, d?: PaintTarget): boolean {
    if (typeof a === 'number') return this.draggables.some((da) => da.point_type === a);
    const point_i = d === undefined ? -1 : (c as number);
    const fill_or_stroke = d === undefined ? (c as PaintTarget) : d;
    return this.draggables.some(
      (da) =>
        da.point_type === b &&
        (point_i === -1 || da.point_i === point_i) &&
        da.item === a &&
        da.fill_or_stroke === fill_or_stroke,
    );
  }

  mayMerge(other: GrDragger | GrDraggable): boolean {
    if (other === this) return false;
    const others = other instanceof GrDragger ? other.draggables : [other];
    return this.draggables.every((da1) => others.every((da2) => da1.mayMerge(da2)));
  }

  updateKnotShape(): void {
    const last = this.draggables.at(-1);
    if (!last) return;
    const type = gr_knot_types[last.point_type];
    if (type !== undefined) this.knot.ctrl.set_type(type);
  }

  /** Adds a draggable to the dragger. */
  addDraggable(draggable: GrDraggable): void {
    this.draggables.unshift(draggable);
  }

  /** Moves this dragger to the point of the given draggable, acting upon all other draggables. */
  moveThisToDraggable(
    item: SPItem,
    point_type: GrPointType,
    point_i: number,
    fill_or_stroke: PaintTarget,
    write_repr: boolean,
  ): void {
    const dr_first = this.draggables[0];
    if (!dr_first) return;
    this.point = getGradientCoords(
      dr_first.item,
      dr_first.point_type,
      dr_first.point_i,
      dr_first.fill_or_stroke,
    );
    this.point_original = this.point;
    this.knot.moveto(this.point);
    for (const da of this.draggables) {
      if (
        da.item === item &&
        da.point_type === point_type &&
        (point_i === -1 || da.point_i === point_i) &&
        da.fill_or_stroke === fill_or_stroke
      ) {
        continue;
      }
      sp_item_gradient_set_coords(
        da.item,
        da.point_type,
        da.point_i,
        this.point,
        da.fill_or_stroke,
        write_repr,
        false,
      );
    }
  }

  moveOtherToDraggable(
    item: SPItem,
    point_type: GrPointType,
    point_i: number,
    fill_or_stroke: PaintTarget,
    write_repr: boolean,
  ): void {
    const d = this.parent.getDraggerFor(item, point_type, point_i, fill_or_stroke);
    if (d && d !== this) d.moveThisToDraggable(item, point_type, point_i, fill_or_stroke, write_repr);
  }

  /** Moves all midstop draggables that depend on this one. */
  updateMidstopDependencies(draggable: GrDraggable, write_repr: boolean): void {
    const server = draggable.getServer();
    if (!(server instanceof SPGradient)) return;
    const num = server.vector.stops.length;
    if (num <= 2) return;
    for (let i = 1; i < num - 1; i++) {
      if (server instanceof SPLinearGradient) {
        this.moveOtherToDraggable(
          draggable.item,
          GrPointType.POINT_LG_MID,
          i,
          draggable.fill_or_stroke,
          write_repr,
        );
      } else if (server instanceof SPRadialGradient) {
        this.moveOtherToDraggable(
          draggable.item,
          GrPointType.POINT_RG_MID1,
          i,
          draggable.fill_or_stroke,
          write_repr,
        );
        this.moveOtherToDraggable(
          draggable.item,
          GrPointType.POINT_RG_MID2,
          i,
          draggable.fill_or_stroke,
          write_repr,
        );
      }
    }
  }

  /** Moves all draggables that depend on this one. */
  updateDependencies(write_repr: boolean): void {
    for (const draggable of this.draggables) {
      const { item, fill_or_stroke } = draggable;
      const other = (type: GrPointType, i: number) =>
        this.moveOtherToDraggable(item, type, i, fill_or_stroke, write_repr);
      switch (draggable.point_type) {
        case GrPointType.POINT_LG_BEGIN:
          other(GrPointType.POINT_LG_END, -1);
          this.updateMidstopDependencies(draggable, write_repr);
          break;
        case GrPointType.POINT_LG_END:
          other(GrPointType.POINT_LG_BEGIN, 0);
          this.updateMidstopDependencies(draggable, write_repr);
          break;
        case GrPointType.POINT_RG_R2:
          other(GrPointType.POINT_RG_R1, -1);
          other(GrPointType.POINT_RG_FOCUS, -1);
          this.updateMidstopDependencies(draggable, write_repr);
          break;
        case GrPointType.POINT_RG_R1:
          other(GrPointType.POINT_RG_R2, -1);
          other(GrPointType.POINT_RG_FOCUS, -1);
          this.updateMidstopDependencies(draggable, write_repr);
          break;
        case GrPointType.POINT_RG_CENTER:
          other(GrPointType.POINT_RG_R1, -1);
          other(GrPointType.POINT_RG_R2, -1);
          other(GrPointType.POINT_RG_FOCUS, -1);
          this.updateMidstopDependencies(draggable, write_repr);
          break;
        case GrPointType.POINT_RG_MID1:
          other(GrPointType.POINT_RG_MID2, draggable.point_i);
          break;
        case GrPointType.POINT_RG_MID2:
          other(GrPointType.POINT_RG_MID1, draggable.point_i);
          break;
        default:
          break;
      }
    }
  }

  /** Draw this dragger as selected. */
  select(): void {
    this.knot.selectKnot(true);
  }
  /** Draw this dragger as normal (deselected). */
  deselect(): void {
    this.knot.selectKnot(false);
  }
  isSelected(): boolean {
    return this.parent.selected.has(this);
  }
}

/** A gradient line on the canvas, for picking (the tool double click adds a stop on it). */
export interface ItemCurve {
  item: SPItem;
  curve: CanvasItemCurve;
  is_fill: boolean;
  p1: Point;
  p2: Point;
}

/**
 * The draggers of the gradients of the selected items, and the gradient lines (upstream GrDrag).
 * Rebuilt when the selection changes, or is modified other than by the draggers (local_change).
 * TODO: mesh gradients, arrow key moves (key_press_handler), the levels for snapping, the
 * style query (fill color of the selected stops for the Fill and Stroke dialog).
 */
export class GrDrag {
  readonly desktop: SPDesktop;
  draggers: GrDragger[] = [];
  readonly selected = new Set<GrDragger>();
  item_curves: ItemCurve[] = [];
  /** Set by the draggers when they change the gradients, so that the modified selection does not rebuild them. */
  local_change = false;
  keep_selection = false;
  #grabbed: GrDragger | null = null;
  readonly #disconnect: (() => void)[];

  constructor(desktop: SPDesktop) {
    this.desktop = desktop;
    const selection = desktop.getSelection();
    this.#disconnect = [
      selection.connectChanged(() => {
        this.updateDraggers();
        this.updateLines();
      }),
      selection.connectModified(() => {
        if (this.local_change) this.local_change = false;
        else this.updateDraggers();
        this.updateLines();
      }),
      desktop.connectSetStyle((css, switch_style) => this.styleSet(css, switch_style)),
    ];
    this.updateDraggers();
    this.updateLines();
  }

  destroy(): void {
    for (const off of this.#disconnect) off();
    this.deselect_all();
    for (const d of this.draggers) d.destroy();
    this.draggers = [];
    for (const c of this.item_curves) c.curve.unlink();
    this.item_curves = [];
  }

  isNonEmpty(): boolean {
    return this.draggers.length > 0;
  }
  numDraggers(): number {
    return this.draggers.length;
  }
  numSelected(): number {
    return this.selected.size;
  }
  hasSelection(): boolean {
    return this.selected.size > 0;
  }

  /**
   * Set the color of the selected stops from a style that is applied to the desktop (upstream
   * styleSet). Returns true if the style was used, so that it does not go to the objects.
   */
  styleSet(css: SPCSSAttr, switch_style: boolean): boolean {
    if (!this.selected.size) return false;
    // Do not allow the stroke setter to be confused by the gradient selector
    if (
      css.attribute('stroke') !== null &&
      css.attribute('color') === null &&
      css.attribute('fill') === null
    ) {
      return false;
    }
    const stop = spReprCssAttrNew();
    // any of color properties, in order of increasing priority:
    for (const name of ['flood-color', 'lighting-color', 'color']) {
      const v = css.attribute(name);
      if (v !== null) spReprCssSetProperty(stop, 'stop-color', v);
    }
    const fill = css.attribute('fill');
    if (fill !== null && fill !== 'none') spReprCssSetProperty(stop, 'stop-color', fill);
    const stopColor = css.attribute('stop-color');
    if (stopColor !== null) spReprCssSetProperty(stop, 'stop-color', stopColor);
    // TODO: makeStopSafeColor (url() and currentColor values).
    if (
      !spReprCssPropertyIsUnset(stop, 'stop-color') &&
      spReprCssProperty(stop, 'stop-color', '').startsWith('url')
    ) {
      spReprCssUnsetProperty(stop, 'stop-color');
    }
    const stopOpacity = css.attribute('stop-opacity');
    if (stopOpacity !== null) {
      // direct setting of stop-opacity has priority
      spReprCssSetProperty(stop, 'stop-opacity', stopOpacity);
    } else {
      // multiply all opacity properties:
      let accumulated = 1.0;
      for (const name of ['flood-opacity', 'opacity', 'stroke-opacity', 'fill-opacity']) {
        accumulated *= spSvgReadPercentage(css.attribute(name), 1.0);
      }
      spReprCssSetProperty(stop, 'stop-opacity', cssNumber(accumulated));
      const stroke = css.attribute('stroke');
      if ((fill === 'none' && stroke === null) || (stroke === 'none' && fill === null)) {
        // if a single fill/stroke property is set to none, don't change color, set opacity to 0
        spReprCssSetProperty(stop, 'stop-opacity', '0');
      }
    }
    if (!stop.attributeList().length) return false; // nothing for us here, pass it on

    for (const d of this.selected) {
      for (const draggable of d.draggables) {
        const gradient = getGradient(draggable.item, draggable.fill_or_stroke);
        // for linear and radial gradients F&S dialog deals with stops' colors;
        // don't handle style notifications, or else it will not be possible to switch
        // object style back to solid color
        if (switch_style && (gradient instanceof SPLinearGradient || gradient instanceof SPRadialGradient))
          continue;
        this.local_change = true;
        sp_item_gradient_stop_set_style(
          draggable.item,
          draggable.point_type,
          draggable.point_i,
          draggable.fill_or_stroke,
          stop,
        );
      }
    }
    return this.local_change; // true if handled
  }

  /** Add a stop to the gradient of item near mouse_p (desktop coordinates), if the point is near its line. */
  addStopNearPoint(item: SPItem, mouse_p: Point, tolerance: number): SPStop | null {
    for (const fill_or_stroke of allPaintTargets()) {
      const gradient = getGradient(item, fill_or_stroke);
      const lines: [GrPointType, GrPointType][] =
        gradient instanceof SPLinearGradient
          ? [[GrPointType.POINT_LG_BEGIN, GrPointType.POINT_LG_END]]
          : gradient instanceof SPRadialGradient
            ? [
                [GrPointType.POINT_RG_CENTER, GrPointType.POINT_RG_R1],
                [GrPointType.POINT_RG_CENTER, GrPointType.POINT_RG_R2],
              ]
            : [];
      for (const [from, to] of lines) {
        const begin = getGradientCoords(item, from, 0, fill_or_stroke);
        const end = getGradientCoords(item, to, 0, fill_or_stroke);
        const ls = new LineSegment(begin, end);
        const nearest = ls.pointAt(nearest_time(mouse_p, ls));
        if (distance(mouse_p, nearest) >= tolerance) continue;
        // calculate the new stop offset
        const new_stop_offset = distance(begin, nearest) / distance(begin, end);
        const vector = sp_gradient_get_forked_vector_if_necessary(gradient as SPGradient, false);
        let prev_stop = vector.getFirstStop();
        let next_stop = prev_stop?.getNextStop() ?? null;
        while (prev_stop && next_stop && next_stop.offset < new_stop_offset) {
          prev_stop = next_stop;
          next_stop = next_stop.getNextStop();
        }
        if (!next_stop) {
          // logical error: the endstop should have offset 1 and should always be more than this offset here
          return null;
        }
        const newstop = sp_vector_add_stop(vector, prev_stop, next_stop, new_stop_offset);
        (gradient as SPGradient).ensureVector();
        this.updateDraggers();
        return newstop;
      }
    }
    return null;
  }

  // Selection of draggers

  /** Deselect all stops/draggers (private). */
  deselect_all(): void {
    for (const d of this.selected) d.deselect();
    this.selected.clear();
  }

  /** Deselect all stops/draggers (public; emits signal). */
  deselectAll(): void {
    this.deselect_all();
    this.desktop.emit_gradient_stop_selected(null);
  }

  selectAll(): void {
    for (const d of this.draggers) this.setSelected(d, true, true);
  }

  /** Select all stops/draggers that match the coords. */
  selectByCoords(coords: readonly Point[]): void {
    for (const d of this.draggers) {
      if (coords.some((c) => distance(d.point, c) < 1e-4)) this.setSelected(d, true, true);
    }
  }

  /** Select draggers by stop */
  selectByStop(stop: SPStop | null, add_to_selection = true, override = true): void {
    for (const dragger of this.draggers) {
      for (const d of dragger.draggables) {
        const gradient = getGradient(d.item, d.fill_or_stroke);
        const vector = gradient?.getVector(false);
        if (vector && this.#stopOf(vector, d) === stop) this.setSelected(dragger, add_to_selection, override);
      }
    }
  }

  /** Select all stops/draggers that fall within the rect. */
  selectRect(r: Rect): void {
    for (const d of this.draggers) if (r.contains(d.point)) this.setSelected(d, true, true);
  }

  /** The stop of dragger in gradient, or null if the dragger has several stops (upstream getStop). */
  getStop(dragger: GrDragger | null, gradient: SPGradient | null): SPStop | null {
    if (!dragger || !gradient) return null;
    const vector = gradient.getVector(false);
    let n = 0;
    let stop: SPStop | null = null;
    // For all draggables of dragger
    for (const draggable of dragger.draggables) {
      if (draggable.point_type !== GrPointType.POINT_RG_FOCUS) {
        n++;
        if (n > 1) break;
      }
      stop = this.#stopOf(vector, draggable);
    }
    // Multiple stops selected
    return n > 1 ? null : stop;
  }

  #stopOf(vector: SPGradient, draggable: GrDraggable): SPStop | null {
    switch (draggable.point_type) {
      case GrPointType.POINT_LG_MID:
      case GrPointType.POINT_RG_MID1:
      case GrPointType.POINT_RG_MID2:
        return sp_get_stop_i(vector, draggable.point_i);
      case GrPointType.POINT_LG_END:
      case GrPointType.POINT_RG_R1:
      case GrPointType.POINT_RG_R2:
        return sp_last_stop(vector);
      default:
        return vector.getFirstStop();
    }
  }

  /**
   * Select a dragger. add_to_selection keeps the other selected draggers; then override always
   * selects it, otherwise its selected status is toggled.
   */
  setSelected(dragger: GrDragger, add_to_selection = false, override = true): void {
    let seldragger: GrDragger | null = null;
    if (add_to_selection) {
      if (override || !this.selected.has(dragger)) {
        this.selected.add(dragger);
        dragger.select();
        seldragger = dragger;
      } else {
        // toggle
        this.selected.delete(dragger);
        dragger.deselect();
        // select the dragger that is first in the list
        seldragger = this.selected.values().next().value ?? null;
      }
    } else {
      this.deselect_all();
      this.selected.add(dragger);
      dragger.select();
      seldragger = dragger;
    }
    if (seldragger) {
      const d = seldragger.draggables[0];
      const stop = d ? this.getStop(seldragger, getGradient(d.item, d.fill_or_stroke)) : null;
      this.desktop.emit_gradient_stop_selected(stop);
    }
  }

  /** Deselect a dragger. */
  setDeselected(dragger: GrDragger): void {
    if (this.selected.delete(dragger)) dragger.deselect();
    this.desktop.emit_gradient_stop_selected(null);
  }

  // Draggers and lines

  getDraggerFor(
    item: SPItem,
    point_type: GrPointType,
    point_i: number,
    fill_or_stroke: PaintTarget,
  ): GrDragger | null {
    return (
      this.draggers.find((dragger) =>
        dragger.draggables.some(
          (da2) =>
            da2.item === item &&
            da2.point_type === point_type &&
            (point_i === -1 || da2.point_i === point_i) && // -1 means this does not matter
            da2.fill_or_stroke === fill_or_stroke,
        ),
      ) ?? null
    );
  }

  /** Create a line from p1 to p2 (desktop coordinates) and add it to the curves list. */
  addLine(item: SPItem, p1: Point, p2: Point, fill_or_stroke: PaintTarget): void {
    const curve = new CanvasItemCurve(this.desktop.getCanvasControls());
    curve.set_coords(p1, p2);
    curve.set_stroke(fill_or_stroke === PaintTarget.FOR_FILL ? CANVAS_ITEM_PRIMARY : CANVAS_ITEM_SECONDARY);
    // The lines go below the knots.
    curve.lower_to_bottom();
    this.item_curves.push({ item, curve, is_fill: fill_or_stroke === PaintTarget.FOR_FILL, p1, p2 });
  }

  /**
   * If there already exists a dragger within MERGE_DIST of p, add the draggable to it; otherwise
   * create new dragger and add it to draggers list.
   */
  addDragger(draggable: GrDraggable): GrDragger {
    const p = getGradientCoords(
      draggable.item,
      draggable.point_type,
      draggable.point_i,
      draggable.fill_or_stroke,
    );
    for (const dragger of this.draggers) {
      if (dragger.mayMerge(draggable) && distance(dragger.point, p) < MERGE_DIST) {
        // distance is small, merge this draggable into dragger, no need to create new dragger
        dragger.addDraggable(draggable);
        dragger.updateKnotShape();
        return dragger;
      }
    }
    const new_dragger = new GrDragger(this, p, draggable);
    this.draggers.push(new_dragger);
    return new_dragger;
  }

  /** Add draggers for the radial gradient rg on item. */
  addDraggersRadial(rg: SPRadialGradient, item: SPItem, fill_or_stroke: PaintTarget): void {
    rg.ensureVector();
    const add = (type: GrPointType, i: number) =>
      this.addDragger(new GrDraggable(item, type, i, fill_or_stroke));
    add(GrPointType.POINT_RG_CENTER, 0);
    const num = rg.vector.stops.length;
    for (let i = 1; i < num - 1; i++) add(GrPointType.POINT_RG_MID1, i);
    add(GrPointType.POINT_RG_R1, num - 1);
    for (let i = 1; i < num - 1; i++) add(GrPointType.POINT_RG_MID2, i);
    add(GrPointType.POINT_RG_R2, num - 1);
    add(GrPointType.POINT_RG_FOCUS, 0);
  }

  /** Add draggers for the linear gradient lg on item. */
  addDraggersLinear(lg: SPLinearGradient, item: SPItem, fill_or_stroke: PaintTarget): void {
    lg.ensureVector();
    const add = (type: GrPointType, i: number) =>
      this.addDragger(new GrDraggable(item, type, i, fill_or_stroke));
    add(GrPointType.POINT_LG_BEGIN, 0);
    const num = lg.vector.stops.length;
    for (let i = 1; i < num - 1; i++) add(GrPointType.POINT_LG_MID, i);
    add(GrPointType.POINT_LG_END, num - 1);
  }

  /**
   * Grab the knot of the dragger with this draggable; used by the gradient tool. The tool sends
   * the following motion to grabbedMotion() and the release to grabbedRelease(), so that the drag
   * that creates a gradient goes on as a drag of its end (upstream SPKnot::startDragging).
   */
  grabKnot(item: SPItem, point_type: GrPointType, point_i: number, fill_or_stroke: PaintTarget): void {
    this.#grabbed = this.getDraggerFor(item, point_type, point_i, fill_or_stroke);
  }

  /** Move the grabbed knot to p (desktop coordinates). Returns false if no knot is grabbed. */
  grabbedMotion(p: Point, state: ModifierState): boolean {
    const dragger = this.#grabbed;
    if (!dragger || !this.draggers.includes(dragger)) return false;
    dragger.knot.requestPosition(p, state);
    return true;
  }

  /** Release the grabbed knot. Returns false if no knot is grabbed. */
  grabbedRelease(state: ModifierState): boolean {
    const dragger = this.#grabbed;
    this.#grabbed = null;
    if (!dragger || !this.draggers.includes(dragger)) return false;
    dragger.knot.ungrabbed_signal.emit(dragger.knot, state);
    return true;
  }

  /**
   * Regenerates the draggers list from the current selection; is called when selection is
   * changed or modified, also when a radial dragger needs to update positions of other draggers
   * in the gradient.
   */
  updateDraggers(): void {
    this.selected.clear();
    // delete old draggers
    for (const dragger of this.draggers) dragger.destroy();
    this.draggers = [];
    for (const item of this.desktop.getSelection().items()) {
      for (const fill_or_stroke of allPaintTargets()) {
        const gradient = getGradient(item, fill_or_stroke);
        // Suppress "gradientness" of solid paint
        if (!gradient || gradient.isSolid() || gradient.getVector().isSolid()) continue;
        if (gradient instanceof SPLinearGradient) this.addDraggersLinear(gradient, item, fill_or_stroke);
        else if (gradient instanceof SPRadialGradient) this.addDraggersRadial(gradient, item, fill_or_stroke);
      }
    }
  }

  /**
   * Regenerates the lines list from the current selection; is called on each move of a dragger,
   * so that lines are always in sync with the actual gradient.
   */
  updateLines(): void {
    for (const c of this.item_curves) c.curve.unlink();
    this.item_curves = [];
    for (const item of this.desktop.getSelection().items()) {
      for (const fill_or_stroke of allPaintTargets()) {
        const gradient = getGradient(item, fill_or_stroke);
        if (!gradient || gradient.isSolid() || gradient.getVector().isSolid()) continue;
        const coords = (type: GrPointType) => getGradientCoords(item, type, 0, fill_or_stroke);
        if (gradient instanceof SPLinearGradient) {
          this.addLine(
            item,
            coords(GrPointType.POINT_LG_BEGIN),
            coords(GrPointType.POINT_LG_END),
            fill_or_stroke,
          );
        } else if (gradient instanceof SPRadialGradient) {
          const center = coords(GrPointType.POINT_RG_CENTER);
          this.addLine(item, center, coords(GrPointType.POINT_RG_R1), fill_or_stroke);
          this.addLine(item, center, coords(GrPointType.POINT_RG_R2), fill_or_stroke);
        }
      }
    }
  }

  /** Reverse the gradients of the first selected dragger. */
  selected_reverse_vector(): void {
    const first = this.selected.values().next().value;
    if (!first) return;
    for (const draggable of first.draggables)
      sp_item_gradient_reverse_vector(draggable.item, draggable.fill_or_stroke);
  }

  /**
   * Delete the stops of the selected draggers (only the first with just_one). An end stop moves
   * the end of the gradient to the next stop; a gradient with two stops is replaced by the color
   * of the other stop.
   */
  deleteSelected(just_one = false): void {
    if (!this.selected.size) return;
    let document = null;
    interface StopInfo {
      spstop: SPStop;
      draggable: GrDraggable;
      gradient: SPGradient;
      vector: SPGradient;
    }
    const midstoplist: SPStop[] = []; // list of stops that must be deleted (will be deleted first)
    const endstoplist: StopInfo[] = []; // list of stops that must be deleted
    for (const dragger of [...this.selected]) {
      for (const draggable of dragger.draggables) {
        const gradient = getGradient(draggable.item, draggable.fill_or_stroke);
        if (!gradient) continue;
        const vector = sp_gradient_get_forked_vector_if_necessary(gradient, false);
        switch (draggable.point_type) {
          case GrPointType.POINT_LG_MID:
          case GrPointType.POINT_RG_MID1:
          case GrPointType.POINT_RG_MID2: {
            const stop = sp_get_stop_i(vector, draggable.point_i);
            // check if already present in list. (e.g. when both RG_MID1 and RG_MID2 were selected)
            if (stop && !midstoplist.includes(stop)) midstoplist.push(stop);
            break;
          }
          case GrPointType.POINT_LG_BEGIN:
          case GrPointType.POINT_LG_END:
          case GrPointType.POINT_RG_CENTER:
          case GrPointType.POINT_RG_R1:
          case GrPointType.POINT_RG_R2: {
            const first =
              draggable.point_type === GrPointType.POINT_LG_BEGIN ||
              draggable.point_type === GrPointType.POINT_RG_CENTER;
            const stop = first ? vector.getFirstStop() : sp_last_stop(vector);
            // check if already present in list. (e.g. when both R1 and R2 were selected)
            if (stop && !endstoplist.some((i) => i.spstop === stop)) {
              endstoplist.push({ spstop: stop, draggable, gradient, vector });
            }
            break;
          }
          default:
            break;
        }
      }
      this.selected.delete(dragger);
      if (just_one) break; // iterate once if just_one is set.
    }

    for (const stop of midstoplist) {
      document = stop.document;
      stop.getRepr().parent()?.removeChild(stop.getRepr());
    }

    const setOffset = (stop: SPStop, offset: number) => {
      stop.offset = offset;
      stop.getRepr().setAttribute('offset', cssNumber(offset));
    };
    /** Rescale the offsets of the mid stops so that they do not move on the canvas. */
    const rescaleMids = (vector: SPGradient, map: (offset: number) => number) => {
      const laststop = sp_last_stop(vector);
      for (
        let stop = vector.getFirstStop()?.getNextStop() ?? null;
        stop && stop !== laststop;
        stop = stop.getNextStop()
      ) {
        setOffset(stop, map(stop.offset));
      }
    };

    for (const stopinfo of endstoplist) {
      const { spstop, draggable, gradient, vector } = stopinfo;
      document = spstop.document;
      // 2 is the minimum, cannot delete more than that without deleting the whole vector
      // cannot use vector->vector.stops.size() because the vector might be invalidated by deletion of a midstop
      const len = vector.children.filter((c) => c.getRepr().name() === 'svg:stop').length;
      if (len > 2) {
        const repr = gradient.getRepr();
        switch (draggable.point_type) {
          case GrPointType.POINT_LG_BEGIN: {
            vector.getRepr().removeChild(spstop.getRepr());
            const lg = gradient as SPLinearGradient;
            const first = vector.getFirstStop() as SPStop;
            const offset = first.offset;
            const x = lg.x1.computed + offset * (lg.x2.computed - lg.x1.computed);
            const y = lg.y1.computed + offset * (lg.y2.computed - lg.y1.computed);
            lg.x1.computed = x;
            lg.y1.computed = y;
            repr.setAttributeSvgDouble('x1', x);
            repr.setAttributeSvgDouble('y1', y);
            setOffset(first, 0);
            // iterate through midstops to set new offset values such that they won't move on canvas.
            rescaleMids(vector, (o) => (o - offset) / (1 - offset));
            break;
          }
          case GrPointType.POINT_LG_END: {
            vector.getRepr().removeChild(spstop.getRepr());
            const lg = gradient as SPLinearGradient;
            const laststop = sp_last_stop(vector) as SPStop;
            const offset = laststop.offset;
            const x = lg.x1.computed + offset * (lg.x2.computed - lg.x1.computed);
            const y = lg.y1.computed + offset * (lg.y2.computed - lg.y1.computed);
            lg.x2.computed = x;
            lg.y2.computed = y;
            repr.setAttributeSvgDouble('x2', x);
            repr.setAttributeSvgDouble('y2', y);
            setOffset(laststop, 1);
            rescaleMids(vector, (o) => o / offset);
            break;
          }
          case GrPointType.POINT_RG_CENTER: {
            const newfirst = spstop.getNextStop();
            if (newfirst) setOffset(newfirst, 0);
            vector.getRepr().removeChild(spstop.getRepr());
            break;
          }
          case GrPointType.POINT_RG_R1:
          case GrPointType.POINT_RG_R2: {
            vector.getRepr().removeChild(spstop.getRepr());
            const rg = gradient as SPRadialGradient;
            const laststop = sp_last_stop(vector) as SPStop;
            const offset = laststop.offset;
            rg.r.computed *= offset;
            repr.setAttributeSvgDouble('r', rg.r.computed);
            setOffset(laststop, 1);
            rescaleMids(vector, (o) => o / offset);
            break;
          }
          default:
            break;
        }
      } else {
        // delete the gradient from the object. set fill to unset  FIXME: set to fill of unselected node?
        const css = spReprCssAttrNew();
        const property = draggable.fill_or_stroke === PaintTarget.FOR_FILL ? 'fill' : 'stroke';
        // stopinfo->spstop is the selected stop
        let unselectedrepr = vector.getRepr().firstChild();
        if (unselectedrepr === spstop.getRepr()) unselectedrepr = unselectedrepr.next();
        if (!unselectedrepr) {
          spReprCssUnsetProperty(css, property);
        } else {
          const stopcss = spReprCssAttr(unselectedrepr, 'style');
          spReprCssSetProperty(css, property, spReprCssProperty(stopcss, 'stop-color', 'inkscape:unset'));
          spReprCssSetProperty(css, `${property}-opacity`, spReprCssProperty(stopcss, 'stop-opacity', '1'));
        }
        spReprCssChange(draggable.item.getRepr(), css, 'style');
      }
    }

    if (document) DocumentUndo.done(document, C_('Undo', 'Delete gradient stop(s)'), ICON);
  }
}

// Knot handlers ---------------------------------------------------------------------------------

/** Called when a dragger knot moves (not a mid stop): merge with another dragger, or move the gradient points. */
function gr_knot_moved_handler(dragger: GrDragger, ppointer: Point, state: ModifierState): void {
  const drag = dragger.parent;
  const p = ppointer;
  if (mod_shift(state)) {
    // with Shift; unsnap if we carry more than one draggable
    if (dragger.draggables.length > 1) {
      // create a new dragger
      const dr_new = new GrDragger(drag, dragger.point, null);
      drag.draggers.unshift(dr_new);
      // relink to it all but the first draggable in the list
      for (const draggable of dragger.draggables.slice(1)) dr_new.addDraggable(draggable);
      dr_new.updateKnotShape();
      dragger.draggables = dragger.draggables.slice(0, 1);
      dragger.updateKnotShape();
    }
  } else if (!mod_ctrl(state)) {
    // without Shift or Ctrl; see if we need to snap to another dragger
    // TODO: the snap distance from the snap preferences (getObjectTolerance).
    const snap_dist = 10 / drag.desktop.current_zoom();
    for (const d_new of drag.draggers) {
      if (dragger.mayMerge(d_new) && distance(d_new.point, p) < snap_dist) {
        // Merge draggers:
        for (const draggable of dragger.draggables) {
          // copy draggable to d_new:
          d_new.addDraggable(
            new GrDraggable(
              draggable.item,
              draggable.point_type,
              draggable.point_i,
              draggable.fill_or_stroke,
            ),
          );
        }
        // unlink and delete this dragger
        drag.draggers = drag.draggers.filter((d) => d !== dragger);
        drag.selected.delete(dragger);
        dragger.destroy();
        // update the new merged dragger
        d_new.fireDraggables(true, false, true);
        drag.updateLines();
        drag.setSelected(d_new);
        d_new.updateKnotShape();
        d_new.updateDependencies(true);
        DocumentUndo.done(drag.desktop.getDocument(), C_('Undo', 'Merge gradient handles'), ICON);
        return;
      }
    }
  }
  // TODO: snapping, and angle snapping with Ctrl (constrainedAngularSnap).

  drag.keep_selection = drag.selected.has(dragger);
  const scale_radial = mod_ctrl(state) && mod_shift(state); // GRADIENT_LINK_HANDLES: Ctrl+Shift
  if (drag.keep_selection) {
    const diff = p.sub(dragger.point);
    selected_move_nowrite(drag, diff, scale_radial);
  } else {
    dragger.point = p;
    dragger.fireDraggables(false, scale_radial);
    dragger.updateDependencies(false);
  }
  drag.updateLines();
}

/** Move the selected end draggers by delta without writing (upstream selected_move_nowrite). */
function selected_move_nowrite(drag: GrDrag, delta: Point, scale_radial: boolean): void {
  for (const d of drag.selected) {
    if (
      d.isA(GrPointType.POINT_LG_MID) ||
      d.isA(GrPointType.POINT_RG_MID1) ||
      d.isA(GrPointType.POINT_RG_MID2)
    ) {
      continue;
    }
    // Moving an rg center moves its focus and radii as well.
    // therefore, if this is a focus or radius and if selection
    // contains the center as well, do not move this one
    const first = d.draggables[0];
    if (
      first &&
      (d.isA(GrPointType.POINT_RG_R1) ||
        d.isA(GrPointType.POINT_RG_R2) ||
        (d.isA(GrPointType.POINT_RG_FOCUS) && !d.isA(GrPointType.POINT_RG_CENTER))) &&
      [...drag.selected].some((d_new) =>
        d_new.isA(first.item, GrPointType.POINT_RG_CENTER, 0, first.fill_or_stroke),
      )
    ) {
      continue;
    }
    d.point = d.point.add(delta);
    d.point_original = d.point;
    d.knot.moveto(d.point);
    d.fireDraggables(false, scale_radial);
    d.updateDependencies(false);
  }
}

/** The points between which a mid stop dragger (and its selected neighbors) may move (upstream gr_midpoint_limits). */
function gr_midpoint_limits(dragger: GrDragger, server: SPObject | null, moving: GrDragger[]) {
  const drag = dragger.parent;
  // a midpoint dragger can (logically) only contain one GrDraggable
  const draggable = dragger.draggables[0] as GrDraggable;
  const { item, point_type, fill_or_stroke } = draggable;
  // get begin and end points between which dragging is allowed:
  // the draglimits are between knot(lowest_i - 1) and knot(highest_i + 1)
  moving.push(dragger);
  let lowest_i = draggable.point_i;
  let highest_i = draggable.point_i;
  let lowest_dragger = dragger;
  let highest_dragger = dragger;
  if (dragger.isSelected()) {
    for (;;) {
      const d_add = drag.getDraggerFor(item, point_type, lowest_i - 1, fill_or_stroke);
      if (!d_add || !drag.selected.has(d_add)) break;
      lowest_i--;
      moving.unshift(d_add);
      lowest_dragger = d_add;
    }
    for (;;) {
      const d_add = drag.getDraggerFor(item, point_type, highest_i + 1, fill_or_stroke);
      if (!d_add || !drag.selected.has(d_add)) break;
      highest_i++;
      moving.push(d_add);
      highest_dragger = d_add;
    }
  }
  let begin = dragger.point;
  let end = dragger.point;
  if (server instanceof SPGradient) {
    const num = server.vector.stops.length;
    const linear = server instanceof SPLinearGradient;
    const startType = linear ? GrPointType.POINT_LG_BEGIN : GrPointType.POINT_RG_CENTER;
    const endType = linear
      ? GrPointType.POINT_LG_END
      : point_type === GrPointType.POINT_RG_MID1
        ? GrPointType.POINT_RG_R1
        : GrPointType.POINT_RG_R2;
    const d_begin =
      lowest_i === 1
        ? drag.getDraggerFor(item, startType, 0, fill_or_stroke)
        : drag.getDraggerFor(item, point_type, lowest_i - 1, fill_or_stroke);
    if (d_begin) begin = d_begin.point;
    const d_end =
      drag.getDraggerFor(item, point_type, highest_i + 1, fill_or_stroke) ??
      drag.getDraggerFor(item, endType, num - 1, fill_or_stroke);
    if (d_end) end = d_end.point;
  }
  const low_lim = dragger.point.sub(lowest_dragger.point.sub(begin));
  const high_lim = dragger.point.sub(highest_dragger.point.sub(end));
  return { begin, end, low_lim, high_lim };
}

/** Called when a midpoint knot is dragged: it moves along the gradient line, between its neighbors. */
function gr_knot_moved_midpoint_handler(dragger: GrDragger, ppointer: Point, state: ModifierState): void {
  const drag = dragger.parent;
  // FIXME: take from prefs
  const snap_fraction = 0.1;
  const draggable = dragger.draggables[0];
  if (!draggable) return;
  const moving: GrDragger[] = [];
  const { low_lim, high_lim } = gr_midpoint_limits(dragger, draggable.getServer(), moving);
  const ls = new LineSegment(low_lim, high_lim);
  let t = nearest_time(ppointer, ls);
  // with Ctrl, snap to fractions of the line (FREEHAND_ANGLE_SNAPPING)
  if (mod_ctrl(state)) t = Math.round(t / snap_fraction) * snap_fraction;
  const p = ls.pointAt(t);
  const displacement = p.sub(dragger.point);
  // TODO: Alt (TRANS_INCREMENT) moves the neighbors with a cosine profile.
  for (const drg of moving) {
    drg.point = drg.point.add(displacement);
    drg.knot.moveto(drg.point);
    drg.fireDraggables(false);
    drg.updateDependencies(false);
  }
  drag.keep_selection = dragger.isSelected();
}

/** Called when the mouse releases a dragger knot; writes the gradient to the repr, updates other draggers if needed. */
function gr_knot_ungrabbed_handler(dragger: GrDragger, state: ModifierState): void {
  const drag = dragger.parent;
  dragger.point = dragger.knot.pos;
  dragger.point_original = dragger.point;
  const scale_radial = mod_ctrl(state) && mod_shift(state);
  dragger.fireDraggables(true, scale_radial);
  for (const d of drag.selected) if (d !== dragger) d.fireDraggables(true);
  // make this dragger selected
  if (!drag.keep_selection) drag.setSelected(dragger);
  drag.keep_selection = false;
  dragger.updateDependencies(true);
  // we did an undoable action
  DocumentUndo.done(drag.desktop.getDocument(), C_('Undo', 'Move gradient handle'), ICON);
}

/** Called when a dragger knot is clicked; selects the dragger, or with Ctrl+Alt deletes its stop. */
function gr_knot_clicked_handler(dragger: GrDragger, state: ModifierState): void {
  const draggable = dragger.draggables[0];
  if (!draggable) return;
  if (mod_ctrl(state) && mod_alt(state)) {
    // NODE_DELETE: delete this knot from vector
    const gradient = getGradient(draggable.item, draggable.fill_or_stroke)?.getVector();
    if (!gradient || gradient.vector.stops.length <= 2) return; // 2 is the minimum
    let stop: SPStop | null = null;
    // if we delete first or last stop, move the next/previous to the edge
    switch (draggable.point_type) {
      case GrPointType.POINT_LG_BEGIN:
      case GrPointType.POINT_RG_CENTER: {
        stop = gradient.getFirstStop();
        const next = stop?.getNextStop();
        if (next) {
          next.offset = 0;
          next.getRepr().setAttribute('offset', '0');
        }
        break;
      }
      case GrPointType.POINT_LG_END:
      case GrPointType.POINT_RG_R1:
      case GrPointType.POINT_RG_R2: {
        stop = sp_last_stop(gradient);
        const prev = stop?.getPrevStop();
        if (prev) {
          prev.offset = 1;
          prev.getRepr().setAttribute('offset', '1');
        }
        break;
      }
      case GrPointType.POINT_LG_MID:
      case GrPointType.POINT_RG_MID1:
      case GrPointType.POINT_RG_MID2:
        stop = sp_get_stop_i(gradient, draggable.point_i);
        break;
      default:
        return;
    }
    if (!stop) return;
    gradient.getRepr().removeChild(stop.getRepr());
    DocumentUndo.done(gradient.document, C_('Undo', 'Delete gradient stop'), ICON);
  } else {
    // select the dragger
    dragger.point_original = dragger.point;
    if (mod_shift(state)) dragger.parent.setSelected(dragger, true, false);
    else dragger.parent.setSelected(dragger);
  }
}
