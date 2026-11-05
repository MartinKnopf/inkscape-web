// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-perp_bisector.cpp, src/live_effects/lpe-perp_bisector.h
/** \file
 * LPE <perp_bisector> implementation
 */
/*
 * Authors:
 *   Maximilian Albert
 *   Johan Engelen
 *
 * Copyright (C) Johan Engelen 2007-2012
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type PathVector, Point, unit_vector } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { type KnotHolder, type KnotState, LPEKnotHolderEntity } from '../ui/knot/knot-holder-entity.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { pathFromLine } from './pwd2.ts';

/**
 * Perpendicular bisector (upstream LPEPerpBisector): the line that is perpendicular to the line
 * from the first to the last node, through its middle point.
 */
export class LPEPerpBisector extends Effect {
  readonly length_left: ScalarParam;
  readonly length_right: ScalarParam;
  A = new Point(0, 0);
  B = new Point(0, 0);
  M = new Point(0, 0);
  C = new Point(0, 0);
  D = new Point(0, 0);
  perp_dir = new Point(0, 0);

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.length_left = new ScalarParam(
      _('Length left:'),
      _('Specifies the left end of the bisector'),
      'length-left',
      this,
      200,
    );
    this.length_right = new ScalarParam(
      _('Length right:'),
      _('Specifies the right end of the bisector'),
      'length-right',
      this,
      200,
    );
    this.show_orig_path = true;
    this._provides_knotholder_entities = true;

    this.registerParameter(this.length_left);
    this.registerParameter(this.length_right);
  }

  /** Upstream doEffect_pwd2 on each subpath. */
  protected override doEffect_path(path_in: PathVector): PathVector {
    const path_out: PathVector = [];
    for (const path of path_in) {
      this.A = path.initialPoint();
      this.B = path.finalPoint();
      this.M = this.A.add(this.B).div(2);

      this.perp_dir = unit_vector(this.B.sub(this.A).ccw());

      this.C = this.M.add(this.perp_dir.mul(this.length_left.get_value()));
      this.D = this.M.sub(this.perp_dir.mul(this.length_right.get_value()));

      path_out.push(pathFromLine(this.C, this.D));
    }
    return path_out;
  }

  protected override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    const left = new KnotHolderEntityLeftEnd(this);
    left.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:PerpBisectorLeftEnd',
      _('Adjust the "left" end of the bisector'),
    );
    knotholder.add(left);
    const right = new KnotHolderEntityRightEnd(this);
    right.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:PerpBisectorRightEnd',
      _('Adjust the "right" end of the bisector'),
    );
    knotholder.add(right);
  }
}

abstract class KnotHolderEntityEnd extends LPEKnotHolderEntity<LPEPerpBisector> {
  bisector_end_set(p: Point, state: KnotState, left = true): void {
    const s = this.snap_knot_position(p, state);
    const e = this._effect;

    const lambda = s.sub(e.M).dot(e.perp_dir); // Geom::nearest_time(s, M, perp_dir)
    if (left) {
      e.C = e.M.add(e.perp_dir.mul(lambda));
      e.length_left.param_set_value(lambda);
    } else {
      e.D = e.M.add(e.perp_dir.mul(lambda));
      e.length_right.param_set_value(-lambda);
    }

    sp_lpe_item_update_patheffect(this.item as SPLPEItem, true, true);
  }
}

class KnotHolderEntityLeftEnd extends KnotHolderEntityEnd {
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    this.bisector_end_set(p, state);
  }

  knot_get(): Point {
    return this._effect.C;
  }
}

class KnotHolderEntityRightEnd extends KnotHolderEntityEnd {
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    this.bisector_end_set(p, state, false);
  }

  knot_get(): Point {
    return this._effect.D;
  }
}
