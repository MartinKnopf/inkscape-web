// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-parallel.cpp, src/live_effects/lpe-parallel.h
/** \file
 * LPE <parallel> implementation
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
import { L2, type PathVector, Point, unit_vector } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { SPShape } from '../object/sp-shape.ts';
import { type KnotHolder, type KnotState, LPEKnotHolderEntity } from '../ui/knot/knot-holder-entity.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { PointParam } from './parameter/point.ts';
import { pathFromLine } from './pwd2.ts';

/**
 * Parallel (upstream LPEParallel): a line parallel to the line from the first to the last node,
 * through the offset point, with an adjustable length on both sides.
 */
export class LPEParallel extends Effect {
  readonly offset_pt: PointParam;
  readonly length_left: ScalarParam;
  readonly length_right: ScalarParam;
  A = new Point(0, 0);
  B = new Point(0, 0);
  dir = new Point(0, 0);
  C = new Point(0, 0);
  D = new Point(0, 0);

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.offset_pt = new PointParam(_('Offset'), _('Adjust the offset'), 'offset_pt', this);
    this.length_left = new ScalarParam(
      _('Length left:'),
      _('Specifies the left end of the parallel'),
      'length-left',
      this,
      150,
    );
    this.length_right = new ScalarParam(
      _('Length right:'),
      _('Specifies the right end of the parallel'),
      'length-right',
      this,
      150,
    );
    this.show_orig_path = true;
    this._provides_knotholder_entities = true;

    this.registerParameter(this.offset_pt);
    this.registerParameter(this.length_left);
    this.registerParameter(this.length_right);
  }

  protected override doOnApply(lpeitem: SPLPEItem): void {
    if (!(lpeitem instanceof SPShape)) {
      console.warn('LPE parallel can only be applied to shapes (not groups).');
      lpeitem.removeCurrentPathEffect(false);
      return;
    }
    const curve = lpeitem.curve();
    const first = curve?.[0];
    const last = curve?.at(-1);
    if (!first || !last) return;

    this.A = first.initialPoint();
    this.B = last.finalPoint();
    this.dir = unit_vector(this.B.sub(this.A));
    const offset = this.A.add(this.B).div(2).add(this.dir.ccw().mul(100));
    this.offset_pt.param_update_default(offset);
    this.offset_pt.param_setValue(offset, true);
  }

  /** Upstream doEffect_pwd2 on each subpath. */
  protected override doEffect_path(path_in: PathVector): PathVector {
    const path_out: PathVector = [];
    for (const path of path_in) {
      this.A = path.initialPoint();
      this.B = path.finalPoint();
      this.dir = unit_vector(this.B.sub(this.A));

      this.C = this.offset_pt.value.sub(this.dir.mul(this.length_left.get_value()));
      this.D = this.offset_pt.value.add(this.dir.mul(this.length_right.get_value()));

      path_out.push(pathFromLine(this.C.add(this.dir), this.D.add(this.dir)));
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
      'LPE:ParallelLeftEnd',
      _('Adjust the "left" end of the parallel'),
    );
    knotholder.add(left);
    const right = new KnotHolderEntityRightEnd(this);
    right.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:ParallelRightEnd',
      _('Adjust the "right" end of the parallel'),
    );
    knotholder.add(right);
  }
}

/** L2(v) * sgn(dot(v, dir)) of the vector from the offset point to s. */
function signedLength(effect: LPEParallel, s: Point): number {
  const v = s.sub(effect.offset_pt.value);
  return L2(v) * Math.sign(v.dot(effect.dir));
}

class KnotHolderEntityLeftEnd extends LPEKnotHolderEntity<LPEParallel> {
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(p, state);
    this._effect.length_left.param_set_value(-signedLength(this._effect, s));
    sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, true);
  }

  knot_get(): Point {
    return this._effect.C;
  }
}

class KnotHolderEntityRightEnd extends LPEKnotHolderEntity<LPEParallel> {
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(p, state);
    this._effect.length_right.param_set_value(signedLength(this._effect, s));
    sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, true);
  }

  knot_get(): Point {
    return this._effect.D;
  }
}
