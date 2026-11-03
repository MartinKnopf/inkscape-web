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
  _,
  C_,
  type KnotHolder as CoreKnotHolder,
  DocumentUndo,
  type KnotHolderEntity,
  type KnotState,
  PatternKnotHolderEntityAngle,
  PatternKnotHolderEntityScale,
  PatternKnotHolderEntityXY,
  SnapSourceType,
  type SPItem,
  SPPattern,
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
  #unwatch: (() => void) | null = null;
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
    this.#unwatch?.();
    this.#unwatch = null;
  }

  /** The knots that move, rotate and scale the patterns of the fill and stroke (upstream add_pattern_knotholder). */
  add_pattern_knotholder(): void {
    const item = this.item;
    const knots = (fill: boolean) => {
      const xy = new PatternKnotHolderEntityXY(fill);
      const angle = new PatternKnotHolderEntityAngle(fill);
      const scale = new PatternKnotHolderEntityScale(fill);
      const which = fill ? 'Fill' : 'Stroke';
      xy.create(
        this.desktop,
        item,
        this,
        fill ? 'CANVAS_ITEM_CTRL_TYPE_SIZER' : 'CANVAS_ITEM_CTRL_TYPE_MARKER',
        `Pattern:${which}:xy`,
        // TRANSLATORS: This refers to the pattern that's inside the object
        fill
          ? _('<b>Move</b> the pattern fill inside the object')
          : _("<b>Move</b> the stroke's pattern inside the object"),
      );
      scale.create(
        this.desktop,
        item,
        this,
        'CANVAS_ITEM_CTRL_TYPE_SIZER',
        `Pattern:${which}:scale`,
        fill
          ? _('<b>Scale</b> the pattern fill; uniformly if with <b>Ctrl</b>')
          : _("<b>Scale</b> the stroke's pattern; uniformly if with <b>Ctrl</b>"),
      );
      angle.create(
        this.desktop,
        item,
        this,
        'CANVAS_ITEM_CTRL_TYPE_ROTATE',
        `Pattern:${which}:angle`,
        fill
          ? _('<b>Rotate</b> the pattern fill; with <b>Ctrl</b> to snap angle')
          : _("<b>Rotate</b> the stroke's pattern; with <b>Ctrl</b> to snap angle"),
      );
      this.entity.push(xy, angle, scale);
    };
    if (item.style.getFillPaintServer() instanceof SPPattern) knots(true);
    if (item.style.getStrokePaintServer() instanceof SPPattern) knots(false);
    // watch patterns and update knots when they change
    this.#install_modification_watch();
  }

  /** Update the knots when the item or its patterns change (upstream install_modification_watch). */
  #install_modification_watch(): void {
    this.#unwatch?.();
    const servers = [this.item.style.getFillPaintServer(), this.item.style.getStrokePaintServer()];
    const offs = [
      this.item.modifiedSignal.connect(() => {
        this.update_knots();
        // the item may use another (linked) pattern now
        this.#install_modification_watch();
      }),
      ...servers
        .filter((s) => s instanceof SPPattern)
        .map((s) => s!.modifiedSignal.connect(() => this.update_knots())),
    ];
    this.#unwatch = () => {
      for (const f of offs) f();
    };
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
