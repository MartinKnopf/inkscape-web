// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-offset.cpp, src/live_effects/lpe-offset.h
/** \file
 * LPE <offset> implementation
 */
/*
 * Authors:
 *   Maximilian Albert
 *   Jabiertxo Arraiza
 *
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 * Copyright (C) Maximilian Albert 2008 <maximilian.albert@gmail.com>
 * Copyright (C) Jabierto Arraiza 2015 <jabier.arraiza@marker.es>
 */
import {
  type Affine,
  are_near,
  distance,
  type Path,
  type PathVector,
  Point,
  pathv_nearest_time,
  pathv_point_at,
} from '@inkscape-web/geom';
import { _, C_, N_ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import { sp_item_transform_repr } from '../object/sp-item.ts';
import { SPGroup } from '../object/sp-item-group.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { SPShape } from '../object/sp-shape.ts';
import { FillRule, pathBoolopBackend } from '../path/path-boolop.ts';
import { convertUnit } from '../svg/svg-length.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../svg/svg-path.ts';
import { type KnotHolder, type KnotState, LPEKnotHolderEntity } from '../ui/knot/knot-holder-entity.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { spReprCssAttr, spReprCssProperty } from '../xml/repr-css.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { UnitParam } from './parameter/unit.ts';

/** Upstream Inkscape::LineJoinType (helper/geom-pathstroke.h). */
export enum LineJoinType {
  JOIN_BEVEL,
  JOIN_ROUND,
  JOIN_MITER,
  JOIN_MITER_CLIP,
  JOIN_EXTRAPOLATE,
  JOIN_EXTRAPOLATE1,
  JOIN_EXTRAPOLATE2,
  JOIN_EXTRAPOLATE3,
}

const JoinTypeConverter = new EnumDataConverter<LineJoinType>([
  { id: LineJoinType.JOIN_BEVEL, label: N_('Beveled'), key: 'bevel' },
  { id: LineJoinType.JOIN_ROUND, label: N_('Rounded'), key: 'round' },
  { id: LineJoinType.JOIN_MITER, label: N_('Miter'), key: 'miter' },
  { id: LineJoinType.JOIN_MITER_CLIP, label: N_('Miter Clip'), key: 'miter-clip' },
  { id: LineJoinType.JOIN_EXTRAPOLATE, label: N_('Extrapolated arc'), key: 'extrp_arc' },
  { id: LineJoinType.JOIN_EXTRAPOLATE1, label: N_('Extrapolated arc Alt1'), key: 'extrp_arc1' },
  { id: LineJoinType.JOIN_EXTRAPOLATE2, label: N_('Extrapolated arc Alt2'), key: 'extrp_arc2' },
  { id: LineJoinType.JOIN_EXTRAPOLATE3, label: N_('Extrapolated arc Alt3'), key: 'extrp_arc3' },
]);

const INF_POINT = new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

function sp_get_fill_rule(obj: SPItem): string {
  return spReprCssProperty(spReprCssAttr(obj.getRepr(), 'style'), 'fill-rule', '');
}

function get_nearest_point(pathv: PathVector, point: Point): Point {
  const pathvectortime = pathv_nearest_time(pathv, point);
  return pathvectortime ? pathv_point_at(pathv, pathvectortime) : INF_POINT;
}

/**
 * The winding number of pathv around p (upstream PathVector::winding). The curves are sampled
 * as polylines, which is exact enough for the inside test of the offset knot.
 */
function winding(pathv: PathVector, p: Point): number {
  let wind = 0;
  const SAMPLES = 32;
  for (const path of pathv) {
    const pts: Point[] = [path.initialPoint()];
    const curves = [...path.curves()];
    if (!path.closed()) curves.push(path.closingSegment());
    for (const c of curves) for (let i = 1; i <= SAMPLES; i++) pts.push(c.pointAt(i / SAMPLES));
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as Point;
      const b = pts[i + 1] as Point;
      const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
      if (a.y <= p.y) {
        if (b.y > p.y && side > 0) wind++;
      } else if (b.y <= p.y && side < 0) {
        wind--;
      }
    }
  }
  return wind;
}

/**
 * Offset (upstream LPEOffset): offsets the path with do_offset() of helper/geom-pathstroke.cpp
 * (in WASM). A knot on the result sets the offset.
 */
