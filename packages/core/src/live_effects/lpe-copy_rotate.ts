// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-copy_rotate.cpp, src/live_effects/lpe-copy_rotate.h
/** \file
 * LPE <copy_rotate> implementation
 */
/*
 * Authors:
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *   Johan Engelen <j.b.c.engelen@alumnus.utwente.nl>
 *   Jabiertxo Arraiza Cenoz <jabier.arraiza@marker.es>
 * Copyright (C) Authors 2007-2012
 */
import {
  type Affine,
  angle_between,
  are_near,
  deg_from_rad,
  distance,
  L2,
  LineSegment,
  middle_point,
  Path,
  type PathVector,
  Point,
  Rotate,
  rad_from_deg,
  Scale,
  Translate,
  unit_vector,
} from '@inkscape-web/geom';
import { pathv_to_linear_and_cubic_beziers } from '../helper/geom.ts';
import { _, N_ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { BooleanOp, FillRule, sp_pathvector_boolop } from '../path/path-boolop.ts';
import { SPWindRule } from '../style-enums.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { PointParam } from './parameter/point.ts';

export enum RotateMethod {
  RM_NORMAL,
  RM_KALEIDOSCOPE,
  RM_FUSE,
  RM_END,
}

const RotateMethodData = [
  { id: RotateMethod.RM_NORMAL, label: N_('Normal'), key: 'normal' },
  { id: RotateMethod.RM_KALEIDOSCOPE, label: N_('Kaleidoscope'), key: 'kaleidoskope' },
  { id: RotateMethod.RM_FUSE, label: N_('Fuse paths'), key: 'fuse_paths' },
];
const RMConverter = new EnumDataConverter<RotateMethod>(RotateMethodData, RotateMethod.RM_END);

const paths_transformed = (pv: PathVector, m: Affine): PathVector => pv.map((p) => p.transformed(m));

/**
 * Rotate copies (upstream LPECopyRotate): copies of the path rotated around an origin, as in a
 * kaleidoscope (the kaleidoscope and fuse methods cut and join the copies with boolean operations).
 * TODO: split elements (each copy as a separate satellite object, lpesatellites).
 */
export class LPECopyRotate extends GroupBBoxEffect {
  readonly method: EnumParam<RotateMethod>;
  readonly origin: PointParam;
  readonly starting_point: PointParam;
  readonly starting_angle: ScalarParam;
  readonly rotation_angle: ScalarParam;
  readonly num_copies: ScalarParam;
  readonly gap: ScalarParam;
  readonly copies_to_360: BoolParam;
  readonly mirror_copies: BoolParam;
  readonly split_items: BoolParam;
  readonly link_styles: BoolParam;
  A = new Point(0, 0);
  B = new Point(0, 0);
  dir = new Point(1, 0);
  half_dir = new Point(1, 0);
  start_pos = new Point(0, 0);
  previous_origin = new Point(0, 0);
  previous_start_point = new Point(0, 0);
  dist_angle_handle = 100.0;
  size_divider = 0;
  divider = new Path();

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.method = new EnumParam(
      _('Method:'),
      _('Rotate methods'),
      'method',
      RMConverter,
      this,
      RotateMethod.RM_NORMAL,
    );
    this.origin = new PointParam(
      _('Origin'),
      _('Adjust origin of the rotation'),
      'origin',
      this,
      _('Adjust origin of the rotation'),
    );
    this.starting_point = new PointParam(
      _('Start point'),
      _('Starting point to define start angle'),
      'starting_point',
      this,
      _('Adjust starting point to define start angle'),
    );
    this.starting_angle = new ScalarParam(
      _('Starting angle'),
      _('Angle of the first copy'),
      'starting_angle',
      this,
      0.0,
    );
    this.rotation_angle = new ScalarParam(
      _('Rotation angle'),
      _('Angle between two successive copies'),
      'rotation_angle',
      this,
      60.0,
    );
    this.num_copies = new ScalarParam(
      _('Number of copies'),
      _('Number of copies of the original path'),
      'num_copies',
      this,
      6,
    );
    this.gap = new ScalarParam(
      _('Gap'),
      _('Gap space between copies, use small negative gaps to fix some joins'),
      'gap',
      this,
      -0.01,
    );
    this.copies_to_360 = new BoolParam(
      _('Distribute evenly'),
      _('Angle between copies is 360°/number of copies (ignores rotation angle setting)'),
      'copies_to_360',
      this,
      true,
    );
    this.mirror_copies = new BoolParam(
      _('Mirror copies'),
      _('Mirror between copies'),
      'mirror_copies',
      this,
      false,
    );
    this.split_items = new BoolParam(
      _('Split elements'),
      _('Split elements, so each can have its own style'),
      'split_items',
      this,
      false,
    );
    this.link_styles = new BoolParam(
      _('Link styles'),
      _('Link styles on split mode'),
      'link_styles',
      this,
      false,
    );
    this.show_orig_path = true;
    this._provides_knotholder_entities = true;
    //0.92 compatibility
    const repr = this.getRepr();
    if (repr?.attribute('fuse_paths') === 'true') {
      repr.removeAttribute('fuse_paths');
      repr.setAttribute('method', 'kaleidoskope');
      repr.setAttribute('mirror_copies', 'true');
    }
    // register all your parameters here, so Inkscape knows which parameters this effect has:
    this.registerParameter(this.method);
    this.registerParameter(this.num_copies);
    this.registerParameter(this.starting_angle);
    this.registerParameter(this.starting_point);
    this.registerParameter(this.rotation_angle);
    this.registerParameter(this.gap);
    this.registerParameter(this.origin);
    this.registerParameter(this.copies_to_360);
    this.registerParameter(this.mirror_copies);
    this.registerParameter(this.split_items);
    this.registerParameter(this.link_styles);
    this.gap.param_set_range(-Number.MAX_VALUE, Number.MAX_VALUE);
    this.gap.param_set_increments(0.01, 0.01);
    this.gap.param_set_digits(5);
    this.rotation_angle.param_set_digits(4);
    this.num_copies.param_set_range(1, 2147483647);
    this.num_copies.param_make_integer();
    this.apply_to_clippath_and_mask = true;
    this.starting_point.param_widget_is_visible(false);
    // TODO: split mode is not ported (satellites), so its widgets are hidden.
    this.split_items.param_widget_is_visible(false);
    this.link_styles.param_widget_is_visible(false);
  }

  protected override doOnApply(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem, false, true);
    this.A = new Point(this.boundingbox_X.min(), this.boundingbox_Y.middle());
    this.B = new Point(this.boundingbox_X.middle(), this.boundingbox_Y.middle());
    this.origin.param_setValue(this.A, true);
    this.origin.param_update_default(this.A);
    this.dist_angle_handle = L2(this.B.sub(this.A));
    this.dir = unit_vector(this.B.sub(this.A));
    this.lpeversion.param_setValue('1.2', true);
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem, false, true);
    const method = this.method.get_value();
    const num_copies = () => this.num_copies.get_value();
    const rotation_angle = () => this.rotation_angle.get_value();
    if (this.copies_to_360.get_value() && num_copies() > 2) {
      this.rotation_angle.param_set_value(360.0 / num_copies());
    }
    if (
      method !== RotateMethod.RM_NORMAL &&
      rotation_angle() * num_copies() > 360 &&
      rotation_angle() > 0 &&
      this.copies_to_360.get_value()
    ) {
      this.num_copies.param_set_value(Math.floor(360 / rotation_angle()));
    }
    if (
      method !== RotateMethod.RM_NORMAL &&
      this.mirror_copies.get_value() &&
      this.copies_to_360.get_value()
    ) {
      this.num_copies.param_set_increments(2.0, 10.0);
      if (Math.trunc(num_copies()) % 2 !== 0) {
        this.num_copies.param_set_value(num_copies() + 1);
        this.rotation_angle.param_set_value(360.0 / num_copies());
      }
    } else {
      this.num_copies.param_set_increments(1.0, 10.0);
    }
    this.A = new Point(this.boundingbox_X.min(), this.boundingbox_Y.middle());
    this.B = new Point(this.boundingbox_X.middle(), this.boundingbox_Y.middle());
    if (are_near(this.A, this.B, 0.01)) this.B = this.B.add(new Point(1.0, 0.0));
    this.dir = unit_vector(this.B.sub(this.A));
    // I first suspected the minus sign to be a bug in 2geom but it is
    // likely due to SVG's choice of coordinate system orientation (max)
    const origin = this.origin.value;
    const starting_point = this.starting_point.value;
    const near_start_point = are_near(this.previous_start_point, starting_point, 0.01);
    const near_origin = are_near(this.previous_origin, origin, 0.01);
    if (!near_start_point && !this.is_load) {
      if (lpeitem.document.undoStack.sensitive) {
        this.starting_angle.param_set_value(
          deg_from_rad(-angle_between(this.dir, starting_point.sub(origin))),
        );
      }
      // FIXME: This will always be true! Did we mean to check if some state contains Shift flag?
      // (upstream tests the constant GDK_SHIFT_MASK)
      this.dist_angle_handle = L2(this.B.sub(this.A));
    }
    if (this.dist_angle_handle < 1.0) this.dist_angle_handle = 1.0;
    let dist = this.dist_angle_handle;
    if (!this.previous_start_point.equals(new Point(0, 0)) || !this.previous_origin.equals(new Point(0, 0))) {
      dist = distance(this.previous_origin, starting_point);
    }
    this.start_pos = origin.add(
      this.dir.transformed(Rotate(-rad_from_deg(this.starting_angle.get_value()))).mul(dist),
    );
    if (!near_start_point || !near_origin || this.split_items.get_value()) {
      this.starting_point.param_setValue(this.start_pos);
    }
    this.previous_origin = this.origin.value;
    this.previous_start_point = this.starting_point.value;
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    let path_out: PathVector;
    const X = this.boundingbox_X;
    const Y = this.boundingbox_Y;
    const origin = this.origin.value;
    const starting_angle = this.starting_angle.get_value();
    const rotation_angle = this.rotation_angle.get_value();
    const method = this.method.get_value();
    const split_items = this.split_items.get_value();
    const diagonal = distance(new Point(X.min(), Y.min()), new Point(X.max(), Y.max()));
    const bbox = this.sp_lpe_item?.geometricBounds() ?? null;
    this.size_divider = (bbox ? Math.sqrt(bbox.distanceSq(origin)) : 0) + diagonal * 6;
    const line_start = origin.add(
      this.dir.transformed(Rotate(-rad_from_deg(starting_angle))).mul(this.size_divider),
    );
    const line_end = origin.add(
      this.dir.transformed(Rotate(-rad_from_deg(rotation_angle + starting_angle))).mul(this.size_divider),
    );
    this.divider = new Path(line_start);
    this.divider.appendCurve(new LineSegment(line_start, origin));
    this.divider.appendCurve(new LineSegment(origin, line_end));
    this.divider.close();
    this.half_dir = unit_vector(middle_point(line_start, line_end).sub(origin));
    let fillrule = FillRule.fill_nonZero;
    const style = this.current_shape?.style;
    if (style?.fill_rule.set && style.fill_rule.computed === SPWindRule.SP_WIND_RULE_EVENODD) {
      fillrule = FillRule.fill_oddEven;
    }
    if (method !== RotateMethod.RM_NORMAL) {
      if (method !== RotateMethod.RM_KALEIDOSCOPE) path_out = this.doEffect_path_post(path_in, fillrule);
      else path_out = pathv_to_linear_and_cubic_beziers(path_in);
      if (this.num_copies.get_value() === 0) return path_out;
      path_out = sp_pathvector_boolop(path_out, [this.divider], BooleanOp.bool_op_inters, fillrule, fillrule);
      if (!split_items) path_out = this.doEffect_path_post(path_out, fillrule);
      else path_out = paths_transformed(path_out, Translate(this.half_dir.mul(this.gap.get_value())));
    } else {
      path_out = this.doEffect_path_post(path_in, fillrule);
    }
    if (!split_items && method !== RotateMethod.RM_NORMAL) {
      const path_out_tmp: PathVector = [];
      for (const path_it of path_out) {
        if (path_it.empty()) continue;
        let curves = path_it.curves();
        if (path_it.closed()) {
          // the closing line segment is always of type Geom::LineSegment.
          const closingline = path_it.closingSegment();
          if (are_near(closingline.initialPoint(), closingline.finalPoint())) {
            // the closing line segment has zero-length. So stop before that one!
            curves = path_it.openCurves();
          }
        }
        const res = new Path();
        for (const c of curves) {
          if (!are_near(c.initialPoint(), c.pointAt(0.5), 0.05)) {
            if (!res.empty()) res.setFinal(c.initialPoint());
            res.appendCurve(c);
          }
        }
        if (path_it.closed()) res.close();
        path_out_tmp.push(res);
      }
      path_out = path_out_tmp;
    }
    return pathv_to_linear_and_cubic_beziers(path_out);
  }

  doEffect_path_post(path_in: PathVector, fillrule: FillRule): PathVector {
    const method = this.method.get_value();
    const num_copies = this.num_copies.get_value();
    const origin = this.origin.value;
    const starting_angle = this.starting_angle.get_value();
    const rotation_angle = this.rotation_angle.get_value();
    const mirror_copies = this.mirror_copies.get_value();
    if ((this.split_items.get_value() || num_copies === 1) && method === RotateMethod.RM_NORMAL) {
      if (this.split_items.get_value()) {
        const path_out = pathv_to_linear_and_cubic_beziers(path_in);
        const m = Translate(origin.neg()).multiply(Rotate(-rad_from_deg(starting_angle)));
        const t = m
          .multiply(Rotate(-rad_from_deg(starting_angle)))
          .multiply(Rotate(rad_from_deg(starting_angle)))
          .multiply(Translate(origin));
        return paths_transformed(path_out, t);
      }
      return path_in;
    }
    const pre = Translate(origin.neg()).multiply(Rotate(-rad_from_deg(starting_angle)));
    const original_pathv = pathv_to_linear_and_cubic_beziers(path_in);
    let output_pv: PathVector = [];
    let output: PathVector = [];
    const half_angle = Math.atan2(this.half_dir.y, this.half_dir.x);
    for (let i = 0; i < num_copies; ++i) {
      const rot = Rotate(-rad_from_deg(rotation_angle * i));
      let r = Scale(1, 1);
      if (i % 2 !== 0 && mirror_copies) {
        r = r.multiply(Rotate(-half_angle)).multiply(Scale(1, -1)).multiply(Rotate(half_angle));
      }
      let t = pre
        .multiply(r)
        .multiply(rot)
        .multiply(Rotate(rad_from_deg(starting_angle)))
        .multiply(Translate(origin));
      if (mirror_copies && i % 2 !== 0) {
        t = pre
          .multiply(r)
          .multiply(rot)
          .multiply(Rotate(rad_from_deg(starting_angle)).inverse())
          .multiply(Translate(origin));
      }
      if (method !== RotateMethod.RM_NORMAL) {
        //we use safest way to union
        let join_pv = paths_transformed(original_pathv, t);
        join_pv = paths_transformed(
          join_pv,
          Translate(this.half_dir.transformed(rot).mul(this.gap.get_value())),
        );
        if (output_pv.length) {
          output_pv = sp_pathvector_boolop(output_pv, join_pv, BooleanOp.bool_op_union, fillrule, fillrule);
        } else {
          output_pv = join_pv;
        }
      } else {
        t = pre
          .multiply(Rotate(-rad_from_deg(starting_angle)))
          .multiply(r)
          .multiply(rot)
          .multiply(Rotate(rad_from_deg(starting_angle)))
          .multiply(Translate(origin));
        if (mirror_copies && i % 2 !== 0) {
          t = pre
            .multiply(Rotate(rad_from_deg(-starting_angle - rotation_angle)))
            .multiply(r)
            .multiply(rot)
            .multiply(Rotate(-rad_from_deg(starting_angle)))
            .multiply(Translate(origin));
        }
        output_pv = paths_transformed(path_in, t);
        output.push(...output_pv);
      }
    }
    if (method !== RotateMethod.RM_NORMAL) output = output_pv;
    return output;
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.length = 0;
    const origin = this.origin.value;
    const hp = new Path(this.start_pos);
    hp.appendCurve(new LineSegment(this.start_pos, origin));
    const end = origin.add(
      this.dir
        .transformed(Rotate(-rad_from_deg(this.rotation_angle.get_value() + this.starting_angle.get_value())))
        .mul(distance(origin, this.starting_point.value)),
    );
    hp.appendCurve(new LineSegment(origin, end));
    hp_vec.push([hp]);
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    this.original_bbox(item as SPLPEItem, false, true);
  }
}
