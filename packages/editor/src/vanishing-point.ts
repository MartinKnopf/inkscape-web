// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/vanishing-point.cpp, src/vanishing-point.h
/*
 * Vanishing point for 3D perspectives
 *
 * Authors:
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Maximilian Albert <Anhalter42@gmx.de>
 *   Abhishek Sharma
 *
 * Copyright (C) 2005-2007 authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  C_,
  DocumentUndo,
  Persp3D,
  PerspectiveLine,
  Proj,
  Pt2,
  type Selection,
  SnapCandidatePoint,
  SnapSourceType,
  SPBox3D,
  type SPDocument,
} from '@inkscape-web/core';
import { L2, type Point } from '@inkscape-web/geom';
import type { SPDesktop } from './desktop.ts';
import { CanvasItemCtrlType } from './display/control/canvas-item-ctrl.ts';
import { CanvasItemCurve } from './display/control/canvas-item-curve.ts';
import { SPKnot } from './ui/knot/knot.ts';
import type { ModifierState } from './ui/tools/tool-base.ts';

// screen pixels between knots when they snap:
const SNAP_DIST = 5;
// absolute distance between gradient points for them to become a single dragger when the drag is created:
const MERGE_DIST = 0.1;

/** Upstream CANVAS_ITEM_COLORS: primary, secondary, tertiary. */
const CANVAS_ITEM_COLORS = [0x0000ff7f, 0xff00007f, 0xffff007f] as const;

/**
 * A vanishing point of one perspective in one direction (upstream Box3D::VanishingPoint).
 */
export class VanishingPoint {
  #persp: Persp3D | null;
  #axis: Proj.Axis;

  constructor(persp: Persp3D | null = null, axis: Proj.Axis = Proj.Axis.NONE) {
    this.#persp = persp;
    this.#axis = axis;
  }

  /* vanishing points coincide if they belong to the same perspective */
  equals(rhs: VanishingPoint): boolean {
    return this.#persp === rhs.#persp && this.#axis === rhs.#axis;
  }

  set_pos(pt: Pt2 | Point): void {
    this.#persp?.perspective_impl.tmat.set_image_pt(this.#axis, pt instanceof Pt2 ? pt : new Pt2(pt));
  }
  is_finite(): boolean {
    return this.#persp?.get_VP(this.#axis).is_finite() ?? false;
  }
  get_pos(): Point {
    return this.#persp!.get_VP(this.#axis).affine();
  }
  get_perspective(): Persp3D | null {
    return this.#persp;
  }
  set_perspective(persp: Persp3D): Persp3D {
    this.#persp = persp;
    return persp;
  }
  hasBox(box: SPBox3D): boolean {
    return this.#persp?.has_box(box) ?? false;
  }
  numberOfBoxes(): number {
    return this.#persp?.num_boxes() ?? 0;
  }
  /* returns all selected boxes sharing this perspective */
  selectedBoxes(sel: Selection): SPBox3D[] {
    return sel.items().filter((item): item is SPBox3D => item instanceof SPBox3D && this.hasBox(item));
  }
  updateBoxDisplays(): void {
    this.#persp?.update_box_displays();
  }
  updateBoxReprs(): void {
    this.#persp?.update_box_reprs();
  }
  updatePerspRepr(): void {
    this.#persp?.updateRepr();
  }
}

/** The knot of the vanishing points at one place (upstream VPDragger). */
export class VPDragger {
  readonly parent: VPDrag;
  knot: SPKnot | null = null;
  /** position of the knot, desktop coords */
  point: Point;
  /** position of the knot before it began to drag; updated when released */
  point_original: Point;
  dragging_started = false;
  vps: VanishingPoint[] = [];

