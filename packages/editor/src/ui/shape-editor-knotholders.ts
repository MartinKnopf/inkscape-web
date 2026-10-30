// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/shape-editor-knotholders.cpp
/*
 * Node editing extension to objects
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Mitsuru Oka
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Licensed under GNU GPL
 *
 * TODO: the knot holders of the other shapes (rect, ellipse, star, spiral, offset, text, ...).
 */
import { _, Box3D, KnotHolderEntity, type KnotState, knot_state_ctrl, SPBox3D } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../desktop.ts';
import { KnotHolder } from './knot/knot-holder.ts';

/** box3d-change-knot-direction: Shift (upstream Modifiers). */
const mod_change_direction = (s: KnotState): boolean => s.shiftKey;
/** trans-confine: Ctrl */
const mod_trans_confine = (s: KnotState): boolean => knot_state_ctrl(s);

/** A corner of a 3D box (upstream Box3DKnotHolderEntity). */
class Box3DKnotHolderEntity extends KnotHolderEntity {
  readonly #knot_id: number;
  readonly #desktop: SPDesktop;

  constructor(desktop: SPDesktop, knot_id: number) {
    super();
    this.#desktop = desktop;
    this.#knot_id = knot_id;
  }

  knot_get(): Point {
    return this.item instanceof SPBox3D ? this.item.get_corner_screen(this.#knot_id) : new Point(0, 0);
  }

  knot_set(new_pos: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(new_pos, state);
    const box = this.item;
    if (!(box instanceof SPBox3D)) return;
    const i2dt = box.i2dtAffine();
    const movement =
      this.default_direction_is_xy() !== mod_change_direction(state) ? Box3D.Axis.XY : Box3D.Axis.Z;
    box.set_corner(
      this.#knot_id,
      s.transformed(i2dt),
      movement,
      mod_trans_confine(state),
      this.#desktop.current_zoom(),
    );
    box.set_z_orders();
    box.position_set();
  }

  knot_ungrabbed(): void {}

  default_direction_is_xy(): boolean {
    return this.#knot_id < 4;
  }
}

/** The center of a 3D box (upstream Box3DKnotHolderEntityCenter). */
class Box3DKnotHolderEntityCenter extends KnotHolderEntity {
  readonly #desktop: SPDesktop;

  constructor(desktop: SPDesktop) {
    super();
    this.#desktop = desktop;
  }

  knot_get(): Point {
    return this.item instanceof SPBox3D ? this.item.get_center_screen() : new Point(0, 0);
  }

  knot_set(new_pos: Point, origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(new_pos, state);
    const box = this.item;
    if (!(box instanceof SPBox3D)) return;
    const i2dt = box.i2dtAffine();
    box.set_center(
      s.transformed(i2dt),
      origin.transformed(i2dt),
      !mod_change_direction(state) ? Box3D.Axis.XY : Box3D.Axis.Z,
      mod_trans_confine(state),
      this.#desktop.current_zoom(),
    );
    box.set_z_orders();
    box.position_set();
  }

  knot_ungrabbed(): void {}
}

/** The corner and center knots of a 3D box (upstream Box3DKnotHolder). TODO: pattern and hatch knots. */
export class Box3DKnotHolder extends KnotHolder {
  constructor(desktop: SPDesktop, item: SPBox3D) {
    super(desktop, item);
    for (let knot_id = 0; knot_id < 8; ++knot_id) {
      const entity_corner = new Box3DKnotHolderEntity(desktop, knot_id);
      const tooltip = entity_corner.default_direction_is_xy()
        ? _(
            'Resize box in X/Y direction; with <b>%1</b> along the Z axis; with <b>%2</b> to constrain to the directions of edges or diagonals',
          )
        : _(
            'Resize box along the Z axis; with <b>%1</b> in X/Y direction; with <b>%2</b> to constrain to the directions of edges or diagonals',
          );
      entity_corner.create(
        desktop,
        item,
        this,
        'CANVAS_ITEM_CTRL_TYPE_SHAPER',
        `Box3D:corner${knot_id}`,
        tooltip.replace('%1', 'Shift').replace('%2', 'Ctrl'),
      );
      this.add(entity_corner);
    }
    const entity_center = new Box3DKnotHolderEntityCenter(desktop);
    entity_center.create(
      desktop,
      item,
      this,
      'CANVAS_ITEM_CTRL_TYPE_MARKER',
      'Box3D:center',
      _('Move the box in perspective'),
    );
    this.add(entity_center);
  }
}
