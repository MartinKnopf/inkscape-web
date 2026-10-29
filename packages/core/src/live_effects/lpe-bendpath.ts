// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-bendpath.cpp, src/live_effects/lpe-bendpath.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 * Copyright (C) Steren Giannini 2008 <steren.giannini@gmail.com>
 */
import {
  type Affine,
  are_near,
  CubicBezier,
  distance,
  dot,
  LineSegment,
  Path,
  type PathVector,
  Point,
  rad_from_deg,
  write_svg_path,
} from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { Preferences } from '../preferences.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { type KnotHolder, type KnotState, LPEKnotHolderEntity } from '../ui/knot/knot-holder-entity.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { PathParam } from './parameter/path.ts';

/*
 * Theory in e-mail from J.F. Barraud
 * Let B be the skeleton path, and P the pattern (the path to be deformed).
 * P is a map t --> P(t) = ( x(t), y(t) ).
 * B is a map t --> B(t) = ( a(t), b(t) ).
 * The first step is to re-parametrize B by its arc length: this is the parametrization in which a point p on B is located by its distance s from start.
 * One obtains a new map s --> U(s) = (a'(s),b'(s)), that still describes the same path B, but where the distance along B from start to
 * U(s) is s itself.
 * We also need a unit normal to the path. This can be obtained by computing a unit tangent vector, and rotate it by 90°. Call this normal vector N(s).
 * The basic deformation associated to B is then given by:
 *   (x,y) --> U(x)+y*N(x)
 * (i.e. we go for distance x along the path, and then for distance y along the normal)
 */

/** The start of the bend path and the direction of its normal there (shared by knot_get and knot_set). */
function startRay(bend: PathVector): { ptA: Point; angle: number } | null {
  const path_in = bend[0];
  if (!path_in || path_in.empty()) return null;
  const ptA = path_in.pointAt(0);
  const B = path_in.pointAt(1);
  const first_curve = path_in.at(0);
  const dir = first_curve instanceof CubicBezier ? first_curve.controlPoint(1).sub(ptA) : B.sub(ptA);
  return { ptA, angle: Math.atan2(dir.y, dir.x) + rad_from_deg(90) };
}

/**
 * Bend (upstream LPEBendPath): bends the item along the bend path, a path parameter that is
 * edited on canvas. The 2geom part (arc length parametrization of the bend path) runs in WASM.
 */