  constructor(parent: VPDrag, p: Point, vp: VanishingPoint) {
    this.parent = parent;
    this.point = p;
    this.point_original = p;
    if (!vp.is_finite()) return;
    // create the knot
    const knot = new SPKnot(parent.desktop, '', CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ANCHOR);
    // move knot to the given point
    knot.moveto(p);
    knot.show();
    // connect knot's signals
    knot.moved_signal.connect((k, pt, state) => this.#moved(k, pt, state));
    knot.grabbed_signal.connect(() => {
      this.parent.dragging = true;
    });
    knot.ungrabbed_signal.connect((k) => this.#ungrabbed(k));
    this.knot = knot;
    // add the initial VP (which may be NULL!)
    this.addVP(vp);
  }

  destroy(): void {
    this.knot?.destroy();
    this.knot = null;
  }

  #moved(knot: SPKnot, ppointer: Point, state: ModifierState): void {
    const drag = this.parent;
    const desktop = drag.desktop;
    let p = ppointer;
    // FIXME: take from prefs
    const snap_dist = SNAP_DIST / desktop.current_zoom();

    /*
     * We use dragging_started to indicate if we have already checked for the need to split Draggers up.
     * This only has the purpose of avoiding costly checks in the routine below.
     */
    if (!this.dragging_started && state.shiftKey) {
      /* with Shift; if there is more than one box linked to this VP
         we need to split it and create a new perspective */
      if (this.numberOfBoxes() > 1) {
        // FIXME: Don't do anything if *all* boxes of a VP are selected
        for (const sel_vp of this.VPsOfSelectedBoxes()) {
          // for each VP that has selected boxes:
          const old_persp = sel_vp.get_perspective();
          if (!old_persp) continue;
          const sel_boxes = sel_vp.selectedBoxes(desktop.getSelection());
          // create a copy of the existing perspective
          const new_persp = Persp3D.create_copy(old_persp);
          /* ... unlink unselected boxes of each VP so that
             the selected boxes are kept with the VP being moved */
          for (const box of old_persp.list_of_boxes()) {
            // if a box in the VP is unselected, move it to the newly created perspective so that it doesn't get dragged
            if (!sel_boxes.includes(box)) box.switch_perspectives(old_persp, new_persp);
          }
        }
        // FIXME: Do we need to create a new dragger as well?
        this.updateZOrders();
        DocumentUndo.done(drag.document, C_('Undo', 'Split vanishing points'), 'draw-cuboid');
        return;
      }
    }

    if (!state.shiftKey) {
      // without Shift; see if we need to snap to another dragger
      for (const d_new of drag.draggers) {
        if (d_new === this || L2(d_new.point.sub(p)) >= snap_dist) continue;
        // this would result in degenerate boxes, which we disallow for the time being
        if (this.vps.some((vp) => vp.get_perspective() && d_new.hasPerspective(vp.get_perspective()!)))
          continue;
        // update positions ... (this is needed so that the perspectives are detected as identical)
        for (const vp of this.vps) vp.set_pos(d_new.point);
        // ... join lists of VPs ...
        d_new.vps.push(...this.vps);
        this.vps = [];
        // ... delete old dragger ...
        drag.draggers.splice(drag.draggers.indexOf(this), 1);
        this.destroy();
        // ... and merge any duplicate perspectives
        d_new.mergePerspectives();
        drag.updateBoxDisplays(); // FIXME: Only update boxes in current dragger!
        d_new.updateZOrders();
        drag.updateLines();
        DocumentUndo.done(drag.document, C_('Undo', 'Merge vanishing points'), 'draw-cuboid');
        return;
      }
    }

    // We didn't snap to another dragger: try a regular snap. Here SHIFT does not disable
    // snapping, as the shift key has a different purpose in this context (see above).
    const m = desktop.getSnapManager();
    m.setup(desktop);
    const s = m.freeSnap(new SnapCandidatePoint(p, SnapSourceType.SNAPSOURCE_OTHER_HANDLE));
    m.unSetup();
    if (s.getSnapped()) {
      p = s.getPoint();
      knot.moveto(p);
    }
    this.point = p;
    this.updateVPs(p);
    this.updateBoxDisplays();
    drag.updateBoxHandles(); // FIXME: Only update the handles of boxes on this dragger (not on all)
    this.updateZOrders();
    drag.updateLines();
    this.dragging_started = true;
  }

  #ungrabbed(knot: SPKnot): void {
    this.point_original = this.point = knot.pos;
    this.dragging_started = false;
    for (const vp of this.vps) {
      vp.set_pos(knot.pos);
      vp.updateBoxReprs();
      vp.updatePerspRepr();
    }
    const drag = this.parent;
    drag.dragging = false;
    drag.updateDraggers();
    drag.updateLines();
    drag.updateBoxHandles();
    DocumentUndo.done(drag.document, C_('Undo', '3D box: Move vanishing point'), 'draw-cuboid');
  }

