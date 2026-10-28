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
  type SnapCandidatePoint,
  type SPItem,
  SPRoot,
  SnapTargetType as T,
} from '@inkscape-web/core';
import {
  Affine,
  dot,
  L2,
  type OptRect,
  Point,
  Rect,
  Rotate,
  rot90,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import type { SPDesktop } from './desktop.ts';
import { CanvasItemCtrlType } from './display/control/canvas-item-ctrl.ts';
import { SPAnchorType } from './enums.ts';
import { getBBoxPointsDefault } from './object-snapper.ts';
import {
  PureScale,
  PureScaleConstrained,
  PureStretchConstrained,
  PureTranslate,
  PureTranslateConstrained,
} from './pure-transform.ts';
import { SelCue } from './selcue.ts';
import { hands, type SPSelTransHandle, SPSelTransType } from './seltrans-handles.ts';
import type { SnappedPoint } from './snapped-point.ts';
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
 * SelTrans): drags of the selected items (grab, moveTo, ungrab), the
 * scale and stretch handles around the selection bounding box, and in
 * STATE_ROTATE the rotate and skew handles and the rotation center.
 * Moves and scales snap the bounding box points and the snap points of the
 * selected items (see grab()).
 * TODO: align handles, snapping of skew, rotate and the center, outline mode, stamping, sticky keys,
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
  /** The rotation centers (desktop coordinates) of the items that have one set, at grab. */
  #items_centers: (Point | null)[] = [];
  #bbox: OptRect = null;
  #geometric_bbox: OptRect = null;
  #point = new Point(0, 0);
  /** The grab point on the geometric bbox. */
  #point_geom = new Point(0, 0);
  #origin = new Point(0, 0);
  #opposite = new Point(0, 0);
  // There are two separate "opposites" (i.e. opposite w.r.t. the handle being dragged):
  //  - one for snapping the boundingbox, which can be either visual or geometric
  //  - one for snapping the special points
  #opposite_for_bboxpoints = new Point(0, 0);
  #opposite_for_specpoints = new Point(0, 0);
  #origin_for_bboxpoints = new Point(0, 0);
  #origin_for_specpoints = new Point(0, 0);
  /** The handle position relative to the bbox (x, y in 0..1), see grab(). */
  #handle_x = 0;
  #handle_y = 0;
  /** The snap sources: the snap points of the items and the bbox points. */
  #snap_points: SnapCandidatePoint[] = [];
  #bbox_points: SnapCandidatePoint[] = [];
  #center: Point | null = null;
  #center_is_set = false;
  #current_relative_affine = Affine.identity();
  #absolute_affine = Affine.identity();
  #relative_affine = Affine.identity();

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
  grab(p: Point, x: number, y: number, show_handles: boolean, translating: boolean): void {
    if (this.#grabbed) return;
    this.#grabbed = true;
    this.#show_handles = show_handles;
    this.#updateVolatileState();
    this.#current_relative_affine = Affine.identity();
    this.#changed = false;
    if (this.#empty) return;

    this.#items = this.#selection.items();
    this.#items_affines = this.#items.map((item) => item.i2dtAffine());
    this.#items_centers = this.#items.map((item) => (item.isCenterSet() ? item.getCenter() : null));

    if (y !== -1 && this.#desktop.yaxisdir() > 0) y = 1 - y;
    this.#handle_x = x;
    this.#handle_y = y;

    // The selector tool should snap the bbox, special snappoints, and path nodes
    // First, determine the bounding box
    this.#bbox = this.#selection.bounds(this.#snap_bbox_type);
    this.#geometric_bbox = this.#selection.geometricBounds();
    this.#point = p;
    this.#point_geom = this.#geometric_bbox
      ? this.#geometric_bbox.min().add(this.#geometric_bbox.dimensions().scaled(new Point(x, y)))
      : p;

    // Next, get all points to consider for snapping
    const m = this.#desktop.getSnapManager();
    const prefs = Preferences.get();
    this.#snap_points = [];
    if (m.someSnapperMightSnap(false)) {
      // Only search for snap sources when really needed, to avoid unnecessary delays
      this.#snap_points = this.#selection.getSnapPoints(m.snapprefs);
    }
    if (this.#snap_points.length > 200 && !prefs.getBool('/options/snapclosestonly/value', false)) {
      /* Snapping a huge number of nodes will take way too long, so limit the number of snappable nodes */
      console.warn('Warning: limit of 200 snap sources reached, some will be ignored');
      this.#snap_points.length = 200;
    }
    // Find bbox hulling all special points, which excludes stroke width.
    const snap_points_bbox = this.#selection.bounds(BBoxType.GEOMETRIC_BBOX);
    this.#bbox_points = [];
    // Collect the bounding box's corners and midpoints for each selected item
    if (m.snapprefs.isTargetSnappable(T.SNAPTARGET_BBOX_CATEGORY)) {
      const c = m.snapprefs.isTargetSnappable(T.SNAPTARGET_BBOX_CORNER);
      const mp = m.snapprefs.isTargetSnappable(T.SNAPTARGET_BBOX_MIDPOINT);
      const emp = m.snapprefs.isTargetSnappable(T.SNAPTARGET_BBOX_EDGE_MIDPOINT);
      // Preferably we'd use the bbox of each selected item, but for example 50 items will produce at least 200 bbox points.
      // In that case we will use the bbox of the selection as a whole
      const c1 = this.#items.length > 0 && this.#items.length < 50;
      const c2 = prefs.getBool('/options/snapclosestonly/value', false);
      if (translating && (c1 || c2)) {
        // Get the bounding box points for each item in the selection
        for (const item of this.#items) {
          getBBoxPointsDefault(item.desktopBounds(this.#snap_bbox_type), this.#bbox_points, c, emp, mp);
        }
      } else {
        // Only get the bounding box points of the selection as a whole
        getBBoxPointsDefault(this.#bbox, this.#bbox_points, c, emp, mp);
      }
    }

    if (this.#bbox) {
      this.#opposite_for_bboxpoints = this.#bbox
        .min()
        .add(this.#bbox.dimensions().scaled(new Point(1 - x, 1 - y)));
      this.#opposite_for_specpoints = snap_points_bbox
        ? snap_points_bbox.min().add(snap_points_bbox.dimensions().scaled(new Point(1 - x, 1 - y)))
        : this.#opposite_for_bboxpoints;
      this.#opposite = this.#opposite_for_bboxpoints;
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
    const items = this.#items;
    const items_centers = this.#items_centers;
    this.#items = [];
    this.#items_affines = [];
    this.#items_centers = [];

    this.#snap_points = [];
    this.#bbox_points = [];
    this.#desktop.getSnapIndicator().remove_snaptarget();

    const rel = this.#current_relative_affine;
    if (!this.#empty && this.#changed && !rel.isIdentity()) {
      this.#selection.applyAffine(rel, this.#show === SelTransShow.SHOW_OUTLINE);
      if (this.#center) {
        this.#center = this.#center.transformed(rel);
        this.#center_is_set = true;
      }
      // If dragging showed content live, applyAffine cannot change the centers appropriately: it does
      // not know the original positions of the centers (all objects already have the new bboxes).
      // So reset the centers from the saved array.
      if (this.#show !== SelTransShow.SHOW_OUTLINE && !rel.isTranslation()) {
        for (const [i, item] of items.entries()) {
          const center = items_centers[i];
          if (center && item.isCenterSet()) {
            item.setCenter(center.transformed(rel));
            item.updateRepr();
          }
        }
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
      if (this.#center_is_set) {
        // we were dragging center; update reprs and commit undoable action
        for (const item of this.#selection.items()) item.updateRepr();
        DocumentUndo.done(this.#desktop.getDocument(), C_('Undo', 'Set center'), 'tool-pointer');
      }
      this.#updateHandles();
    }
  }

  /**
   * Move the grabbed items so that the grab point is at xy, snapping the bbox
   * points and the snap points of the items. Ctrl restricts to horizontal or vertical.
   * MOVE_INCREMENT (multiples of the grid pitch) and MOVE_NO_SNAPPING have no
   * modifier in share/keys/inkscape.xml.
   */
  moveTo(xy: Point, state: ModifierState): boolean {
    const m = this.#desktop.getSnapManager();
    // The amount that we've moved by during this drag
    let dxy = xy.sub(this.#point);
    // MOVE_CONFINE (Ctrl)
    const confine = mod_ctrl(state);
    const constrain = () => {
      dxy = Math.abs(dxy.x) > Math.abs(dxy.y) ? new Point(dxy.x, 0) : new Point(0, dxy.y);
    };
    if (confine) constrain();
    /* We're snapping to things, possibly with a constraint to horizontal or
     ** vertical movement.  Obtain a list of possible translations and then
     ** pick the smallest.
     */
    m.setup(this.#desktop, false, this.#items);
    let bb: PureTranslate;
    let sn: PureTranslate;
    if (confine) {
      // constrained movement with snapping
      const dim = Math.abs(dxy.x) > Math.abs(dxy.y) ? 0 : 1;
      bb = new PureTranslateConstrained(dxy.at(dim), dim);
      sn = new PureTranslateConstrained(dxy.at(dim), dim);
    } else {
      /* Snap to things with no constraint */
      bb = new PureTranslate(dxy);
      sn = new PureTranslate(dxy);
    }
    m.snapTransformed(this.#bbox_points, this.#point, bb);
    m.snapTransformed(this.#snap_points, this.#point, sn);
    m.unSetup();
    /* Pick one */
    let sn_is_best = sn.best_snapped_point.getSnapped();
    let bb_is_best = bb.best_snapped_point.getSnapped();
    if (bb_is_best && sn_is_best) {
      sn_is_best = bb.best_snapped_point.isOtherSnapBetter(sn.best_snapped_point, true);
      bb_is_best = !sn_is_best;
    }
    const indicator = this.#desktop.getSnapIndicator();
    if (sn_is_best) {
      indicator.set_new_snaptarget(sn.best_snapped_point);
      dxy = sn.getTranslationSnapped();
    } else if (bb_is_best) {
      indicator.set_new_snaptarget(bb.best_snapped_point);
      dxy = bb.getTranslationSnapped();
    } else {
      // We didn't snap, so remove any previous snap indicator
      indicator.remove_snaptarget();
      // If we didn't snap, then we should still constrain horizontally or vertically
      if (confine) constrain();
    }
    const move = Translate(dxy);
    this.transform(move, new Point(0, 0));
    return !move.isIdentity();
  }

  // Handles

  #makeHandles(): void {
    for (const hand of hands) {
      let tip: string;
      let type: CanvasItemCtrlType;
      switch (hand.type) {
        case SPSelTransType.HANDLE_STRETCH:
        case SPSelTransType.HANDLE_SCALE:
          tip = _tip();
          type = CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ADJ_HANDLE;
          break;
        case SPSelTransType.HANDLE_SKEW:
          tip = _(
            '<b>Skew</b> selection; with <b>%1</b> to snap angle; with <b>%2</b> to skew around the opposite side',
          )
            .replace('%1', 'Alt')
            .replace('%2', 'Shift');
          type = CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ADJ_SKEW;
          break;
        case SPSelTransType.HANDLE_ROTATE:
          tip = _(
            '<b>Rotate</b> selection; with <b>%1</b> to snap angle; with <b>%2</b> to rotate around the opposite corner',
          )
            .replace('%1', 'Alt')
            .replace('%2', 'Shift');
          type = CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ADJ_ROTATE;
          break;
        case SPSelTransType.HANDLE_CENTER:
          tip = _(
            '<b>Center</b> of transformation: drag to reposition; scaling, rotation and skew with %1 also uses this center',
          ).replace('%1', 'Shift');
          type = CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ADJ_CENTER;
          break;
        default:
          continue; // TODO: align handles
      }
      const knot = new SPKnot(this.#desktop, tip, type);
      knot.setAnchor(hand.anchor);
      knot.request = (k, p, state) => this.#handleRequest(k, p, state, hand);
      knot.moved_signal.connect((k, p) => this.#handleNewEvent(k, p, hand));
      knot.grabbed_signal.connect((k) => this.#handleGrab(k, hand));
      knot.ungrabbed_signal.connect(() => this.ungrab());
      knot.click_signal.connect((k, state) => this.#handleClick(k, state, hand));
      this.#knots.set(hand, knot);
    }
  }

  #handleClick(knot: SPKnot, state: ModifierState, hand: SPSelTransHandle): void {
    if (hand.type === SPSelTransType.HANDLE_CENTER && mod_shift(state)) {
      // Unset the center position for all selected items
      for (const item of this.#selection.items()) {
        item.unsetCenter();
        item.updateRepr();
      }
      this.#center_is_set = false; // center has changed
      this.#updateHandles();
      DocumentUndo.done(this.#desktop.getDocument(), C_('Undo', 'Reset center'), 'tool-pointer');
    }
    if (
      hand.type === SPSelTransType.HANDLE_CENTER ||
      hand.type === SPSelTransType.HANDLE_STRETCH ||
      hand.type === SPSelTransType.HANDLE_SCALE
    ) {
      const was_selected = knot.is_selected();
      for (const child of this.#knots.values()) child.selectKnot(false);
      if (!was_selected) knot.selectKnot(true);
      this.#updateHandles();
    }
  }

  #handleGrab(knot: SPKnot, hand: SPSelTransHandle): void {
    this.grab(knot.position(), hand.x, hand.y, false, false);
  }

  #handleNewEvent(knot: SPKnot, position: Point, hand: SPSelTransHandle): void {
    if (!knot.is_grabbed()) return;
    // in case items have been unhooked from the document, don't
    // try to continue processing events for them.
    if (this.#items.some((item) => !item.parent)) return;
    switch (hand.type) {
      case SPSelTransType.HANDLE_SCALE:
      case SPSelTransType.HANDLE_STRETCH:
        this.transform(this.#absolute_affine, new Point(0, 0)); // commitAbsoluteAffine
        break;
      case SPSelTransType.HANDLE_SKEW:
      case SPSelTransType.HANDLE_ROTATE:
        this.transform(this.#relative_affine, this.#origin); // commitRelativeAffine
        break;
      case SPSelTransType.HANDLE_CENTER:
        this.setCenter(position);
        break;
      default:
        break;
    }
  }

  /** Set the rotation center of the selected items. The reprs are written on ungrab. */
  setCenter(p: Point): void {
    this.#center = p;
    this.#center_is_set = true;
    // Write the new center position into all selected items
    for (const item of this.#selection.items()) item.setCenter(p);
    this.#updateHandles();
  }

  #handleRequest(knot: SPKnot, p: Point, state: ModifierState, hand: SPSelTransHandle): boolean {
    if (!knot.is_grabbed() || !this.#grabbed) return true;
    const isHorz = hand.anchor === SPAnchorType.SP_ANCHOR_W || hand.anchor === SPAnchorType.SP_ANCHOR_E;
    let pt: Point | null = null;
    switch (hand.type) {
      case SPSelTransType.HANDLE_SCALE:
        pt = this.scaleRequest(p, state);
        break;
      case SPSelTransType.HANDLE_STRETCH:
        pt = this.stretchRequest(p, state, isHorz);
        break;
      case SPSelTransType.HANDLE_SKEW:
        pt = this.skewRequest(p, state, isHorz);
        break;
      case SPSelTransType.HANDLE_ROTATE:
        pt = this.rotateRequest(p, state);
        break;
      case SPSelTransType.HANDLE_CENTER:
        pt = this.centerRequest(p, state);
        break;
    }
    if (pt) knot.setPosition(pt, state);
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
      this.#origin_for_bboxpoints = this.#opposite_for_bboxpoints;
      this.#origin_for_specpoints = this.#opposite_for_specpoints;
    } else if (this.#center) {
      this.#origin = this.#center;
      this.#origin_for_bboxpoints = this.#center;
      this.#origin_for_specpoints = this.#center;
    }
  }

  /**
   * Scale for the dragged corner handle at pt; Ctrl keeps the aspect ratio, Alt scales by
   * integer factors, Shift (TRANS_NO_SNAPPING) does not snap. Returns the handle position.
   */
  scaleRequest(pt: Point, state: ModifierState): Point {
    this.#originRequest(state);
    // Calculate the scale factors, which can be either visual or geometric
    // depending on which type of bbox is currently being used (see preferences -> selector tool)
    let [sx, sy] = calcScaleFactors(this.#point, pt, this.#origin);
    // Find the scale factors for the geometric bbox
    const pt_geom = this.#getGeomHandlePos(pt);
    let [gx, gy] = calcScaleFactors(this.#point_geom, pt_geom, this.#origin_for_specpoints);
    if (mod_alt(state)) {
      // TRANS_INCREMENT: scale by an integer multiplier/divider
      sx = roundScale(sx);
      sy = roundScale(sy);
      // When scaling by an integer, snapping is not needed
      return this.#calcAbsAffineDefault(sx, sy);
    }
    // In all other cases we should try to snap now
    let bb: PureScale;
    let sn: PureScale;
    if (mod_ctrl(state) || Preferences.get().getBool('/tools/select/lock_aspect_ratio', false)) {
      // Scale is locked to a 1:1 aspect ratio, so that s[X] must be made to equal s[Y].
      // The aspect-ratio must be locked before snapping
      if (Math.abs(sx) > Math.abs(sy)) {
        sx = Math.abs(sy) * sign(sx);
        gx = Math.abs(gy) * sign(gx);
      } else {
        sy = Math.abs(sx) * sign(sy);
        gy = Math.abs(gx) * sign(gy);
      }
      // Snap along a suitable constraint vector from the origin.
      bb = new PureScaleConstrained(new Point(sx, sy), this.#origin_for_bboxpoints);
      sn = new PureScaleConstrained(new Point(gx, gy), this.#origin_for_specpoints);
    } else {
      /* Scale aspect ratio is unlocked */
      bb = new PureScale(new Point(sx, sy), this.#origin_for_bboxpoints, false);
      sn = new PureScale(new Point(gx, gy), this.#origin_for_specpoints, false);
    }
    const m = this.#desktop.getSnapManager();
    m.setup(this.#desktop, false, this.#items);
    m.snapTransformed(this.#bbox_points, this.#point, bb);
    m.snapTransformed(this.#snap_points, this.#point, sn);
    m.unSetup();
    return this.#applySnappedScale(
      bb.best_snapped_point,
      sn.best_snapped_point,
      bb.getScaleSnapped(),
      sn.getScaleSnapped(),
      new Point(sx, sy),
      mod_shift(state),
      pt,
    );
  }

  /**
   * Use the better snap of the bbox points (bbs) and the snap points (sns) for
   * the new transformation and return the new handle position; without snap
   * (or with no_snap), use default_scale and keep pt.
   */
  #applySnappedScale(
    bbs: SnappedPoint,
    sns: SnappedPoint,
    bb_scale: Point,
    sn_scale: Point,
    default_scale: Point,
    no_snap: boolean,
    pt: Point,
  ): Point {
    const indicator = this.#desktop.getSnapIndicator();
    if (!no_snap && (bbs.getSnapped() || sns.getSnapped())) {
      if (bbs.getSnapped() && !bbs.isOtherSnapBetter(sns, false)) {
        // We snapped the bbox (which is either visual or geometric)
        indicator.set_new_snaptarget(bbs);
        // Calculate the new transformation and update the handle position
        return this.#calcAbsAffineDefault(bb_scale.x, bb_scale.y);
      }
      if (sns.getSnapped()) {
        indicator.set_new_snaptarget(sns);
        // We snapped the special points (e.g. nodes), which are not at the visual bbox
        return this.#calcAbsAffineGeom(sn_scale);
      }
    }
    // We didn't snap at all! Don't update the handle position, just calculate the new transformation
    this.#calcAbsAffineDefault(default_scale.x, default_scale.y);
    indicator.remove_snaptarget();
    return pt;
  }

  /**
   * Scale along one axis for the dragged side handle at pt; Ctrl scales uniformly, Shift
   * (TRANS_NO_SNAPPING) does not snap. Returns the handle position.
   */
  stretchRequest(pt: Point, state: ModifierState, is_horz: boolean): Point {
    this.#originRequest(state);
    const axis = is_horz ? 0 : 1;
    const perp = 1 - axis;
    // Calculate the scale factors, which can be either visual or geometric
    const scale = calcScaleFactors(this.#point, pt, this.#origin);
    scale[perp] = 1;
    // Find the scale factors for the geometric bbox
    const geom_scale = calcScaleFactors(
      this.#point_geom,
      this.#getGeomHandlePos(pt),
      this.#origin_for_specpoints,
    );
    geom_scale[perp] = 1;
    if (mod_alt(state)) {
      // stretch by an integer multiplier/divider; snapping is not needed
      scale[axis] = roundScale(scale[axis]);
      return this.#calcAbsAffineDefault(scale[0], scale[1]);
    }
    const confine = mod_ctrl(state);
    const m = this.#desktop.getSnapManager();
    m.setup(this.#desktop, false, this.#items);
    const bb = new PureStretchConstrained(scale[axis], this.#origin_for_bboxpoints, axis, confine);
    const sn = new PureStretchConstrained(geom_scale[axis], this.#origin_for_specpoints, axis, confine);
    m.snapTransformed(this.#bbox_points, this.#point, bb);
    m.snapTransformed(this.#snap_points, this.#point, sn);
    m.unSetup();
    // on scale_confine, apply symmetrical scaling instead of stretching
    // Preserve aspect ratio, but never flip in the dimension not being edited (by using fabs())
    if (confine) scale[perp] = Math.abs(scale[axis]);
    return this.#applySnappedScale(
      bb.best_snapped_point,
      sn.best_snapped_point,
      bb.getStretchSnapped(),
      sn.getStretchSnapped(),
      new Point(scale[0], scale[1]),
      mod_shift(state),
      pt,
    );
  }

  /**
   * The handle position on the geometric bbox for the handle at
   * visual_handle_pos on the visual bbox (upstream _getGeomHandlePos).
   * TODO: stroke compensation (get_scale_transform_for_uniform_stroke).
   */
  #getGeomHandlePos(visual_handle_pos: Point): Point {
    // When the selector tool is using geometric bboxes, then the handle is already
    // located at one of the geometric bbox corners
    if (this.#snap_bbox_type === BBoxType.GEOMETRIC_BBOX || !this.#geometric_bbox) return visual_handle_pos;
    const [sx, sy] = calcScaleFactors(this.#point, visual_handle_pos, this.#origin_for_bboxpoints);
    const abs_affine = Translate(this.#origin_for_bboxpoints.neg())
      .multiply(Scale(sx, sy))
      .multiply(Translate(this.#origin_for_bboxpoints));
    // Calculate the scaled geometrical bbox, and find the location of the handle on it
    const g = this.#geometric_bbox;
    const new_geom_bbox = new Rect(g.min().transformed(abs_affine), g.max().transformed(abs_affine));
    return new_geom_bbox
      .min()
      .add(new_geom_bbox.dimensions().scaled(new Point(this.#handle_x, this.#handle_y)));
  }

  /** Set the absolute affine for a scale of the snap points around their origin; returns the handle position. */
  #calcAbsAffineGeom(geom_scale: Point): Point {
    this.#absolute_affine = Translate(this.#origin_for_specpoints.neg())
      .multiply(Scale(geom_scale.x, geom_scale.y))
      .multiply(Translate(this.#origin_for_specpoints));
    // return the new handle position on the transformed visual bbox
    const bbox = this.#bbox?.transformed(this.#absolute_affine);
    if (!bbox) return this.#point;
    return bbox.min().add(bbox.dimensions().scaled(new Point(this.#handle_x, this.#handle_y)));
  }

  /**
   * Skew along one side for the dragged side handle at pt. The side moves
   * only in integer multiples of the scale. Alt (or Ctrl) snaps the angle.
   * Returns the handle position, or null if the handle is too close to the origin.
   */
  skewRequest(pt: Point, state: ModifierState, is_horz: boolean): Point | null {
    this.#originRequest(state);
    const bbox_size = this.#bbox ? (is_horz ? this.#bbox.width() : this.#bbox.height()) : null;
    const result = calcSkew(this.#point, pt, this.#origin, is_horz, {
      snap: mod_alt(state) || mod_ctrl(state),
      snaps: rotationSnaps(),
      bbox_size,
    });
    if (!result) return null;
    this.#relative_affine = result.affine;
    return result.pt;
  }

  /**
   * Rotate around the origin (the rotation center, or with Shift the opposite
   * corner) for the dragged corner handle at pt. Alt or Ctrl snaps the angle
   * to multiples of pi / /options/rotationsnapsperpi/value. Returns the handle
   * position, or null if the handle or the pointer is at the origin.
   */
  rotateRequest(pt: Point, state: ModifierState): Point | null {
    this.#originRequest(state);
    const result = calcRotate(this.#point, pt, this.#origin, {
      snap: mod_alt(state) || mod_ctrl(state),
      snaps: rotationSnaps(),
    });
    if (!result) return null;
    this.#relative_affine = result.affine;
    return result.pt;
  }

  /** Move the rotation center; Ctrl restricts to horizontal or vertical from where the drag started. */
  centerRequest(pt: Point, state: ModifierState): Point {
    // TODO: snapping (SNAPSOURCE_ROTATION_CENTER).
    if (mod_ctrl(state)) {
      const a = new Point(pt.x, this.#point.y);
      const b = new Point(this.#point.x, pt.y);
      return L2(pt.sub(a)) <= L2(pt.sub(b)) ? a : b;
    }
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
    // TODO: align handles for STATE_ALIGN.
    if (this.#state === SelTransState.STATE_ROTATE) {
      this.#showHandles(SPSelTransType.HANDLE_SKEW);
      this.#showHandles(SPSelTransType.HANDLE_ROTATE);
      this.#showHandles(SPSelTransType.HANDLE_CENTER);
    } else {
      this.#showHandles(SPSelTransType.HANDLE_STRETCH);
      this.#showHandles(SPSelTransType.HANDLE_SCALE);
    }
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
      // The center handle can be moved, so its position is remembered.
      if (type === SPSelTransType.HANDLE_CENTER && this.#center) knot.moveto(this.#center);
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

/** Snap steps per half turn, /options/rotationsnapsperpi/value (limited to 0.1 to 1800). */
function rotationSnaps(): number {
  return Math.min(Math.max(Preferences.get().getDouble('/options/rotationsnapsperpi/value', 12), 0.1), 1800);
}

/** An angle in degrees in the range -180 to 180 (upstream mod360symm). */
export function mod360symm(deg: number): number {
  const m = ((deg % 360) + 360) % 360;
  return m > 180 ? m - 360 : m;
}

/**
 * Rotation around origin that moves the handle at point to the direction of
 * pt (upstream SelTrans::rotateRequest). With snap the angle is a multiple of
 * pi / snaps. Returns the affine (around the origin: apply it with
 * SelTrans.transform), the new handle position and the angle, or null if point
 * or pt is at the origin.
 */
export function calcRotate(
  point: Point,
  pt: Point,
  origin: Point,
  opts: { snap: boolean; snaps: number },
): { affine: Affine; pt: Point; radians: number } | null {
  const d1 = point.sub(origin);
  const d2 = pt.sub(origin);
  const h1 = L2(d1); // initial radius
  if (h1 < 1e-15) return null;
  const h2 = L2(d2); // new radius
  if (Math.abs(h2) < 1e-15) return null;
  const q1 = new Point(d1.x / h1, d1.y / h1); // normalized initial vector to handle
  const q2 = new Point(d2.x / h2, d2.y / h2); // normalized new vector to handle

  let r1 = Rotate(q1);
  let r2 = Rotate(q2);
  let radians = Math.atan2(dot(rot90(d1), d2), dot(d1, d2));
  if (opts.snap) {
    // Snap to defined angle increments
    radians = Math.atan2(dot(rot90(q1), q2), dot(q1, q2));
    radians = (Math.PI / opts.snaps) * Math.floor((radians * opts.snaps) / Math.PI + 0.5);
    r1 = Rotate(0);
    r2 = Rotate(radians);
  }
  const affine = r2.multiply(r1.inverse());
  // The new handle position
  const handle = point.transformed(Translate(origin.neg()).multiply(affine).multiply(Translate(origin)));
  return { affine, pt: handle, radians };
}

/**
 * Skew along the side of the handle at point that is dragged to pt, relative
 * to origin (upstream SelTrans::skewRequest). is_horz: the handle is on a
 * left or right side, so the skew is vertical. bbox_size is the size of the
 * bounding box along the dragged axis, to reject a handle too close to the
 * origin. With snap the skew angle is a multiple of pi / snaps. Returns the
 * affine, the new handle position and the angle, or null for a degenerate drag.
 */
export function calcSkew(
  point: Point,
  pt: Point,
  origin: Point,
  is_horz: boolean,
  opts: { snap: boolean; snaps: number; bbox_size?: number | null },
): { affine: Affine; pt: Point; radians: number } | null {
  const get = (p: Point, a: 0 | 1) => (a === 0 ? p.x : p.y);
  const make = (a: number, b: number, dim_a: 0 | 1): Point =>
    dim_a === 0 ? new Point(a, b) : new Point(b, a);
  const dim_a: 0 | 1 = is_horz ? 0 : 1;
  const dim_b: 0 | 1 = is_horz ? 1 : 0;

  const initial_delta = point.sub(origin);
  const delta_a = get(initial_delta, dim_a);
  // The handle and the origin shouldn't be too close to each other; use a relative error.
  if (opts.bbox_size && Math.abs(delta_a / opts.bbox_size) < 1e-4) return null;
  if (delta_a === 0) return null;

  // Scale and skew factors (calcScaleFactors without and with skew), along dim_a only
  let scale_a = Math.abs(delta_a) > 1e-6 ? get(pt.sub(origin), dim_a) / delta_a : 1;
  let skew_a = Math.abs(delta_a) > 1e-6 ? get(pt.sub(point), dim_b) / delta_a : 1;
  if (Math.abs(scale_a) < 1) {
    // Prevent shrinking of the selected object, while allowing mirroring
    scale_a = scale_a < 0 ? -1 : 1;
  } else {
    // Allow expanding of the selected object by integer multiples
    scale_a = Math.floor(scale_a + 0.5);
  }

  let radians = Math.atan(skew_a / scale_a);
  if (opts.snap) {
    // Snap to defined angle increments
    const snaps = opts.snaps;
    let sections = Math.floor((radians * snaps) / Math.PI + 0.5);
    if (Math.abs(sections) >= snaps / 2) {
      sections = (sections < 0 ? -1 : 1) * (snaps / 2 - 1);
    }
    radians = (Math.PI / snaps) * sections;
    skew_a = Math.tan(radians) * scale_a;
  }

  // The handle position
  const new_b = delta_a * skew_a + get(point, dim_b);
  const new_a = delta_a * scale_a + get(origin, dim_a);
  const handle = make(new_a, new_b, dim_a);

  // The relative affine
  const c = [1, 0, 0, 1];
  c[2 * dim_a + dim_a] = (new_a - get(origin, dim_a)) / delta_a;
  c[2 * dim_a + dim_b] = (new_b - get(point, dim_b)) / delta_a;
  c[2 * dim_b + dim_a] = 0;
  c[2 * dim_b + dim_b] = 1;
  for (const i of [0, 3] as const) if (Math.abs(c[i] as number) < 1e-15) c[i] = 1e-15;
  const affine = new Affine(c[0], c[1], c[2], c[3], 0, 0);
  return { affine, pt: handle, radians };
}