export class LPEOffset extends GroupBBoxEffect {
  readonly unit: UnitParam;
  readonly offset: ScalarParam;
  readonly linejoin_type: EnumParam<LineJoinType>;
  readonly miter_limit: ScalarParam;
  readonly attempt_force_join: BoolParam;
  readonly update_on_knot_move: BoolParam;
  offset_pt = INF_POINT;
  prev_unit: string;
  liveknot = false;
  fillrule = FillRule.fill_nonZero;
  mix_pathv_all: PathVector = [];
  helper_path: PathVector = [];
  scale = 1;
  sign = true;
  _knotholder: KnotHolder | null = null;
  _knot_entity: KnotHolderEntityOffsetPoint | null = null;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.unit = new UnitParam(_('Unit'), _('Unit of measurement'), 'unit', this, 'mm');
    this.offset = new ScalarParam(_('Offset:'), _('Offset'), 'offset', this, 0.0);
    this.linejoin_type = new EnumParam(
      _('Join:'),
      _("Determines the shape of the path's corners"),
      'linejoin_type',
      JoinTypeConverter,
      this,
      LineJoinType.JOIN_MITER,
    );
    this.miter_limit = new ScalarParam(
      _('Miter limit:'),
      _('Maximum length of the miter join (in units of stroke width)'),
      'miter_limit',
      this,
      4.0,
    );
    this.attempt_force_join = new BoolParam(
      _('Force miter'),
      _('Overrides the miter limit and forces a join.'),
      'attempt_force_join',
      this,
      false,
    );
    this.update_on_knot_move = new BoolParam(
      _('Live update'),
      _('Update while moving handle'),
      'update_on_knot_move',
      this,
      true,
    );
    this.show_orig_path = true;
    this.registerParameter(this.linejoin_type);
    this.registerParameter(this.unit);
    this.registerParameter(this.offset);
    this.registerParameter(this.miter_limit);
    this.registerParameter(this.attempt_force_join);
    this.registerParameter(this.update_on_knot_move);
    this.offset.param_set_increments(0.1, 0.1);
    this.offset.param_set_digits(6);
    this._provides_knotholder_entities = true;
    this.apply_to_clippath_and_mask = true;
    this.prev_unit = this.unit.get_abbreviation();
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    if (this.lpeversion.param_getSVGValue() < '1.3') this.lpeversion.param_setValue('1.3', true);
    return false;
  }

  protected override doOnApply(_lpeitem: SPLPEItem): void {
    this.lpeversion.param_setValue('1.3', true);
  }

  protected override transform_multiply(postmul: Affine, _set: boolean): void {
    this.refresh_widgets = true;
    if (!postmul.isTranslation() && this.sp_lpe_item) {
      const current_affine = sp_item_transform_repr(this.sp_lpe_item);
      this.offset.param_transform_multiply(postmul.multiply(current_affine.inverse()), true);
    }
    this.offset_pt = this.offset_pt.transformed(postmul);
  }

  get_default_point(pathv: PathVector): Point {
    let origin = INF_POINT;
    const bbox = pathv.reduce<ReturnType<Path['boundsFast']>>((acc, p) => {
      const b = p.boundsFast();
      return acc ? acc.unionWith(b) : b;
    }, null);
    if (bbox) {
      origin = new Point(bbox.midpoint().x, bbox.top());
      origin = get_nearest_point(pathv, origin);
    }
    return origin;
  }

  sp_get_offset(): number {
    let ret_offset = 0;
    const pathvectortime = pathv_nearest_time(this.mix_pathv_all, this.offset_pt);
    if (pathvectortime) {
      const npath = this.mix_pathv_all[pathvectortime.path_index] as Path;
      const res = pathv_point_at(this.mix_pathv_all, pathvectortime);
      if (npath.closed()) {
        const winding_value = winding(this.mix_pathv_all, this.offset_pt);
        const inset = winding_value % 2 !== 0;
        ret_offset = distance(this.offset_pt, res);
        if (inset) ret_offset *= -1;
      } else {
        ret_offset = distance(this.offset_pt, res);
        if (!this.sign) ret_offset *= -1;
      }
    }
    return convertUnit(ret_offset, 'px', this.unit.get_abbreviation()) * this.scale;
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.push(this.helper_path);
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem);
    if (this.sp_lpe_item instanceof SPGroup) this.mix_pathv_all = [];
    this.scale = lpeitem.i2docAffine().descrim();
    if (!this.is_load && this.prev_unit !== this.unit.get_abbreviation()) {
      this.offset.param_set_undo(false);
      this.offset.param_set_value(
        convertUnit(this.offset.get_value(), this.prev_unit, this.unit.get_abbreviation()),
      );
    } else {
      this.offset.param_set_undo(true);
    }
    this.prev_unit = this.unit.get_abbreviation();
  }

  protected override doAfterEffect(_lpeitem: SPLPEItem, _curve: PathVector | null): void {
    if (this.offset_pt.equals(INF_POINT)) this._knot_entity?.knot_get();
    if (this.is_load) this.offset_pt = INF_POINT;
    if (this._knot_entity && this.sp_lpe_item instanceof SPShape && !this.liveknot) {
      const out = this.sp_lpe_item.curve() ?? [];
      this.offset_pt = get_nearest_point(out, this.offset_pt);
      this._knot_entity.knot_get();
    }
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const item = this.current_shape;
    const document = this.getSPDoc();
    if (!item || !document) return path_in;
    if (are_near(this.offset.get_value(), 0.0)) {
      this.mix_pathv_all.push(...path_in);
      if (this.is_load && this.offset_pt.equals(INF_POINT)) {
        this.offset_pt = this.get_default_point(path_in);
        this._knot_entity?.knot_get();
      }
    }
    const fr = sp_get_fill_rule(item);
    this.fillrule = fr === 'evenodd' ? FillRule.fill_oddEven : FillRule.fill_nonZero;
    const tolerance = this.liveknot ? 3 : -1;
    const to_offset = convertUnit(this.offset.get_value(), this.unit.get_abbreviation(), 'px') / this.scale;
    const is_group = this.sp_lpe_item instanceof SPGroup;
    if (!is_group) {
      this.mix_pathv_all = [];
      this.helper_path = [];
    }
    const join = this.linejoin_type.get_value();
    const miterlimit = this.attempt_force_join.get_value() ? Number.MAX_VALUE : this.miter_limit.get_value();
    const point = is_group ? INF_POINT : this.offset_pt;
    const res = pathBoolopBackend().offsetPath(
      sp_svg_write_path(path_in),
      to_offset,
      tolerance,
      miterlimit,
      this.fillrule,
      join,
      [point.x, point.y],
    );
    this.helper_path.push(...sp_svg_read_pathv(res.helper));
    this.mix_pathv_all.push(...sp_svg_read_pathv(res.mix));
    return sp_svg_read_pathv(res.d);
  }

  protected override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    this._knotholder = knotholder;
    const knot_entity = new KnotHolderEntityOffsetPoint(this);
    this._knot_entity = knot_entity;
    knot_entity.create(null, item, knotholder, 'CANVAS_ITEM_CTRL_TYPE_LPE', 'LPEOffset', _('Offset point'));
    this.offset_pt = INF_POINT;
    knotholder.add(knot_entity);
  }
}