  /** Adds a vanishing point to the dragger (also updates the position if necessary). */
  addVP(vp: VanishingPoint, update_pos = false): void {
    // don't add infinite VPs; don't add the same VP twice
    if (!vp.is_finite() || this.vps.some((v) => v.equals(vp))) return;
    if (update_pos) vp.set_pos(this.point);
    this.vps.unshift(vp);
  }

  removeVP(vp: VanishingPoint): void {
    const i = this.vps.findIndex((v) => v.equals(vp));
    if (i >= 0) this.vps.splice(i, 1);
  }

  findVPWithBox(box: SPBox3D): VanishingPoint | null {
    return this.vps.find((vp) => vp.hasBox(box)) ?? null;
  }

  VPsOfSelectedBoxes(): Set<VanishingPoint> {
    const sel_vps = new Set<VanishingPoint>();
    for (const item of this.parent.desktop.getSelection().items()) {
      if (!(item instanceof SPBox3D)) continue;
      const vp = this.findVPWithBox(item);
      if (vp) sel_vps.add(vp);
    }
    return sel_vps;
  }

  /** the number of boxes linked to all VPs of the dragger */
  numberOfBoxes(): number {
    return this.vps.reduce((n, vp) => n + vp.numberOfBoxes(), 0);
  }

  hasPerspective(persp: Persp3D): boolean {
    return this.vps.some((vp) => {
      const p = vp.get_perspective();
      return !!p && persp.perspectives_coincide(p);
    });
  }

  /** remove duplicate perspectives */
  mergePerspectives(): void {
    for (let i = 0; i < this.vps.length; i++) {
      const persp1 = this.vps[i]!.get_perspective();
      for (let j = i; j < this.vps.length; j++) {
        const persp2 = this.vps[j]!.get_perspective();
        /* don't merge a perspective with itself */
        if (!persp1 || !persp2 || persp1 === persp2) continue;
        /* if perspectives coincide but are not the same, merge them */
        if (persp1.perspectives_coincide(persp2)) {
          persp1.absorb(persp2);
          this.parent.swap_perspectives_of_VPs(persp2, persp1);
          persp2.deleteObject(false);
        }
      }
    }
  }

  updateBoxDisplays(): void {
    for (const vp of this.vps) vp.updateBoxDisplays();
  }
  updateVPs(pt: Point): void {
    for (const vp of this.vps) vp.set_pos(pt);
  }
  updateZOrders(): void {
    for (const vp of this.vps) vp.get_perspective()?.update_z_orders();
  }
}

/**
 * The vanishing point knots and the perspective lines of the selected 3D boxes (upstream
 * VPDrag). Infinite vanishing points have no knot; their perspective lines run to the edge
 * of the window.
 */
export class VPDrag {
  readonly desktop: SPDesktop;
  readonly document: SPDocument;
  dragging = false;
  draggers: VPDragger[] = [];
  item_curves: CanvasItemCurve[] = [];
  /** whether perspective lines are drawn at all */
  show_lines = true;
  /** whether we draw perspective lines from all corners or only the front/rear corners (first/second bit) */
  front_or_rear_lines = 0x1;
  /** Called after the boxes changed, to update the handles of the selected box (upstream: the knotholder). */
  onBoxHandles: (() => void) | null = null;
  readonly #selection: Selection;
  readonly #disconnect: (() => void)[];

