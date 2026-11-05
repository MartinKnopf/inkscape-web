// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-transform_2pts.cpp, src/live_effects/lpe-transform_2pts.h
/** \file
 * LPE <transform_2pts> implementation
 */
/*
 * Authors:
 *   Jabier Arraiza Cenoz<jabier.arraiza@marker.es>
 *
 * Copyright (C) Authors 2014
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  Affine,
  are_near,
  atan2,
  distance,
  LineSegment,
  Path,
  type PathVector,
  Point,
  Rotate,
  rad_from_deg,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import { count_pathvector_nodes } from '../helper/geom.ts';
import { _, C_ } from '../i18n.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { SPPath } from '../object/sp-path.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { type Parameter, type ParamWidget, ScalarParam } from './parameter/parameter.ts';
import { PointParam } from './parameter/point.ts';
import { pwd2Transformed } from './pwd2.ts';

/** The angle of the ray from a to b (upstream Geom::Ray(a, b).angle()). */
const rayAngle = (a: Point, b: Point): number => atan2(b.sub(a));

/**
 * Transform by 2 points (upstream LPETransform2Pts): scale, stretch and rotate the item by two
 * handles, the start and the end point, that stand for two nodes of the path (or for the sides of
 * its bounding box).
 */
export class LPETransform2Pts extends GroupBBoxEffect {
  readonly elastic: BoolParam;
  readonly from_original_width: BoolParam;
  readonly lock_length: BoolParam;
  readonly lock_angle: BoolParam;
  readonly flip_horizontal: BoolParam;
  readonly flip_vertical: BoolParam;
  readonly start: PointParam;
  readonly end: PointParam;
  readonly stretch: ScalarParam;
  readonly offset: ScalarParam;
  readonly first_knot: ScalarParam;
  readonly last_knot: ScalarParam;
  readonly helper_size: ScalarParam;
  from_original_width_toggler = false;
  point_a = new Point(0, 0);
  point_b = new Point(0, 0);
  pathvector: PathVector = [];
  append_path = false;
  previous_angle = rad_from_deg(0);
  previous_start = new Point(0, 0);
  previous_length = -1;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.elastic = new BoolParam(_('Elastic'), _('Elastic transform mode'), 'elastic', this, false);
    this.from_original_width = new BoolParam(
      _('From original width'),
      _('From original width'),
      'from_original_width',
      this,
      false,
    );
    this.lock_length = new BoolParam(
      _('Lock length'),
      _('Lock length to current distance'),
      'lock_length',
      this,
      false,
    );
    this.lock_angle = new BoolParam(_('Lock angle'), _('Lock angle'), 'lock_angle', this, false);
    this.flip_horizontal = new BoolParam(
      _('Flip horizontal'),
      _('Flip horizontal'),
      'flip_horizontal',
      this,
      false,
    );
    this.flip_vertical = new BoolParam(_('Flip vertical'), _('Flip vertical'), 'flip_vertical', this, false);
    this.start = new PointParam(_('Start'), _('Start point'), 'start', this, 'Start point');
    this.end = new PointParam(_('End'), _('End point'), 'end', this, 'End point');
    this.stretch = new ScalarParam(_('Stretch'), _('Stretch the result'), 'stretch', this, 1);
    this.offset = new ScalarParam(_('Offset'), _('Offset from knots'), 'offset', this, 0);
    this.first_knot = new ScalarParam(_('First Knot'), _('First Knot'), 'first_knot', this, 1);
    this.last_knot = new ScalarParam(_('Last Knot'), _('Last Knot'), 'last_knot', this, 1);
    this.helper_size = new ScalarParam(_('Helper size:'), _('Rotation helper size'), 'helper_size', this, 3);

    this.registerParameter(this.first_knot);
    this.registerParameter(this.last_knot);
    this.registerParameter(this.helper_size);
    this.registerParameter(this.stretch);
    this.registerParameter(this.offset);
    this.registerParameter(this.start);
    this.registerParameter(this.end);
    this.registerParameter(this.elastic);
    this.registerParameter(this.from_original_width);
    this.registerParameter(this.flip_vertical);
    this.registerParameter(this.flip_horizontal);
    this.registerParameter(this.lock_length);
    this.registerParameter(this.lock_angle);

