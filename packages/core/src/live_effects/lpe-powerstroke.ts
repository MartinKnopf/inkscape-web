// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-powerstroke.cpp, src/live_effects/lpe-powerstroke.h
/**
 * @file
 * PowerStroke LPE implementation. Creates curves with modifiable stroke width.
 */
/* Authors:
 *   Johan Engelen <j.b.c.engelen@alumnus.utwente.nl>
 *
 * Copyright (C) 2010-2012 Authors
 */
import { type Affine, type Path, type PathVector, Point, write_svg_path } from '@inkscape-web/geom';
import { count_path_curves, pathv_to_linear_and_cubic_beziers } from '../helper/geom.ts';
import { _, N_ } from '../i18n.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { SPShape } from '../object/sp-shape.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { Preferences } from '../preferences.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import { EffectType } from './effect-enum.ts';
import { lpe_shape_convert_stroke_and_fill, lpe_shape_revert_stroke_and_fill } from './fill-conversion.ts';
import type { LPESimplify } from './lpe-simplify.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { MessageParam } from './parameter/message.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { PowerStrokePointArrayParam } from './parameter/powerstrokepointarray.ts';

/** Geom::Interpolate::InterpolatorType (lpe-powerstroke-interpolators.h). */
export enum InterpolatorType {
  INTERP_LINEAR,
  INTERP_CUBICBEZIER,
  INTERP_CUBICBEZIER_JOHAN,
  INTERP_SPIRO,
  INTERP_CUBICBEZIER_SMOOTH,
  INTERP_CENTRIPETAL_CATMULLROM,
}

const InterpolatorTypeConverter = new EnumDataConverter<InterpolatorType>([
  {
    id: InterpolatorType.INTERP_CUBICBEZIER_SMOOTH,
    label: N_('CubicBezierSmooth'),
    key: 'CubicBezierSmooth',
  },
  { id: InterpolatorType.INTERP_LINEAR, label: N_('Linear'), key: 'Linear' },
  { id: InterpolatorType.INTERP_CUBICBEZIER, label: N_('CubicBezierFit'), key: 'CubicBezierFit' },
  { id: InterpolatorType.INTERP_CUBICBEZIER_JOHAN, label: N_('CubicBezierJohan'), key: 'CubicBezierJohan' },
  { id: InterpolatorType.INTERP_SPIRO, label: N_('SpiroInterpolator'), key: 'SpiroInterpolator' },
  {
    id: InterpolatorType.INTERP_CENTRIPETAL_CATMULLROM,
    label: N_('Centripetal Catmull-Rom'),
    key: 'CentripetalCatmullRom',
  },
]);

export enum LineJoinType {
  LINEJOIN_BEVEL,
  LINEJOIN_ROUND,
  LINEJOIN_EXTRP_MITER,
  LINEJOIN_MITER,
  LINEJOIN_SPIRO,
  LINEJOIN_EXTRP_MITER_ARC,
}

const LineJoinTypeConverter = new EnumDataConverter<LineJoinType>([
  { id: LineJoinType.LINEJOIN_BEVEL, label: N_('Beveled'), key: 'bevel' },
  { id: LineJoinType.LINEJOIN_ROUND, label: N_('Rounded'), key: 'round' },
  //    {LINEJOIN_EXTRP_MITER,  N_("Extrapolated"),      "extrapolated"}, // disabled because doesn't work well
  { id: LineJoinType.LINEJOIN_EXTRP_MITER_ARC, label: N_('Extrapolated arc'), key: 'extrp_arc' },
  { id: LineJoinType.LINEJOIN_MITER, label: N_('Miter'), key: 'miter' },
  { id: LineJoinType.LINEJOIN_SPIRO, label: N_('Spiro'), key: 'spiro' },
]);

export enum LineCapType {
  LINECAP_BUTT,
  LINECAP_SQUARE,
  LINECAP_ROUND,
  LINECAP_PEAK,
  LINECAP_ZERO_WIDTH,
}

export const LineCapTypeConverter = new EnumDataConverter<LineCapType>([
  { id: LineCapType.LINECAP_BUTT, label: N_('Butt'), key: 'butt' },
  { id: LineCapType.LINECAP_SQUARE, label: N_('Square'), key: 'square' },
  { id: LineCapType.LINECAP_ROUND, label: N_('Round'), key: 'round' },
  { id: LineCapType.LINECAP_PEAK, label: N_('Peak'), key: 'peak' },
  { id: LineCapType.LINECAP_ZERO_WIDTH, label: N_('Zero width'), key: 'zerowidth' },
]);

/**
 * Power stroke (upstream LPEPowerStroke): a filled outline around the path whose width is set by
 * width points along the path. The outline of each subpath is computed in WASM.
 */
