// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-interpolate_points.cpp, src/live_effects/lpe-interpolate_points.h
/** \file
 * LPE <interpolate_points> implementation
 */
/*
 * Authors:
 *   Johan Engelen
 *
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import type { PathVector } from '@inkscape-web/geom';
import { _, N_ } from '../i18n.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import { InterpolatorType } from './lpe-powerstroke.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { EnumParam } from './parameter/enum.ts';

const InterpolatorTypeConverter = new EnumDataConverter<InterpolatorType>([
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

/**
 * Interpolate points (upstream LPEInterpolatePoints): a curve through the nodes of the path. The
 * interpolators run in WASM.
 */
export class LPEInterpolatePoints extends Effect {
  readonly interpolator_type: EnumParam<InterpolatorType>;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.interpolator_type = new EnumParam(
      _('Interpolator type:'),
      _(
        'Determines which kind of interpolator will be used to interpolate between stroke width along the path',
      ),
      'interpolator_type',
      InterpolatorTypeConverter,
      this,
      InterpolatorType.INTERP_CENTRIPETAL_CATMULLROM,
    );
    this.show_orig_path = false;
    this.registerParameter(this.interpolator_type);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const path_out: PathVector = [];
    for (const path_it of path_in) {
      if (path_it.empty()) continue;

      if (path_it.closed()) {
        console.warn('Interpolate points LPE currently ignores whether path is closed or not.');
      }

      const start = path_it.initialPoint();
      const xy: number[] = [start.x, start.y];
      for (const curve of path_it.curves()) {
        const end = curve.finalPoint();
        xy.push(end.x, end.y);
      }

      const d = pathBoolopBackend().interpolatePoints(xy, this.interpolator_type.get_value());
      const path = sp_svg_read_pathv(d)[0];
      if (path) path_out.push(path);
    }
    return path_out;
  }
}