export class LPEBendPath extends GroupBBoxEffect {
  readonly bend_path: PathParam;
  readonly prop_scale: ScalarParam;
  readonly scale_y_rel: BoolParam;
  readonly vertical_pattern: BoolParam;
  readonly hide_knot: BoolParam;
  original_height = 0.0;
  helper_path: PathVector = [];
  _knot_entity: KnotHolderEntityWidthBendPath | null = null;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.bend_path = new PathParam(
      _('Bend path:'),
      _('Path along which to bend the original path'),
      'bendpath',
      this,
      'M0,0 L1,0',
    );
    this.prop_scale = new ScalarParam(_('_Width:'), _('Width of the path'), 'prop_scale', this, 1.0);
    this.scale_y_rel = new BoolParam(
      _('W_idth in units of length'),
      _('Scale the width of the path in units of its length'),
      'scale_y_rel',
      this,
      false,
    );
    this.vertical_pattern = new BoolParam(
      _('_Original path is vertical'),
      _('Rotates the original 90 degrees, before bending it along the bend path'),
      'vertical',
      this,
      false,
    );
    this.hide_knot = new BoolParam(_('Hide width knot'), _('Hide width knot'), 'hide_knot', this, false);
    this.registerParameter(this.bend_path);
    this.registerParameter(this.prop_scale);
    this.registerParameter(this.scale_y_rel);
    this.registerParameter(this.vertical_pattern);
    this.registerParameter(this.hide_knot);
    this.prop_scale.param_set_digits(3);
    this.prop_scale.param_set_increments(0.01, 0.1);
    this._provides_knotholder_entities = true;
    this.apply_to_clippath_and_mask = true;
    this.concatenate_before_pwd2 = true;
  }

  protected override doOnApply(_lpeitem: SPLPEItem): void {
    this.lpeversion.param_setValue('1.5', true);
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    this.bend_path.reload();
    return false;
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    // get the item bounding box
    this.original_bbox(lpeitem, false, true);
    this.original_height = this.boundingbox_Y.max() - this.boundingbox_Y.min();
    if (this.is_load) this.bend_path.reload();
    const knot = this._knot_entity?.knot;
    if (knot && this._knot_entity) {
      if (this.hide_knot.get_value()) {
        this.helper_path = [];
        knot.hide();
      } else {
        knot.show();
      }
      this._knot_entity.update_knot();
    }
  }

  protected override transform_multiply(postmul: Affine, _set: boolean): void {
    // TODO: linked bend paths (the item moves with the selected linked path).
    if (this.sp_lpe_item?.pathEffectsEnabled() && this.sp_lpe_item.optimizeTransforms()) {
      this.bend_path.param_transform_multiply(postmul, false);
    }
  }

  /** Upstream doEffect_pwd2 called with the concatenated paths (concatenate_before_pwd2). */
  protected override doEffect_path(path_in: PathVector): PathVector {
    const affine = this.bend_path.get_relative_affine();
    const bend = this.bend_path.get_pathvector().map((p) => p.transformed(affine));
    if (bend.length === 0) return path_in;
    const d = pathBoolopBackend().bendPath(
      write_svg_path(path_in),
      write_svg_path(bend),
      [
        this.boundingbox_X.min(),
        this.boundingbox_X.max(),
        this.boundingbox_Y.min(),
        this.boundingbox_Y.max(),
      ],
      this.prop_scale.get_value(),
      this.scale_y_rel.get_value(),
      this.vertical_pattern.get_value(),
      this.lpeversion.param_getSVGValue() >= '1.5',
    );
    this.bend_path.changed = false;
    return sp_svg_read_pathv(d);
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    this.original_bbox(item as SPLPEItem, false, true);
    const start = new Point(
      this.boundingbox_X.min(),
      (this.boundingbox_Y.max() + this.boundingbox_Y.min()) / 2,
    );
    let end = new Point(this.boundingbox_X.max(), (this.boundingbox_Y.max() + this.boundingbox_Y.min()) / 2);
    if (are_near(start, end)) end = end.add(new Point(1, 0));
    const path = new Path(start);
    path.appendCurve(new LineSegment(start, end));
    this.bend_path.set_new_value([path], true);
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.push(this.helper_path);
  }

  protected override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    const knot_entity = new KnotHolderEntityWidthBendPath(this);
    this._knot_entity = knot_entity;
    knot_entity.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:WidthBend',
      _('Change the width'),
    );
    knotholder.add(knot_entity);
    if (this.hide_knot.get_value()) {
      knot_entity.knot?.hide();
      knot_entity.update_knot();
    }
  }
}

class KnotHolderEntityWidthBendPath extends LPEKnotHolderEntity<LPEBendPath> {
  override destroy(): void {
    super.destroy();
    this._effect._knot_entity = null;
  }

  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(p, state);
    const ray = startRay(this._effect.bend_path.get_pathvector());
    if (!ray || !this.item || !this.knot) return;
    const { ptA, angle } = ray;
    const knot_pos = this.knot.pos.transformed(this.item.i2dtAffine().inverse());
    // Geom::Ray::nearestTime is 0 when the point is behind the start of the ray
    const nearest_to_ray = Math.max(0, dot(knot_pos.sub(ptA), Point.polar(angle)));
    const half = this._effect.original_height / 2.0;
    if (nearest_to_ray === 0) this._effect.prop_scale.param_set_value(-distance(s, ptA) / half);
    else this._effect.prop_scale.param_set_value(distance(s, ptA) / half);
    if (!this._effect.original_height) this._effect.prop_scale.param_set_value(0);
    Preferences.get().setDouble('/live_effects/bend_path/width', this._effect.prop_scale.get_value());
    if ('path_effect_list' in this.item) sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, true);
  }

  knot_get(): Point {
    const ray = startRay(this._effect.bend_path.get_pathvector());
    if (!ray) return new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const { ptA, angle } = ray;
    const result_point = Point.polar(
      angle,
      (this._effect.original_height / 2.0) * this._effect.prop_scale.get_value(),
    ).add(ptA);
    this._effect.helper_path = [];
    if (!this._effect.hide_knot.get_value()) {
      const hp = new Path(result_point);
      hp.appendCurve(new LineSegment(result_point, ptA));
      this._effect.helper_path.push(hp);
    }
    return result_point;
  }
}
