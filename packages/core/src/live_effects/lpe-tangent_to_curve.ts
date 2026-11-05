// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-tangent_to_curve.cpp, src/live_effects/lpe-tangent_to_curve.h
/** \file
 * LPE <tangent_to_curve> implementation
 */
/*
 * Authors:
 *   Johan Engelen
 *   Maximilian Albert
 *
 * Copyright (C) Johan Engelen 2007-2012
 * Copyright (C) Maximilian Albert 2008 <maximilian.albert@gmail.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type PathVector, Point, pathv_nearest_time, Rotate } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { SPShape } from '../object/sp-shape.ts';
import { type KnotHolder, type KnotState, LPEKnotHolderEntity } from '../ui/knot/knot-holder-entity.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { pathFromLine, pwd2Samples } from './pwd2.ts';

/**
 * Tangent to curve (upstream LPETangentToCurve): a line that touches the curve at an attachment
 * point, rotated by an additional angle.
 */
export class LPETangentToCurve extends Effect {
  readonly angle: ScalarParam;
  readonly t_attach: ScalarParam;
  readonly length_left: ScalarParam;
  readonly length_right: ScalarParam;
  ptA = new Point(0, 0);
  derivA = new Point(0, 0);
  C = new Point(0, 0);
  D = new Point(0, 0);

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.angle = new ScalarParam(
      _('Angle:'),
      _('Additional angle between tangent and curve'),
      'angle',
      this,
      0.0,
    );
    this.t_attach = new ScalarParam(
      _('Location along curve:'),
      _('Location of the point of attachment along the curve (between 0.0 and number-of-segments)'),
      't_attach',
      this,
      0.5,
    );
    this.length_left = new ScalarParam(
      _('Length left:'),
      _('Specifies the left end of the tangent'),
      'length-left',
      this,
      150,
    );
    this.length_right = new ScalarParam(
      _('Length right:'),
      _('Specifies the right end of the tangent'),
      'length-right',
      this,
      150,
    );
    this.show_orig_path = true;
    this._provides_knotholder_entities = true;

    this.registerParameter(this.angle);
    this.registerParameter(this.t_attach);
    this.registerParameter(this.length_left);
    this.registerParameter(this.length_right);
  }

  /** Upstream doEffect_pwd2 on each subpath. */
  protected override doEffect_path(path_in: PathVector): PathVector {
    const path_out: PathVector = [];
    for (const path of path_in) {
      const sampled = pwd2Samples(path, [this.t_attach.get_value()]);
      const sample = sampled?.samples[0];
      if (!sample) continue;
      this.ptA = sample.point;
      // TODO: Why are positive angles measured clockwise, not counterclockwise?
      this.derivA = sample.unit.transformed(Rotate.from_degrees(-this.angle.get_value()));

      this.C = this.ptA.sub(this.derivA.mul(this.length_left.get_value()));
      this.D = this.ptA.add(this.derivA.mul(this.length_right.get_value()));

      path_out.push(pathFromLine(this.C, this.D));
    }
    return path_out;
  }

  protected override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    const attach = new KnotHolderEntityAttachPt(this);
    attach.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:TangentToCurvePT',
      _('Adjust the point of attachment of the tangent'),
    );
    knotholder.add(attach);
    const left = new KnotHolderEntityLeftEnd(this);
    left.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:TangentToCurveLeftEnd',
      _('Adjust the <b>left</b> end of the tangent'),
    );
    knotholder.add(left);
    const right = new KnotHolderEntityRightEnd(this);
    right.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:TangetToCurveRightEnd',
      _('Adjust the <b>right</b> end of the tangent'),
    );
    knotholder.add(right);
  }
}

/**
 * The time of the point of pv nearest to s in the domain of paths_to_pw(pv): one unit per curve
 * that is not a point (Path::toPwSb), paths one after the other.
 */
function nearestTimeInPiecewise(pv: PathVector, s: Point): number {
  const pvt = pathv_nearest_time(pv, s);
  if (!pvt) return 0;
  let t = 0;
  for (const [i, path] of pv.entries()) {
    const curves = path.curves().filter((c) => !c.isDegenerate());
    if (i < pvt.path_index) {
      t += curves.length;
      continue;
    }
    const curve = path.curves()[pvt.curve_index];
    const index = path
      .curves()
      .slice(0, pvt.curve_index)
      .filter((c) => !c.isDegenerate()).length;
    return t + index + (curve?.isDegenerate() ? 0 : pvt.t);
  }
  return t;
}

class KnotHolderEntityAttachPt extends LPEKnotHolderEntity<LPETangentToCurve> {
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(p, state);

    if (!(this._effect.sp_lpe_item instanceof SPShape)) {
      console.warn('LPEItem is not a path!');
      return;
    }
    const t0 = nearestTimeInPiecewise(this._effect.pathvector_before_effect, s);
    this._effect.t_attach.param_set_value(t0);

    sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, true);
  }

  knot_get(): Point {
    return this._effect.ptA;
  }
}

class KnotHolderEntityLeftEnd extends LPEKnotHolderEntity<LPETangentToCurve> {
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(p, state);
    const lambda = s.sub(this._effect.ptA).dot(this._effect.derivA); // Geom::nearest_time(s, ptA, derivA)
    this._effect.length_left.param_set_value(-lambda);
    sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, true);
  }

  knot_get(): Point {
    return this._effect.C;
  }
}

class KnotHolderEntityRightEnd extends LPEKnotHolderEntity<LPETangentToCurve> {
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(p, state);
    const lambda = s.sub(this._effect.ptA).dot(this._effect.derivA);
    this._effect.length_right.param_set_value(lambda);
    sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, true);
  }

  knot_get(): Point {
    return this._effect.D;
  }
}