  constructor(desktop: SPDesktop) {
    this.desktop = desktop;
    this.document = desktop.getDocument();
    this.#selection = desktop.getSelection();
    this.#disconnect = [
      this.#selection.connectChanged(() => {
        this.updateDraggers();
        this.updateLines();
        this.updateBoxReprs();
      }),
      this.#selection.connectModified(() => {
        this.updateLines();
        this.updateBoxHandles(); // FIXME: Only update the handles of boxes on this dragger (not on all)
        this.updateDraggers();
      }),
    ];
    this.updateDraggers();
    this.updateLines();
  }

  destroy(): void {
    for (const f of this.#disconnect) f();
    for (const d of this.draggers) d.destroy();
    this.draggers = [];
    for (const c of this.item_curves) c.unlink();
    this.item_curves = [];
  }

  /** Select the dragger that has the given VP. */
  getDraggerFor(vp: VanishingPoint): VPDragger | null {
    return this.draggers.find((d) => d.vps.some((v) => v.equals(vp))) ?? null;
  }

  /** Regenerates the draggers list from the current selection; is called when selection is changed or modified */
  updateDraggers(): void {
    if (this.dragging) return;
    // delete old draggers
    for (const d of this.draggers) d.destroy();
    this.draggers = [];
    for (const item of this.#selection.items()) {
      if (!(item instanceof SPBox3D)) continue;
      for (const axis of [Proj.Axis.X, Proj.Axis.Y, Proj.Axis.Z]) {
        this.addDragger(new VanishingPoint(item.get_perspective(), axis));
      }
    }
  }

  /**
   * Regenerates the lines list from the current selection; is called on each move
   * of a dragger, so that lines are always in sync with the actual perspective
   */
  updateLines(): void {
    // Delete old lines
    for (const c of this.item_curves) c.unlink();
    this.item_curves = [];
    // do nothing if perspective lines are currently disabled
    if (!this.show_lines) return;
    for (const item of this.#selection.items()) {
      if (!(item instanceof SPBox3D)) continue;
      this.drawLinesForFace(item, Proj.Axis.X);
      this.drawLinesForFace(item, Proj.Axis.Y);
      this.drawLinesForFace(item, Proj.Axis.Z);
    }
  }

  updateBoxHandles(): void {
    // Currently we only show handles if a single box is selected
    if (this.#selection.items().length !== 1) return;
    this.onBoxHandles?.();
  }

  updateBoxReprs(): void {
    for (const d of this.draggers) for (const vp of d.vps) vp.updateBoxReprs();
  }

  updateBoxDisplays(): void {
    for (const d of this.draggers) for (const vp of d.vps) vp.updateBoxDisplays();
  }

  /** Draw the front and/or rear perspective lines of the face towards the VP of axis. */
  drawLinesForFace(box: SPBox3D, axis: Proj.Axis): void {
    // TODO: Make color selectable by user
    const color =
      axis === Proj.Axis.X
        ? CANVAS_ITEM_COLORS[1]
        : axis === Proj.Axis.Y
          ? CANVAS_ITEM_COLORS[0]
          : CANVAS_ITEM_COLORS[2];
    const corners = box.corners_for_PLs(axis);
    const persp = box.get_perspective();
    if (!corners || !persp) return;
    const vp = persp.get_VP(axis);
    let ends: Point[];
    if (vp.is_finite()) {
      // draw perspective lines for finite VPs
      const pt = vp.affine();
      ends = [pt, pt, pt, pt];
    } else {
      // draw perspective lines for infinite VPs
      const area = this.desktop.get_display_area();
      const pts = corners.map((c) => new PerspectiveLine(c, axis, persp).intersection_with_viewbox(area));
      // some perspective lines are outside the canvas; currently we don't draw any of them
      if (pts.some((p) => !p)) return;
      ends = pts as Point[];
    }
    // draw 'front' perspective lines
    if (this.front_or_rear_lines & 0x1) {
      this.#addCurve(corners[0], ends[0]!, color);
      this.#addCurve(corners[1], ends[1]!, color);
    }
    // draw 'rear' perspective lines
    if (this.front_or_rear_lines & 0x2) {
      this.#addCurve(corners[2], ends[2]!, color);
      this.#addCurve(corners[3], ends[3]!, color);
    }
  }

  /**
   * If there already exists a dragger within MERGE_DIST of p, add the VP to it;
   * otherwise create new dragger and add it to draggers list
   */
  addDragger(vp: VanishingPoint): void {
    // don't create draggers for infinite vanishing points
    if (!vp.is_finite()) return;
    const p = vp.get_pos();
    for (const d of this.draggers) {
      if (L2(d.point.sub(p)) < MERGE_DIST) {
        // distance is small, merge this draggable into dragger, no need to create new dragger
        d.addVP(vp);
        return;
      }
    }
    this.draggers.push(new VPDragger(this, p, vp));
  }

  /** iterate over all VP in all draggers and replace persp2 with persp1 */
  swap_perspectives_of_VPs(persp2: Persp3D, persp1: Persp3D): void {
    for (const d of this.draggers) {
      for (const vp of d.vps) if (vp.get_perspective() === persp2) vp.set_perspective(persp1);
    }
  }

  #addCurve(p1: Point, p2: Point, color: number): void {
    const item = new CanvasItemCurve(this.desktop.getCanvasControls());
    item.set_coords(p1, p2);
    item.set_stroke(color);
    this.item_curves.push(item);
  }
}
