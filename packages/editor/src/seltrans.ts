// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/seltrans.cpp, src/seltrans.h
/*
 * Helper object for transforming selected items.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Carl Hetherington <inkscape@carlh.net>
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 1999-2014 Authors
 */
import {
  _,
  BBoxType,
  C_,
  DocumentUndo,
  Preferences,
  type Selection,
  type SPItem,
  SPRoot,
} from '@inkscape-web/core';
import { Affine, type OptRect, Point, Scale, Translate } from '@inkscape-web/geom';
import type { SPDesktop } from './desktop.ts';
import { CanvasItemCtrlType } from './display/control/canvas-item-ctrl.ts';
import { SPAnchorType } from './enums.ts';
import { SelCue } from './selcue.ts';
import { hands, type SPSelTransHandle, SPSelTransType } from './seltrans-handles.ts';
import { SPKnot } from './ui/knot/knot.ts';
import { type ModifierState, mod_alt, mod_ctrl, mod_shift } from './ui/tools/tool-base.ts';

export enum SelTransState {
  STATE_SCALE,
  STATE_ROTATE,
  STATE_ALIGN,
}

export enum SelTransShow {
  SHOW_CONTENT,
  SHOW_OUTLINE,
}

/**
 * Moves and transforms the selection with the select tool (upstream
 * SelTrans): drags of the selected items (grab, moveTo, ungrab) and the
 * scale and stretch handles around the selection bounding box.
 * TODO: rotate, skew and center handles (STATE_ROTATE shows the scale
 * handles), align handles, snapping, outline mode, stamping, sticky keys,
 * stroke compensation of scale handles (get_scale_transform_for_uniform_stroke),
 * the _norm and _grip indicators, status bar messages.
 */
export class SelTrans {
  readonly #desktop: SPDesktop;
  readonly #selection: Selection;
  readonly _selcue: SelCue;
  #state = SelTransState.STATE_SCALE;
  #show = SelTransShow.SHOW_CONTENT;
  #grabbed = false;
  #show_handles = true;
  #empty = true;
  #changed = false;
  #snap_bbox_type = BBoxType.VISUAL_BBOX;

  #items: SPItem[] = [];
  #items_affines: Affine[] = [];
  #bbox: OptRect = null;
  #point = new Point(0, 0);
  #origin = new Point(0, 0);
  #opposite = new Point(0, 0);
  #center: Point | null = null;
  #center_is_set = false;
  #current_relative_affine = Affine.identity();
  #absolute_affine = Affine.identity();

  /** Knots for the handles that are ported, by index in hands. */
  readonly #knots = new Map<SPSelTransHandle, SPKnot>();
  readonly #disconnect: (() => void)[];

