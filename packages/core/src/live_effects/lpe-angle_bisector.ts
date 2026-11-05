// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-angle_bisector.cpp, src/live_effects/lpe-angle_bisector.h
/*
 * Authors:
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *   Johan Engelen <j.b.c.engelen@alumnus.utwente.nl>
 *
 * Copyright (C) Authors 2007-2012
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { angle_between, type PathVector, Point, Rotate, unit_vector } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { type KnotHolder, type KnotState, LPEKnotHolderEntity } from '../ui/knot/knot-holder-entity.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { pathFromLine } from './pwd2.ts';

/**
 * Angle bisector (upstream LPEAngleBisector): the line that halves the angle at the second node of
 * the path, with an adjustable length on both sides.
 */
export class LPEAngleBisector extends Effect {
  readonly length_left: ScalarParam;
  readonly length_right: ScalarParam;
  ptA = new Point(0, 0);
  dir = new Point(0, 0);

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.length_left = new ScalarParam(
      _('Length left:'),
      _('Specifies the left end of the bisector'),
      'length-left',
      this,
      0,
    );
    this.length_right = new ScalarParam(
      _('Length right:'),
      _('Specifies the right end of the bisector'),
      'length-right',
      this,
      250,
    );
    this.show_orig_path = true;
    this._provides_knotholder_entities = true;
    this.registerParameter(this.length_left);
    this.registerParameter(this.length_right);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const first = path_in[0];
    if (!first) return path_in;
    // we assume that the path has >= 3 nodes
    this.ptA = first.pointAt(1);
    const B = first.initialPoint();
    const C = first.pointAt(2);

    const angle = angle_between(B.sub(this.ptA), C.sub(this.ptA));

    this.dir = unit_vector(B.sub(this.ptA)).transformed(Rotate(angle / 2));

    const D = this.ptA.sub(this.dir.mul(this.length_left.get_value()));
    const E = this.ptA.add(this.dir.mul(this.length_right.get_value()));
    return [pathFromLine(D, E)];
  }

  protected override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    const left = new KnotHolderEntityLeftEnd(this);
    left.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:LeftEnd',
      _('Adjust the "left" end of the bisector'),
    );
    knotholder.add(left);
    const right = new KnotHolderEntityRightEnd(this);
    right.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:RightEnd',
      _('Adjust the "right" end of the bisector'),
    );
    knotholder.add(right);
  }
}

class KnotHolderEntityLeftEnd extends LPEKnotHolderEntity<LPEAngleBisector> {
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(p, state);
    const lambda = s.sub(this._effect.ptA).dot(this._effect.dir); // Geom::nearest_time(s, ptA, dir)
    this._effect.length_left.param_set_value(-lambda);
    sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, true);
  }

  knot_get(): Point {
    return this._effect.ptA.sub(this._effect.dir.mul(this._effect.length_left.get_value()));
  }
}

class KnotHolderEntityRightEnd extends LPEKnotHolderEntity<LPEAngleBisector> {
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(p, state);
    const lambda = s.sub(this._effect.ptA).dot(this._effect.dir);
    this._effect.length_right.param_set_value(lambda);
    sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, true);
  }

  knot_get(): Point {
    return this._effect.ptA.add(this._effect.dir.mul(this._effect.length_right.get_value()));
  }
}
