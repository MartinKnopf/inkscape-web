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
import { Affine, atan2, Point, Rotate, Scale, Translate } from '@inkscape-web/geom';
import { C_ } from '../../i18n.ts';
import { PaintServerTransform, type SPItem } from '../../object/sp-item.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../../object/sp-object.ts';
import { PaintServerType } from '../../object/sp-paint-server-data.ts';
import type { SPPattern } from '../../object/sp-pattern.ts';
import { Preferences } from '../../preferences.ts';

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

/**
 * A knot of the pattern of the fill or stroke of the item (upstream PatternKnotHolderEntity).
 * The knots sit on the pattern cell nearest to the middle of the item.
 */
export abstract class PatternKnotHolderEntity extends KnotHolderEntity {
  /** true if the entity tracks fill, false for stroke */
  protected readonly _fill: boolean;
  protected _cell = new Point(0, 0);

  constructor(fill: boolean) {
    super();
    this._fill = fill;
  }

  override on_created(): void {
    // Setup an initial pattern transformation in the center
    const rect = this.item?.documentGeometricBounds();
    if (rect) this._cell = this.offset_to_cell(rect.midpoint());
  }

  override knot_missing(): boolean {
    return !this._pattern();
  }

  knot_ungrabbed(): void {}

  protected _pattern(): SPPattern | null {
    const server = this._fill
      ? this.item?.style.getFillPaintServer()
      : this.item?.style.getStrokePaintServer();
    return server?.getPaintType() === PaintServerType.PATTERN ? (server as SPPattern) : null;
  }

  /** Returns the position based on the pattern's origin, shifted by the percent x/y of its size. */
  protected _get_pos(x: number, y: number, transform = true): Point {
    const pat = this._pattern();
    if (!pat) return new Point(0, 0);
    const pt = new Point((this._cell.x + x) * pat.width(), (this._cell.y + y) * pat.height());
    return transform ? pt.transformed(pat.getTransform()) : pt;
  }

  /** The grid index of the pattern repetition at loc (document coordinates). */
  protected offset_to_cell(loc: Point): Point {
    const pat = this._pattern();
    if (!pat || !this.item) return new Point(0, 0);
    // 1. Turn the location into the pattern grid coordinate
    const d2i = this.item.i2docAffine().inverse();
    const i2p = pat.getTransform().inverse();
    const p = loc.transformed(d2i).transformed(i2p);
    // Get grid index of nearest pattern repetition.
    return new Point(Math.floor(p.x / pat.width()), Math.floor(p.y / pat.height()));
  }

  protected get _which(): PaintServerTransform {
    return this._fill ? PaintServerTransform.TRANSFORM_FILL : PaintServerTransform.TRANSFORM_STROKE;
  }
}

/** Moves the pattern (upstream PatternKnotHolderEntityXY). TODO: the quad that shows the tile. */
export class PatternKnotHolderEntityXY extends PatternKnotHolderEntity {
  knot_get(): Point {
    return this._get_pos(0, 0);
  }

  knot_set(p: Point, origin: Point, state: KnotState): void {
    let p_snapped = this.snap_knot_position(p, state);
    if (knot_state_ctrl(state)) {
      p_snapped =
        Math.abs(p.x - origin.x) > Math.abs(p.y - origin.y)
          ? new Point(p_snapped.x, origin.y)
          : new Point(origin.x, p_snapped.y);
    }
    const q = p_snapped.sub(this.knot_get());
    this.item?.adjust_pattern(Translate(q), false, this._which);
    this.item?.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }
}

/** Rotates the pattern around its origin (upstream PatternKnotHolderEntityAngle). */
export class PatternKnotHolderEntityAngle extends PatternKnotHolderEntity {
  knot_get(): Point {
    return this._get_pos(1.0, 0);
  }

  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const snaps = Math.min(
      Math.max(Preferences.get().getDouble('/options/rotationsnapsperpi/value', 12.0), 0.1),
      1800.0,
    );
    // get the angle from pattern 0,0 to the cursor pos
    const transform_origin = this._get_pos(0, 0);
    let theta = atan2(p.sub(transform_origin));
    const theta_old = atan2(this.knot_get().sub(transform_origin));
    if (knot_state_ctrl(state)) {
      // Snap theta
      const snaps_radian = Math.PI / snaps;
      theta = Math.round(theta / snaps_radian) * snaps_radian;
    }
    const rot = Translate(transform_origin.neg())
      .multiply(Rotate(theta - theta_old))
      .multiply(Translate(transform_origin));
    this.item?.adjust_pattern(rot, false, this._which);
    this.item?.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }
}

/** Maximum number of pattern repetitons allowed in an item */
const MAX_REPETITIONS = 1e6;

/** Scales the pattern; uniformly with Ctrl (upstream PatternKnotHolderEntityScale). */
export class PatternKnotHolderEntityScale extends PatternKnotHolderEntity {
  #cached_transform = Affine.identity();
  #cached_inverse_linear = Affine.identity();
  #cached_origin = new Point(0, 0);
  #cached_diagonal = new Point(1, 1);
  #cached_min_scale = 1e-6;

  knot_get(): Point {
    return this._get_pos(1.0, 1.0);
  }

  /** Store pattern geometry info when the scale knot is first grabbed. */
  override knot_grabbed(grab_pos: Point): void {
    const pattern = this._pattern();
    if (!pattern || !this.item) return;
    this.#cached_transform = pattern.getTransform();
    this.#cached_origin = this._get_pos(0, 0);
    this.#cached_inverse_linear = this.#cached_transform.withoutTranslation().inverse();
    this.#cached_diagonal = grab_pos.sub(this.#cached_origin).transformed(this.#cached_inverse_linear);
    const bounding_box = this.item.documentVisualBounds();
    if (bounding_box) {
      // Compare the areas of the pattern and the item to find the number of repetitions.
      const pattern_area = Math.abs(this.#cached_diagonal.x * this.#cached_diagonal.y);
      const item_area =
        (bounding_box.area() * this.#cached_inverse_linear.descrim2()) /
        (this.item.i2docAffine().descrim2() ? 1.0 : 1e-3);
      this.#cached_min_scale = Math.sqrt(item_area / (pattern_area * MAX_REPETITIONS));
    } else {
      this.#cached_min_scale = 1e-6;
    }
  }

  knot_set(p: Point, _origin: Point, state: KnotState): void {
    // FIXME: this snapping should be done together with knowing whether control was pressed.
    // If GDK_CONTROL_MASK, then constrained snapping should be used.
    const p_snapped = this.snap_knot_position(p, state);
    const new_extent = p_snapped.sub(this.#cached_origin).transformed(this.#cached_inverse_linear);
    // 1. Calculate absolute scale factor first
    const clamp = (v: number) => Math.min(Math.max(v, this.#cached_min_scale), 1e9);
    const scale_x = clamp(new_extent.x / this.#cached_diagonal.x);
    const scale_y = clamp(new_extent.y / this.#cached_diagonal.y);
    let new_transform = knot_state_ctrl(state) ? Scale((scale_x + scale_y) * 0.5) : Scale(scale_x, scale_y);
    // 2. Calculate offset to keep pattern origin aligned
    new_transform = new_transform.multiply(this.#cached_transform);
    const new_uncompensated_origin = this._get_pos(0, 0, false).transformed(new_transform);
    new_transform = new_transform.multiply(Translate(this.#cached_origin.sub(new_uncompensated_origin)));
    this.item?.adjust_pattern(new_transform, true, this._which);
    this.item?.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }
}
