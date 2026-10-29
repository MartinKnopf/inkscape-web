// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/knot/knot-holder-entity.cpp, src/ui/knot/knot-holder-entity.h
/*
 * KnotHolderEntity definition.
 *
 * Authors:
 *   Mitsuru Oka <oka326@parkcity.ne.jp>
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2001 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2001 Mitsuru Oka
 * Copyright (C) 2004 Monash University
 * Copyright (C) 2008 Maximilian Albert
 */
import type { Affine, Point } from '@inkscape-web/geom';
import { C_ } from '../../i18n.ts';
import type { SPItem } from '../../object/sp-item.ts';

/** The modifier keys of a knot event (the editor's ModifierState). */
export interface KnotState {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Ctrl, or Cmd on macOS (upstream GDK_CONTROL_MASK). */
export const knot_state_ctrl = (s: KnotState): boolean => s.ctrlKey || s.metaKey;

/** The on-canvas knot of an entity (upstream SPKnot; the editor implements it). */
export interface Knot {
  /** Position in desktop coordinates. */
  pos: Point;
  /** Where the drag started, in desktop coordinates. */
  drag_origin: Point;
  /** True for the knots of path effects (their entities write their own undo step). */
  is_lpe: boolean;
  show(): void;
  hide(): void;
  is_visible(): boolean;
  /** Move to dp (desktop coordinates) without telling the holder. */
  moveto(dp: Point): void;
  destroy(): void;
}

/**
 * The part of the knot holder that entities use (upstream KnotHolder; the editor implements it
 * with knots on the canvas).
 */
export interface KnotHolder {
  getItem(): SPItem;
  getEditTransform(): Affine;
  add(e: KnotHolderEntity): void;
  update_knots(): void;
  /**
   * Make the knot of an entity. type is the name of a CanvasItemCtrlType member, e.g.
   * "CANVAS_ITEM_CTRL_TYPE_LPE".
   */
  createKnot(entity: KnotHolderEntity, type: string, name: string, tip: string): Knot;
  /** Snap p (desktop coordinates) as a node handle of item; returns p if there is no snapping. */
  snap(p: Point, state: KnotState): Point;
}

/**
 * A handle of a knot holder (upstream KnotHolderEntity). The get/set/click handlers are virtual
 * functions; each handler class for a knot should be derived from KnotHolderEntity and override
 * these functions. Positions are in item coordinates (with the edit transform of the holder).
 */
export abstract class KnotHolderEntity {
  knot: Knot | null = null;
  item: SPItem | null = null;
  parent_holder: KnotHolder | null = null;

  /** Make the knot (upstream create(); the desktop is the one of the holder). */
  create(
    _desktop: unknown,
    item: SPItem,
    parent: KnotHolder,
    type = 'CANVAS_ITEM_CTRL_TYPE_DEFAULT',
    name = 'unknown',
    tip = '',
  ): void {
    this.parent_holder = parent;
    this.item = item; // TODO: remove the item either from here or from knotholder.cpp
    this.knot = parent.createKnot(this, type, name, tip);
    this.on_created();
    this.update_knot();
    this.knot.show();
  }

  abstract knot_set(p: Point, origin: Point, state: KnotState): void;
  knot_grabbed(_grab_position: Point, _state: KnotState): void {}
  abstract knot_ungrabbed(p: Point, origin: Point, state: KnotState): void;
  knot_missing(): boolean {
    return false;
  }
  abstract knot_get(): Point;
  knot_click(_state: KnotState): void {}
  on_created(): void {}

  update_knot(): void {
    const knot_pos = this.knot_get();
    if (!this.knot || !this.item || !this.parent_holder) return;
    if (knot_pos.isFinite()) {
      const dp = knot_pos.transformed(this.parent_holder.getEditTransform().multiply(this.item.i2dtAffine()));
      this.knot.moveto(dp);
    } else {
      this.knot.hide();
    }
  }

  snap_knot_position(p: Point, state: KnotState): Point {
    if (state.shiftKey || !this.item || !this.parent_holder) return p; // Don't snap when shift-key is held
    const i2dt = this.parent_holder.getEditTransform().multiply(this.item.i2dtAffine());
    const s = this.parent_holder.snap(p.transformed(i2dt), state);
    return s.transformed(i2dt.inverse());
  }

  destroy(): void {
    this.knot?.destroy();
    this.knot = null;
  }
}

/** The effects that LPE knots call back (upstream LPEKnotHolderEntity<T> template). */
interface UndoableEffect {
  makeUndoDone(message: string): void;
}

/** A knot of a path effect: releasing it writes the effect's undo step. */
export abstract class LPEKnotHolderEntity<T extends UndoableEffect> extends KnotHolderEntity {
  protected readonly _effect: T;

  constructor(effect: T) {
    super();
    this._effect = effect;
  }

  knot_ungrabbed(_p: Point, _origin: Point, _state: KnotState): void {
    this._effect?.makeUndoDone(C_('Undo', 'Move handle'));
  }
}