  constructor(desktop: SPDesktop) {
    this.#desktop = desktop;
    this.#selection = desktop.getSelection();
    this._selcue = new SelCue(desktop);
    this.#snap_bbox_type = this.#prefsBboxType();
    this.#updateVolatileState();
    this.#makeHandles();
    this.#updateHandles();
    this.#disconnect = [
      this.#selection.connectChanged(() => this.#selChanged()),
      this.#selection.connectModified(() => this.#selModified()),
    ];
  }

  destroy(): void {
    for (const disconnect of this.#disconnect) disconnect();
    for (const knot of this.#knots.values()) knot.destroy();
    this.#knots.clear();
    this._selcue.destroy();
  }

  getSelCue(): SelCue {
    return this._selcue;
  }
  isGrabbed(): boolean {
    return this.#grabbed;
  }
  isEmpty(): boolean {
    return this.#empty;
  }
  getState(): SelTransState {
    return this.#state;
  }
  setShow(show: SelTransShow): void {
    this.#show = show;
  }

  resetState(state = SelTransState.STATE_SCALE): void {
    this.#state = state;
  }

  /** Toggle between scale and rotate handles (click on the selection). */
  increaseState(): void {
    const show_align = Preferences.get().getBool('/dialogs/align/oncanvas', false);
    if (this.#state === SelTransState.STATE_SCALE) {
      this.#state = SelTransState.STATE_ROTATE;
    } else if (this.#state === SelTransState.STATE_ROTATE && show_align) {
      this.#state = SelTransState.STATE_ALIGN;
    } else {
      this.#state = SelTransState.STATE_SCALE;
    }
    this.#center_is_set = true; // no need to reread center
    this.#updateHandles();
  }

  /**
   * Start a transformation at desktop point p. x and y are the handle
   * position relative to the bounding box (-1 for a move).
   */
  grab(p: Point, x: number, y: number, show_handles: boolean, _translating: boolean): void {
    if (this.#grabbed) return;
    this.#grabbed = true;
    this.#show_handles = show_handles;
    this.#updateVolatileState();
    this.#current_relative_affine = Affine.identity();
    this.#changed = false;
    if (this.#empty) return;

    this.#items = this.#selection.items();
    this.#items_affines = this.#items.map((item) => item.i2dtAffine());

    if (y !== -1 && this.#desktop.yaxisdir() > 0) y = 1 - y;

    // First, determine the bounding box
    this.#bbox = this.#selection.bounds(this.#snap_bbox_type);
    this.#point = p;
    // TODO: snap points and bbox points.
    if (this.#bbox) {
      this.#opposite = this.#bbox.min().add(this.#bbox.dimensions().scaled(new Point(1 - x, 1 - y)));
    }
    this.#updateHandles();
  }

  /** Show the items transformed by rel_affine around norm (live, without writing the reprs). */
  transform(rel_affine: Affine, norm: Point): void {
    if (!this.#grabbed || this.#empty) return;
    const affine = Translate(norm.neg()).multiply(rel_affine).multiply(Translate(norm));
    if (this.#show === SelTransShow.SHOW_CONTENT) {
      // update the content
      for (const [i, item] of this.#items.entries()) {
        if (item instanceof SPRoot) {
          // TODO: flash "Cannot transform an embedded SVG." in the message stack.
          break;
        }
        const prev_transform = this.#items_affines[i];
        if (prev_transform) item.setI2dAffine(prev_transform.multiply(affine));
      }
    }
    this.#current_relative_affine = affine;
    this.#changed = true;
    this.#updateHandles();
  }

  /** Finish the transformation: write the reprs and make an undo step. */
  ungrab(): void {
    if (!this.#grabbed) return;
    this.#grabbed = false;
    this.#show_handles = true;
    this.#updateVolatileState();
    this.#items = [];
    this.#items_affines = [];

    const rel = this.#current_relative_affine;
    if (!this.#empty && this.#changed && !rel.isIdentity()) {
      this.#selection.applyAffine(rel, this.#show === SelTransShow.SHOW_OUTLINE);
      if (this.#center) {
        this.#center = this.#center.transformed(rel);
        this.#center_is_set = true;
      }
      const doc = this.#desktop.getDocument();
      if (rel.isTranslation()) {
        DocumentUndo.done(doc, C_('Undo', 'Move'), 'tool-pointer');
      } else if (rel.withoutTranslation().isScale()) {
        DocumentUndo.done(doc, C_('Undo', 'Scale'), 'tool-pointer');
      } else if (rel.withoutTranslation().isRotation()) {
        DocumentUndo.done(doc, C_('Undo', 'Rotate'), 'tool-pointer');
      } else {
        DocumentUndo.done(doc, C_('Undo', 'Skew'), 'tool-pointer');
      }
    } else {
      this.#updateHandles();
    }
  }

  /** Move the grabbed items so that the grab point is at xy. Ctrl restricts to horizontal or vertical. */
  moveTo(xy: Point, state: ModifierState): boolean {
    // The amount that we've moved by during this drag
    let dxy = xy.sub(this.#point);
    // MOVE_CONFINE (Ctrl)
    if (mod_ctrl(state)) {
      dxy = Math.abs(dxy.x) > Math.abs(dxy.y) ? new Point(dxy.x, 0) : new Point(0, dxy.y);
    }
    // TODO: MOVE_INCREMENT (multiples of the grid pitch), snapping.
    const move = Translate(dxy);
    this.transform(move, new Point(0, 0));
    return !move.isIdentity();
  }

  // Handles

  #makeHandles(): void {
    for (const hand of hands) {
      if (hand.type !== SPSelTransType.HANDLE_SCALE && hand.type !== SPSelTransType.HANDLE_STRETCH) continue;
      const tip = _tip();
      const knot = new SPKnot(this.#desktop, tip, CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ADJ_HANDLE);
      knot.setAnchor(hand.anchor);
      knot.request = (k, p, state) => this.#handleRequest(k, p, state, hand);
      knot.moved_signal.connect(() => this.#handleNewEvent(hand));
      knot.grabbed_signal.connect((k) => this.#handleGrab(k, hand));
      knot.ungrabbed_signal.connect(() => this.ungrab());
      knot.click_signal.connect((k) => this.#handleClick(k, hand));
      this.#knots.set(hand, knot);
    }
  }

  #handleClick(knot: SPKnot, hand: SPSelTransHandle): void {
    if (hand.type === SPSelTransType.HANDLE_STRETCH || hand.type === SPSelTransType.HANDLE_SCALE) {
      const was_selected = knot.is_selected();
      for (const child of this.#knots.values()) child.selectKnot(false);
      if (!was_selected) knot.selectKnot(true);
      this.#updateHandles();
    }
  }

  #handleGrab(knot: SPKnot, hand: SPSelTransHandle): void {
    this.grab(knot.position(), hand.x, hand.y, false, false);
  }

  #handleNewEvent(hand: SPSelTransHandle): void {
    // in case items have been unhooked from the document, don't
    // try to continue processing events for them.
    if (this.#items.some((item) => !item.parent)) return;
    if (hand.type === SPSelTransType.HANDLE_SCALE || hand.type === SPSelTransType.HANDLE_STRETCH) {
      this.transform(this.#absolute_affine, new Point(0, 0)); // commitAbsoluteAffine
    }
  }

  #handleRequest(knot: SPKnot, p: Point, state: ModifierState, hand: SPSelTransHandle): boolean {
    if (!knot.is_grabbed() || !this.#grabbed) return true;
    const isHorz = hand.anchor === SPAnchorType.SP_ANCHOR_W || hand.anchor === SPAnchorType.SP_ANCHOR_E;
    const pt =
      hand.type === SPSelTransType.HANDLE_SCALE
        ? this.scaleRequest(p, state)
        : this.stretchRequest(p, state, isHorz);
    knot.setPosition(pt, state);
    return true;
  }

  /**
   * The point the transformation keeps fixed: the opposite handle, or with
   * Shift (TRANS_OFF_CENTER) the center.
   */
  #originRequest(state: ModifierState): void {
    const off_center = mod_shift(state);
    if (off_center === (this.#state === SelTransState.STATE_ROTATE)) {
      this.#origin = this.#opposite;
    } else if (this.#center) {
      this.#origin = this.#center;
    }
  }

  /** Scale for the dragged corner handle at pt; Ctrl keeps the aspect ratio, Alt scales by integer factors. Returns the handle position. */
  scaleRequest(pt: Point, state: ModifierState): Point {
    this.#originRequest(state);
    let [sx, sy] = calcScaleFactors(this.#point, pt, this.#origin);
    if (mod_alt(state)) {
      // TRANS_INCREMENT: scale by an integer multiplier/divider
      sx = roundScale(sx);
      sy = roundScale(sy);
      pt = this.#calcAbsAffineDefault(sx, sy);
    } else {
      if (mod_ctrl(state) || Preferences.get().getBool('/tools/select/lock_aspect_ratio', false)) {
        // Scale is locked to a 1:1 aspect ratio, so that s[X] must be made to equal s[Y].
        if (Math.abs(sx) > Math.abs(sy)) sx = Math.abs(sy) * sign(sx);
        else sy = Math.abs(sx) * sign(sy);
      }
      // TODO: snapping. We didn't snap: don't update the handle position, just calculate the new transformation
      this.#calcAbsAffineDefault(sx, sy);
    }
    return pt;
  }

  /** Scale along one axis for the dragged side handle at pt; Ctrl scales uniformly. Returns the handle position. */
  stretchRequest(pt: Point, state: ModifierState, is_horz: boolean): Point {
    this.#originRequest(state);
    const scale = calcScaleFactors(this.#point, pt, this.#origin);
    const axis = is_horz ? 0 : 1;
    const perp = 1 - axis;
    scale[perp] = 1;
    if (mod_alt(state)) {
      scale[axis] = roundScale(scale[axis]);
      return this.#calcAbsAffineDefault(scale[0], scale[1]);
    }
    // on scale_confine, apply symmetrical scaling instead of stretching
    // Preserve aspect ratio, but never flip in the dimension not being edited (by using fabs())
    if (mod_ctrl(state)) scale[perp] = Math.abs(scale[axis]);
    this.#calcAbsAffineDefault(scale[0], scale[1]);
    return pt;
  }

  /** Set the absolute affine for scale factors around the origin; returns the new handle position. */
  #calcAbsAffineDefault(sx: number, sy: number): Point {
    // TODO: keep the visual bbox with stroke compensation (get_scale_transform_for_uniform_stroke).
    this.#absolute_affine = Translate(this.#origin.neg())
      .multiply(Scale(sx, sy))
      .multiply(Translate(this.#origin));
    // return the new handle position
    return this.#point.sub(this.#origin).scaled(new Point(sx, sy)).add(this.#origin);
  }

  #updateHandles(): void {
    for (const knot of this.#knots.values()) knot.hide();
    if (!this.#center_is_set && !this.#empty) {
      this.#center = this.#selection.center();
      this.#center_is_set = true;
    }
    if (!this.#show_handles || this.#empty) return;
    // TODO: rotate/skew/center handles for STATE_ROTATE, align handles for STATE_ALIGN.
    this.#showHandles(SPSelTransType.HANDLE_STRETCH);
    this.#showHandles(SPSelTransType.HANDLE_SCALE);
  }

  #showHandles(type: SPSelTransType): void {
    const bbox = this.#bbox;
    if (!bbox) return;
    const y_dir = this.#desktop.yaxisdir();
    for (const [hand, knot] of this.#knots) {
      if (hand.type !== type) continue;
      // Position knots to scale the selection bbox
      const bpos = new Point(hand.x, (hand.y - 0.5) * -y_dir + 0.5);
      knot.moveto(bbox.min().add(bbox.dimensions().scaled(bpos)));
      knot.show();
    }
  }

  #updateVolatileState(): void {
    this.#empty = this.#selection.isEmpty();
    if (this.#empty) return;
    // Update the bboxes
    this.#bbox = this.#selection.bounds(this.#snap_bbox_type);
    if (!this.#bbox) this.#empty = true;
  }

  #selChanged(): void {
    if (this.#grabbed) return;
    // reread in case it changed on the fly:
    this.#snap_bbox_type = this.#prefsBboxType();
    this.#updateVolatileState();
    this.#current_relative_affine = Affine.identity();
    this.#center_is_set = false; // center(s) may have changed
    this.#updateHandles();
  }

  #selModified(): void {
    if (this.#grabbed) return;
    this.#updateVolatileState();
    this.#current_relative_affine = Affine.identity();
    // reset internal flag
    this.#changed = false;
    this.#center_is_set = false; // center(s) may have changed
    this.#updateHandles();
  }

  #prefsBboxType(): BBoxType {
    return Preferences.get().getInt('/tools/bounding_box', 0) === 0
      ? BBoxType.VISUAL_BBOX
      : BBoxType.GEOMETRIC_BBOX;
  }
}

/** Scale factors that move initial_point to new_point, keeping origin fixed. */
export function calcScaleFactors(initial_point: Point, new_point: Point, origin: Point): [number, number] {
  const initial_delta = initial_point.sub(origin);
  const new_delta = new_point.sub(origin);
  const scale: [number, number] = [1, 1];
  for (const i of [0, 1] as const) {
    const d = i === 0 ? initial_delta.x : initial_delta.y;
    if (Math.abs(d) > 1e-6) scale[i] = (i === 0 ? new_delta.x : new_delta.y) / d;
  }
  return scale;
}

/** Returns -1 or 1 according to the sign of x.  Returns 1 for 0 and NaN. */
function sign(x: number): number {
  return x < 0 ? -1 : 1;
}

function roundScale(s: number): number {
  if (Math.abs(s) > 1) return Math.round(s);
  if (s !== 0) return 1 / Math.round(1 / Math.min(s, 10));
  return s;
}

/** Status bar tip of a scale or stretch handle. TODO: modifier labels from the Modifier definitions. */
function _tip(): string {
  return _(
    '<b>Scale</b> selection; with <b>%1</b> to scale uniformly; with <b>%2</b> to scale around rotation center',
  )
    .replace('%1', 'Ctrl')
    .replace('%2', 'Shift');
}