export class LPEPowerStroke extends Effect {
  readonly offset_points: PowerStrokePointArrayParam;
  readonly not_jump: BoolParam;
  knotdragging = false;
  readonly sort_points: BoolParam;
  readonly interpolator_type: EnumParam<InterpolatorType>;
  readonly interpolator_beta: ScalarParam;
  readonly scale_width: ScalarParam;
  readonly start_linecap_type: EnumParam<LineCapType>;
  readonly linejoin_type: EnumParam<LineJoinType>;
  readonly miter_limit: ScalarParam;
  readonly end_linecap_type: EnumParam<LineCapType>;
  readonly message: MessageParam;
  recusion_limit = 0;
  has_recursion = false;
  path_out_prev: PathVector = [];

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.offset_points = new PowerStrokePointArrayParam(
      _('Offset points'),
      _('Offset points'),
      'offset_points',
      this,
    );
    this.not_jump = new BoolParam(
      _('No jumping handles'),
      _(
        'Allow to move handles along the path without them automatically attaching to the nearest path segment',
      ),
      'not_jump',
      this,
      false,
    );
    this.sort_points = new BoolParam(
      _('Sort points'),
      _('Sort offset points according to their time value along the curve'),
      'sort_points',
      this,
      true,
    );
    this.interpolator_type = new EnumParam(
      _('Smoothing type'),
      _(
        'Determines which kind of interpolator will be used to interpolate between stroke width along the path',
      ),
      'interpolator_type',
      InterpolatorTypeConverter,
      this,
      InterpolatorType.INTERP_CENTRIPETAL_CATMULLROM,
    );
    this.interpolator_beta = new ScalarParam(
      _('Smoothness:'),
      _('Sets the smoothness for the CubicBezierJohan interpolator; 0 = linear interpolation, 1 = smooth'),
      'interpolator_beta',
      this,
      0.2,
    );
    this.scale_width = new ScalarParam(
      _('Width multiplier'),
      _("Scale the stroke's width uniformly along the whole path"),
      'scale_width',
      this,
      1.0,
    );
    this.start_linecap_type = new EnumParam(
      _('Start cap:'),
      _("Determines the shape of the path's start"),
      'start_linecap_type',
      LineCapTypeConverter,
      this,
      LineCapType.LINECAP_ZERO_WIDTH,
    );
    this.linejoin_type = new EnumParam(
      _('Join'),
      _("Determines the shape of the path's corners"),
      'linejoin_type',
      LineJoinTypeConverter,
      this,
      LineJoinType.LINEJOIN_ROUND,
    );
    this.miter_limit = new ScalarParam(
      _('Miter limit'),
      _('Maximum length of the miter (in units of stroke width)'),
      'miter_limit',
      this,
      4,
    );
    this.end_linecap_type = new EnumParam(
      _('End cap'),
      _("Determines the shape of the path's end"),
      'end_linecap_type',
      LineCapTypeConverter,
      this,
      LineCapType.LINECAP_ZERO_WIDTH,
    );
    this.message = new MessageParam(
      _('Add new thickness control point'),
      _('Important messages'),
      'message',
      this,
      _('<b>Ctrl + click</b> on existing node and move it'),
    );
    this.show_orig_path = true;

    this.registerParameter(this.scale_width);
    this.registerParameter(this.interpolator_type);
    this.registerParameter(this.interpolator_beta);
    this.registerParameter(this.start_linecap_type);
    this.registerParameter(this.end_linecap_type);
    this.registerParameter(this.offset_points);
    this.registerParameter(this.linejoin_type);
    this.registerParameter(this.miter_limit);
    this.registerParameter(this.not_jump);
    this.registerParameter(this.sort_points);
    this.registerParameter(this.message);

    this.message.write_to_SVG(); // resert old legacy uneeded data
    this.interpolator_beta.addSlider(true);
    this.interpolator_beta.param_set_range(0, 1);

