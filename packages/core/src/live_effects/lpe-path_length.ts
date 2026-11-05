// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-path_length.cpp, src/live_effects/lpe-path_length.h
/** \file
 * LPE <path_length> implementation
 */
/*
 * Authors:
 *   Maximilian Albert
 *
 * Copyright (C) Maximilian Albert 2008 <maximilian.albert@gmail.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type PathVector, write_svg_path } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { convertUnit } from '../svg/svg-length.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { TextParamInternal } from './parameter/text.ts';
import { UnitParam } from './parameter/unit.ts';
import { pwd2Transformed } from './pwd2.ts';

/**
 * Path length (upstream LPEPathLength): the length of the path as text on the canvas, in a unit
 * and with a scale factor. The path itself is unchanged.
 */
export class LPEPathLength extends Effect {
  readonly scale: ScalarParam;
  readonly info_text: TextParamInternal;
  readonly unit: UnitParam;
  readonly display_unit: BoolParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.scale = new ScalarParam(_('Scale:'), _('Scaling factor'), 'scale', this, 1.0);
    this.info_text = new TextParamInternal(this);
    this.unit = new UnitParam(_('Unit:'), _('Unit'), 'unit', this);
    this.display_unit = new BoolParam(
      _('Display unit'),
      _('Print unit after path length'),
      'display_unit',
      this,
      true,
    );
    this.registerParameter(this.scale);
    this.registerParameter(this.info_text);
    this.registerParameter(this.unit);
    this.registerParameter(this.display_unit);
  }

  /** Upstream doEffect_pwd2 on each subpath; the path is the same (as piecewise SBasis and back). */
  protected override doEffect_path(path_in: PathVector): PathVector {
    for (const path of path_in) {
      /* convert the measured length to the correct unit ... */
      let lengthval = pathBoolopBackend().pwd2Length(write_svg_path([path])) * this.scale.get_value();
      lengthval = convertUnit(lengthval, 'px', this.unit.get_abbreviation());

      /* ... set it as the canvas text ... */
      const arc_length = `${lengthval.toFixed(2)} ${this.display_unit.get_value() ? this.unit.get_abbreviation() : ''}`;
      this.info_text.param_setValue(arc_length);

      this.info_text.setPosAndAnchor(path, 0.5, 10);

      if (!this.isVisible()) this.info_text.param_setValue('');
    }
    return pwd2Transformed(path_in, [1, 0, 0, 1, 0, 0]);
  }
}
