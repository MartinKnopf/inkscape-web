// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/knot/knot-holder.cpp, src/ui/knot/knot-holder.h
/*
 * Container for SPKnot visual handles.
 *
 * Authors:
 *   Mitsuru Oka <oka326@parkcity.ne.jp>
 *   bulia byak <buliabyak@users.sf.net>
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2001-2008 authors
 */
import {
  C_,
  type KnotHolder as CoreKnotHolder,
  DocumentUndo,
  type KnotHolderEntity,
  type KnotState,
  SnapSourceType,
  type SPItem,
  SPShape,
} from '@inkscape-web/core';
import { Affine, type Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemCtrlType } from '../../display/control/canvas-item-ctrl.ts';
import { SPKnot } from './knot.ts';

/**
 * The knots of an item, each one bound to a KnotHolderEntity (upstream KnotHolder). Under the
 * node tool it holds the knots of the current path effect (ShapeEditor).
 * TODO: the knots of shapes (rect, ellipse, star, spiral), patterns and hatches, knot selection
 * with Shift, transform_selected.
 */
export class KnotHolder implements CoreKnotHolder {
  readonly desktop: SPDesktop;
  readonly item: SPItem;
  readonly entity: KnotHolderEntity[] = [];
  #edit_transform = Affine.identity();
  #dragging = false;
  /** Called after a knot moved the item (upstream update of the ShapeEditor). */
  onChanged: (() => void) | null = null;

  constructor(desktop: SPDesktop, item: SPItem) {
    this.desktop = desktop;
    this.item = item;
  }

  getItem(): SPItem {
    return this.item;
  }
  getDesktop(): SPDesktop {
    return this.desktop;
  }
  getEditTransform(): Affine {
    return this.#edit_transform;
  }
  setEditTransform(edit_transform: Affine): void {
    this.#edit_transform = edit_transform;
  }

  /** Remove all knots. */
  clear(): void {
    for (const e of this.entity) e.destroy();
    this.entity.length = 0;
  }

  add(e: KnotHolderEntity): void {
    this.entity.push(e);
  }

  update_knots(): void {
    for (let i = 0; i < this.entity.length; ) {
      const e = this.entity[i] as KnotHolderEntity;
      if (e.knot_missing()) {
        e.destroy();
        this.entity.splice(i, 1);
      } else {
        e.update_knot();
        i++;
      }
    }
  }

  /** Make the SPKnot of an entity and connect its signals to the handlers of the holder. */
  createKnot(entity: KnotHolderEntity, type: string, _name: string, tip: string): SPKnot {
    const ctrlType =
      CanvasItemCtrlType[type as keyof typeof CanvasItemCtrlType] ??
      CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_DEFAULT;
    const knot = new SPKnot(this.desktop, tip, ctrlType);
    knot.is_lpe = ctrlType === CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_LPE;
    knot.moved_signal.connect((k, p, state) => this.knot_moved_handler(k, p, state, entity));
    knot.click_signal.connect((_k, state) => this.knot_clicked_handler(entity, state));
    knot.ungrabbed_signal.connect((k, state) => this.knot_ungrabbed_handler(k, state, entity));
    return knot;
  }

  snap(p: Point, _state: KnotState): Point {
    const m = this.desktop.getSnapManager();
    m.setup(this.desktop, true, this.item);
    const s = m.freeSnapReturnByRef(p, SnapSourceType.SNAPSOURCE_NODE_HANDLE);
    m.unSetup();
    return s;
  }

  knot_clicked_handler(e: KnotHolderEntity, state: KnotState): void {
    const saved_item = this.item;
    e.knot_click(state);
    if (saved_item instanceof SPShape) saved_item.set_shape();
    this.update_knots();
    if (saved_item.document) DocumentUndo.done(saved_item.document, C_('Undo', 'Change handle'), '');
  }

  knot_moved_handler(knot: SPKnot, p: Point, state: KnotState, e: KnotHolderEntity): void {
    const i2item = this.item.i2dtAffine().inverse().multiply(this.#edit_transform.inverse());
    if (!this.#dragging) {
      e.knot_grabbed(knot.drag_origin.transformed(i2item), state);
      this.#dragging = true;
    }
    e.knot_set(p.transformed(i2item), knot.drag_origin.transformed(i2item), state);
    if (this.item instanceof SPShape) this.item.set_shape();
    this.update_knots();
    this.item.updateRepr();
    DocumentUndo.maybeDone(this.item.document, 'move-handle', C_('Undo', 'Move handle'), '');
    this.onChanged?.();
  }

  knot_ungrabbed_handler(knot: SPKnot, state: KnotState, e: KnotHolderEntity): void {
    this.#dragging = false;
    this.desktop.getSnapIndicator().remove_snaptarget();
    const i2item = this.item.i2dtAffine().inverse().multiply(this.#edit_transform.inverse());
    e.knot_ungrabbed(knot.position(), knot.drag_origin.transformed(i2item), state);
    if (knot.is_lpe) {
      this.onChanged?.();
      return;
    }
    this.item.updateRepr();
    DocumentUndo.done(this.item.document, C_('Undo', 'Move handle'), '');
  }
}
