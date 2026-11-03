// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-jointype.cpp, src/live_effects/lpe-jointype.h
/* Authors:
 *
 *	 Liam P White
 *
 * Copyright (C) 2014 Authors
 */
import { type Affine, type PathVector, write_svg_path } from '@inkscape-web/geom';
import { _, N_ } from '../i18n.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { SPShape } from '../object/sp-shape.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { Preferences } from '../preferences.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import { LPETypeConverter } from './effect-enum.ts';
import { lpe_shape_convert_stroke_and_fill, lpe_shape_revert_stroke_and_fill } from './fill-conversion.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { ScalarParam } from './parameter/parameter.ts';

/** Inkscape::LineJoinType (helper/geom-pathstroke.h). */
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

/** Inkscape::LineCapType (helper/geom-pathstroke.h). */
export enum ButtType {
  BUTT_FLAT,
  BUTT_ROUND,
  BUTT_SQUARE,
  BUTT_PEAK, // This is not a line ending supported by the SVG standard.
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

const CapTypeConverter = new EnumDataConverter<ButtType>([
  { id: ButtType.BUTT_FLAT, label: N_('Butt'), key: 'butt' },
  { id: ButtType.BUTT_ROUND, label: N_('Rounded'), key: 'round' },
  { id: ButtType.BUTT_SQUARE, label: N_('Square'), key: 'square' },
  { id: ButtType.BUTT_PEAK, label: N_('Peak'), key: 'peak' },
]);

/** Join type (upstream LPEJoinType): the stroke as a filled outline with the chosen joins and caps. */
export class LPEJoinType extends Effect {
  readonly line_width: ScalarParam;
  readonly linecap_type: EnumParam<ButtType>;
  readonly linejoin_type: EnumParam<LineJoinType>;
  readonly miter_limit: ScalarParam;
  readonly attempt_force_join: BoolParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.line_width = new ScalarParam(_('Line width'), _('Thickness of the stroke'), 'line_width', this, 1);
    this.linecap_type = new EnumParam(
      _('Line cap'),
      _('The end shape of the stroke'),
      'linecap_type',
      CapTypeConverter,
      this,
      ButtType.BUTT_FLAT,
    );
    this.linejoin_type = new EnumParam(
      _('Join:'),
      _("Determines the shape of the path's corners"),
      'linejoin_type',
      JoinTypeConverter,
      this,
      LineJoinType.JOIN_EXTRAPOLATE,
    );
    this.miter_limit = new ScalarParam(
      _('Miter limit:'),
      _('Maximum length of the miter join (in units of stroke width)'),
      'miter_limit',
      this,
      100,
    );
    this.attempt_force_join = new BoolParam(
      _('Force miter'),
      _('Overrides the miter limit and forces a join.'),
      'attempt_force_join',
      this,
      true,
    );
    this.show_orig_path = true;
    this.registerParameter(this.linecap_type);
    this.registerParameter(this.line_width);
    this.registerParameter(this.linejoin_type);
    this.registerParameter(this.miter_limit);
    this.registerParameter(this.attempt_force_join);
  }

  protected override doOnApply(lpeitem: SPLPEItem): void {
    if (!(lpeitem instanceof SPShape)) return;
    const width = lpeitem.style ? lpeitem.style.stroke_width.computed : 1;
    lpe_shape_convert_stroke_and_fill(lpeitem);
    const pref_path = `/live_effects/${LPETypeConverter.get_key(this.effectType())}/line_width`;
    if (!Preferences.get().isSet(pref_path)) this.line_width.param_set_value(width);
    this.line_width.write_to_SVG();
  }

  protected override transform_multiply(postmul: Affine, _set: boolean): void {
    if (Preferences.get().getBool('/options/transform/stroke', true)) {
      this.line_width.param_transform_multiply(postmul, false);
    }
  }

  //from LPEPowerStroke -- sets stroke color from existing fill color
  protected override doOnRemove(lpeitem: SPLPEItem | null): void {
    if (lpeitem instanceof SPShape) lpe_shape_revert_stroke_and_fill(lpeitem, this.line_width.get_value());
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const d = pathBoolopBackend().joinTypePath(
      write_svg_path(path_in),
      this.line_width.get_value(),
      this.miter_limit.get_value(),
      this.attempt_force_join.get_value(),
      this.linejoin_type.get_value(),
      this.linecap_type.get_value(),
    );
    return sp_svg_read_pathv(d);
  }
}