    this.scale_width.addSlider(true);
    this.scale_width.param_set_range(0.0, 100);
    this.scale_width.param_set_increments(0.1, 0.1);
    this.scale_width.param_set_digits(1);
    this._provides_path_adjustment = true;
  }

  protected override doBeforeEffect(_lpeItem: SPLPEItem): void {
    this.offset_points.set_scale_width(this.scale_width.get_value());
    if (this.has_recursion) {
      this.has_recursion = false;
      this.adjustForNewPath();
    }
  }

  applyStyle(lpeitem: SPLPEItem): void {
    if (lpeitem instanceof SPShape) lpe_shape_convert_stroke_and_fill(lpeitem);
  }

  protected override doOnApply(lpeitem: SPLPEItem): void {
    if (!(lpeitem instanceof SPShape)) {
      console.warn('LPE Powerstroke can only be applied to shapes (not groups).');
      return;
    }
    this.lpeversion.param_setValue('1.3', true);
    const points: Point[] = [];
    const pathv = pathv_to_linear_and_cubic_beziers(lpeitem.curve() ?? []);
    const width = lpeitem.style ? lpeitem.style.stroke_width.computed / 2 : 1;
    const powerpencil = Preferences.get().getBool('/live_effects/powerstroke/powerpencil', false);
    const clipboard = this.offset_points.data().length > 0;
    if (!powerpencil) this.applyStyle(lpeitem);
    if (!clipboard && !powerpencil) {
      lpeitem.updateRepr();
      if (pathv.length === 0) {
        points.push(new Point(0.2, width), new Point(0.5, width), new Point(0.8, width));
      } else {
        let current_pos = 0;
        for (const path of pathv) {
          const psize = count_path_curves(path);
          if (!path.closed()) points.push(new Point(0.2 + current_pos, width));
          points.push(new Point(0.5 * psize + current_pos, width));
          if (!path.closed()) points.push(new Point(psize - 0.2 + current_pos, width));
          current_pos += psize;
        }
      }
      this.offset_points.param_set_and_write_new_value(points);
    }
    this.offset_points.set_scale_width(this.scale_width.get_value());
  }

  protected override doOnRemove(lpeitem: SPLPEItem | null): void {
    if (lpeitem instanceof SPShape && !this.keep_paths) {
      // medial width give half
      lpe_shape_revert_stroke_and_fill(lpeitem, this.offset_points.median_width() * 2);
    }
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    if (path_in.length === 0) return path_in;
    const path_out: Path[] = [];
    const pathv = pathv_to_linear_and_cubic_beziers(path_in);
    const version = this.lpeversion.param_getSVGValue();
    if (this._adjust_path) {
      this.path_out_prev = [];
      this._adjust_path = false; // not wait till effect finish
      this.offset_points.recalculate_controlpoints(version < '1.3' ? pathv.slice(0, 1) : pathv);
    }
    if (pathv.every((p) => p.empty())) return path_in;
    const path_out_prev_tmp = this.path_out_prev;
    this.path_out_prev = [];
    this.offset_points.set_pwd2(pathv);
    let path_init = 0;
    let pathindex = 0;
    const backend = pathBoolopBackend();
    for (const path of pathv) {
      if (path.empty()) {
        console.error('LPEPowerStroke::doEffect_path: empty sub-path!');
        continue;
      }
      // the time range of the path in the times of the width points
      const psize = count_path_curves(path);
      path_init += psize;
      if (
        !this.offset_points.unplaced &&
        this.knotdragging &&
        path_out_prev_tmp.length > pathindex &&
        pathindex !== this.offset_points.current_path &&
        this.offset_points.current_path !== -1
      ) {
        // keep the outlines of the other subpaths while a knot is dragged
        const keep = path.closed() ? 2 : 1;
        for (let k = 0; k < keep; k++) {
          const prev = path_out_prev_tmp[pathindex] as Path;
          path_out.push(prev);
          this.path_out_prev.push(prev);
          pathindex++;
        }
        continue;
      }
      const ts: number[] = [];
      for (const tsp of this.offset_points.data()) {
        if (path_init - psize <= tsp.x && path_init >= tsp.x) {
          ts.push(tsp.x - (path_init - psize), tsp.y * this.scale_width.get_value());
        }
      }
      if (this.offset_points.data().length === 0) continue;
      const d = backend.powerstrokePath(
        write_svg_path([path]),
        ts,
        version < '1.3',
        this.sort_points.get_value(),
        this.interpolator_type.get_value(),
        this.interpolator_beta.get_value(),
        this.start_linecap_type.get_value(),
        this.end_linecap_type.get_value(),
        this.linejoin_type.get_value(),
        this.miter_limit.get_value(),
      );
      const out = d ? sp_svg_read_pathv(d) : [];
      for (const p of out) {
        path_out.push(p);
        this.path_out_prev.push(p);
        pathindex++;
      }
      if (version < '1.3') break;
    }
    if (path_out.length === 0) return path_in;
    return path_out;
  }

  protected override transform_multiply(postmul: Affine, _set: boolean): void {
    if (!this.sp_lpe_item?.unoptimized()) this.offset_points.param_transform_multiply(postmul, false);
  }

  protected override doAfterEffect(_lpeitem: SPLPEItem, _curve: PathVector | null): void {
    if (this.pathvector_before_effect[0]?.size() === this.pathvector_after_effect[0]?.size()) {
      if (this.recusion_limit < 6) {
        const effect = this.sp_lpe_item?.getFirstPathEffectOfType(EffectType.SIMPLIFY);
        if (effect) {
          const simplify = effect.getLPEObj().get_lpe() as LPESimplify;
          const threshold = simplify.threshold.get_value() * 1.2;
          simplify.threshold.param_set_value(threshold);
          simplify.threshold.write_to_SVG();
          this.has_recursion = true;
        }
      }
      ++this.recusion_limit;
    } else {
      this.recusion_limit = 0;
    }
  }
}