    this.first_knot.param_make_integer();
    this.last_knot.param_make_integer();
    this.helper_size.param_set_range(0, 999);
    this.helper_size.param_set_increments(1, 1);
    this.helper_size.param_set_digits(0);
    this.offset.param_set_range(-Number.MAX_VALUE, Number.MAX_VALUE);
    this.offset.param_set_increments(1, 1);
    this.offset.param_set_digits(2);
    this.stretch.param_set_range(0, 999.0);
    this.stretch.param_set_increments(0.01, 0.01);
    this.stretch.param_set_digits(4);
    this.apply_to_clippath_and_mask = true;
  }

  protected override doOnApply(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem, false, true);
    this.point_a = new Point(this.boundingbox_X.min(), this.boundingbox_Y.middle());
    this.point_b = new Point(this.boundingbox_X.max(), this.boundingbox_Y.middle());
    if (lpeitem instanceof SPPath) this.pathvector = lpeitem.curveForEdit() ?? [];
    const first = this.pathvector[0];
    const last = this.pathvector.at(-1);
    if (first && last) {
      this.point_a = first.initialPoint();
      this.point_b = last.finalPoint();
      if (are_near(this.point_a, this.point_b)) {
        this.point_b = (last.curves().at(-1) ?? last.closingSegment()).initialPoint();
      }
      const nnodes = this.nodeCount(this.pathvector);
      // this is need to fix undo on apply
      this.first_knot.param_set_value(1);
      this.last_knot.param_set_value(nnodes);
      this.first_knot.write_to_SVG();
      this.last_knot.write_to_SVG();
    }

    this.previous_length = distance(this.point_a, this.point_b);
    this.previous_angle = rayAngle(this.point_a, this.point_b);
    this.start.param_update_default(this.point_a);
    this.start.param_set_default();
    this.end.param_update_default(this.point_b);
    this.end.param_set_default();
  }

  protected override transform_multiply(postmul: Affine, _set: boolean): void {
    if (this.sp_lpe_item?.pathEffectsEnabled() && this.sp_lpe_item.optimizeTransforms()) {
      this.start.param_transform_multiply(postmul, false);
      this.end.param_transform_multiply(postmul, false);
    }
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem, false, true);
    this.point_a = new Point(this.boundingbox_X.min(), this.boundingbox_Y.middle());
    this.point_b = new Point(this.boundingbox_X.max(), this.boundingbox_Y.middle());

    if (lpeitem instanceof SPPath) this.pathvector = lpeitem.curveForEdit() ?? [];
    if (this.from_original_width_toggler !== this.from_original_width.get_value()) {
      this.from_original_width_toggler = this.from_original_width.get_value();
      this.reset();
    }
    if (this.pathvector.length > 0 && !this.from_original_width.get_value()) {
      this.append_path = false;
      this.point_a = this.pointAtNodeIndex(this.pathvector, Math.trunc(this.first_knot.get_value()) - 1);
      this.point_b = this.pointAtNodeIndex(this.pathvector, Math.trunc(this.last_knot.get_value()) - 1);
      const nnodes = this.nodeCount(this.pathvector);
      this.first_knot.param_set_range(1, this.last_knot.get_value() - 1);
      this.last_knot.param_set_range(this.first_knot.get_value() + 1, nnodes);
    } else {
      if (this.first_knot.get_value() !== 1) this.first_knot.param_set_value(1);
      if (this.last_knot.get_value() !== 2) this.last_knot.param_set_value(2);
      this.first_knot.param_set_range(1, 1);
      this.last_knot.param_set_range(2, 2);
      this.append_path = false;
      if (!this.from_original_width.get_value()) this.from_original_width.param_setValue(true);
    }
    const start = this.start.value;
    const end = this.end.value;
    if (this.lock_length.get_value() && !this.lock_angle.get_value() && this.previous_length !== -1) {
      if (this.previous_start.equals(start) || this.previous_angle === rad_from_deg(0)) {
        this.previous_angle = rayAngle(start, end);
      }
    } else if (
      this.lock_angle.get_value() &&
      !this.lock_length.get_value() &&
      this.previous_angle !== rad_from_deg(0)
    ) {
      if (this.previous_start.equals(start)) this.previous_length = distance(start, end);
    }
    if (this.lock_length.get_value() || this.lock_angle.get_value()) {
      const end_point = Point.polar(this.previous_angle, this.previous_length).add(start);
      this.end.param_setValue(end_point);
    }
    this.previous_angle = rayAngle(start, this.end.value);
    this.previous_length = distance(start, this.end.value);
    this.previous_start = start;
  }

  /** Set the knots to the nodes they stand for, and the start and end point to the points of the nodes. */
  updateIndex(): void {
    if (this.sp_lpe_item instanceof SPPath) this.pathvector = this.sp_lpe_item.curveForEdit() ?? [];
    if (this.pathvector.length === 0) return;
    if (!this.from_original_width.get_value()) {
      this.point_a = this.pointAtNodeIndex(this.pathvector, Math.trunc(this.first_knot.get_value()) - 1);
      this.point_b = this.pointAtNodeIndex(this.pathvector, Math.trunc(this.last_knot.get_value()) - 1);
      this.start.param_update_default(this.point_a);
      this.start.param_set_default();
      this.end.param_update_default(this.point_b);
      this.end.param_set_default();
      // seems silly but fix undo resetting value on it
      this.first_knot.param_set_value(this.first_knot.get_value());
      this.last_knot.param_set_value(this.last_knot.get_value());
    }
    this.refresh_widgets = true;
  }

  nodeCount(pathvector: PathVector): number {
    return count_pathvector_nodes(pathvector);
  }

  /** The initial point of the curve with the index (all curves of the paths, with the closing segments). */
  pointAtNodeIndex(pathvector: PathVector, index: number): Point {
    let n = 0;
    for (const pv_it of pathvector) {
      for (const curve of [...pv_it.openCurves(), pv_it.closingSegment()]) {
        if (index === n) return curve.initialPoint();
        n++;
      }
    }
    return new Point();
  }

  /** The path that has the curve with the index (not used upstream). */
  pathAtNodeIndex(pathvector: PathVector, index: number): Path | null {
    let n = 0;
    for (const pv_it of pathvector) {
      for (let i = 0; i <= pv_it.sizeOpen(); i++) {
        if (index === n) return pv_it;
        n++;
      }
    }
    return null;
  }

  reset(): void {
    this.point_a = new Point(this.boundingbox_X.min(), this.boundingbox_Y.middle());
    this.point_b = new Point(this.boundingbox_X.max(), this.boundingbox_Y.middle());
    if (this.pathvector.length > 0 && !this.from_original_width.get_value()) {
      const nnodes = this.nodeCount(this.pathvector);
      this.first_knot.param_set_range(1, this.last_knot.get_value() - 1);
      this.last_knot.param_set_range(this.first_knot.get_value() + 1, nnodes);
      this.first_knot.param_set_value(1);
      this.last_knot.param_set_value(nnodes);
      this.point_a = (this.pathvector[0] as Path).initialPoint();
      this.point_b = (this.pathvector.at(-1) as Path).finalPoint();
    } else {
      this.first_knot.param_set_value(1);
      this.last_knot.param_set_value(2);
    }
    this.refresh_widgets = true;
    this.offset.param_set_value(0.0);
    this.stretch.param_set_value(1.0);
    this.previous_angle = rayAngle(this.point_a, this.point_b);
    this.previous_length = distance(this.point_a, this.point_b);
    this.start.param_update_default(this.point_a);
    this.end.param_update_default(this.point_b);
    this.start.param_set_default();
    this.end.param_set_default();
  }

  /** The widgets of the parameters and the Reset button. */
  override newWidget(): { param: Parameter | null; widget: ParamWidget }[] {
    const widgets = super.newWidget();
    widgets.push({
      param: null,
      widget: {
        kind: 'buttons',
        buttons: [
          {
            label: _('Reset'),
            onClick: () => {
              if (!this.sp_lpe_item) return;
              this.reset();
              sp_lpe_item_update_patheffect(this.sp_lpe_item, false, false, true);
              this.makeUndoDone(C_('Undo', 'Reset transform by 2 points'));
            },
          },
        ],
      },
    });
    return widgets;
  }

  /** The knots of the nodes were changed in the dialog (upstream: the value_changed signal of their widgets). */
  override onParamWidgetChanged(param: Parameter): void {
    if (param === this.first_knot || param === this.last_knot) this.updateIndex();
  }

  /** Upstream doEffect_pwd2 on each subpath: pwd2_in * m. */
  protected override doEffect_path(path_in: PathVector): PathVector {
    const start = this.start.value;
    const end = this.end.value;
    const sca = distance(start, end) / distance(this.point_a, this.point_b);
    const original_angle = rayAngle(this.point_a, this.point_b);
    const transformed_angle = rayAngle(start, end);
    const rot = transformed_angle - original_angle;
    let m = Affine.identity();
    const aroundOriginal = (scale: Affine) => {
      m = m.multiply(Rotate(-original_angle)).multiply(scale).multiply(Rotate(original_angle));
    };
    if (this.flip_horizontal.get_value() && this.flip_vertical.get_value()) {
      aroundOriginal(Scale(-1, -1));
    } else if (this.flip_vertical.get_value()) {
      aroundOriginal(Scale(1, -1));
    } else if (this.flip_horizontal.get_value()) {
      aroundOriginal(Scale(-1, 1));
    }
    if (this.stretch.get_value() !== 1) aroundOriginal(Scale(1, this.stretch.get_value()));
    if (this.elastic.get_value()) {
      m = m.multiply(Rotate(-original_angle));
      if (sca > 1) {
        m = m.multiply(Scale(sca, 1.0));
      } else {
        m = m.multiply(Scale(sca, 1.0 - (1.0 - sca) / 2.0));
      }
      m = m.multiply(Rotate(transformed_angle));
    } else {
      m = m.multiply(Scale(sca));
      m = m.multiply(Rotate(rot));
    }
    // helper is the line from point_a to point_b, transformed with m: only its initial point is used
    const helper_start = this.point_a.transformed(m);
    let trans = start.sub(helper_start);
    if (this.flip_horizontal.get_value()) trans = end.sub(helper_start);
    if (this.offset.get_value() !== 0) {
      trans = Point.polar(transformed_angle + rad_from_deg(-90), this.offset.get_value()).add(trans);
    }
    m = m.multiply(Translate(trans));

    return pwd2Transformed(path_in, [m.c0, m.c1, m.c2, m.c3, m.c4, m.c5]);
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.length = 0;
    const start = this.start.value;
    const end = this.end.value;
    const hp = new Path(start);
    hp.appendCurve(new LineSegment(start, end));
    const pathv: PathVector = [hp];
    const r = this.helper_size.get_value() * 0.1;
    const scale = new Affine(r, 0, 0, r, 0, 0);
    if (this.lock_length.get_value() || this.lock_angle.get_value()) {
      const svgd =
        'M -5.39,8.78 -9.13,5.29 -10.38,10.28 Z M -7.22,7.07 -3.43,3.37 m -1.95,-12.16 -3.74,3.5 -1.26,-5 z m -1.83,1.71 3.78,3.7 M 5.24,8.78 8.98,5.29 10.24,10.28 Z M 7.07,7.07 3.29,3.37 M 5.24,-8.78 l 3.74,3.5 1.26,-5 z M 7.07,-7.07 3.29,-3.37';
      const m = scale.multiply(Translate(start));
      hp_vec.push(sp_svg_read_pathv(svgd).map((p) => p.transformed(m)));
    }
    if (!this.lock_angle.get_value() && this.lock_length.get_value()) {
      const svgd =
        'M 0,9.94 C -2.56,9.91 -5.17,8.98 -7.07,7.07 c -3.91,-3.9 -3.91,-10.24 0,-14.14 1.97,-1.97 4.51,-3.02 7.07,-3.04 2.56,0.02 5.1,1.07 7.07,3.04 3.91,3.9 3.91,10.24 0,14.14 C 5.17,8.98 2.56,9.91 0,9.94 Z';
      const m = Rotate(this.previous_angle).multiply(scale).multiply(Translate(end));
      hp_vec.push(sp_svg_read_pathv(svgd).map((p) => p.transformed(m)));
    }
    hp_vec.push(pathv);
  }
}