class KnotHolderEntityOffsetPoint extends LPEKnotHolderEntity<LPEOffset> {
  override destroy(): void {
    super.destroy();
    this._effect._knotholder = null;
    this._effect._knot_entity = null;
  }

  knot_set(p: Point, _origin: Point, state: KnotState): void {
    this._effect.offset_pt = this.snap_knot_position(p, state);
    const offset = this._effect.sp_get_offset();
    if (this._effect.update_on_knot_move.get_value()) {
      this._effect.liveknot = true;
      this._effect.offset.param_set_value(offset);
      if (this.item && 'path_effect_list' in this.item) {
        sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, false);
      }
    } else {
      this._effect.liveknot = false;
    }
  }

  override knot_ungrabbed(_p: Point, _origin: Point, _state: KnotState): void {
    this._effect.liveknot = false;
    this._effect.offset.param_set_value(this._effect.sp_get_offset());
    this._effect.makeUndoDone(C_('Undo', 'Move handle'));
  }

  knot_get(): Point {
    if (!this._effect.update_on_knot_move.get_value()) return this._effect.offset_pt;
    if (this._effect.offset_pt.equals(INF_POINT)) {
      this._effect.offset_pt = this._effect.get_default_point(this._effect.pathvector_after_effect);
    }
    return this._effect.offset_pt;
  }
}
