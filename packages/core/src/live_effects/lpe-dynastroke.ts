// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-dynastroke.cpp, src/live_effects/lpe-dynastroke.h
/** \file
 * LPE <dynastroke> implementation
 */
/*
 * Authors:
 *   JF Barraud
 *
 * Copyright (C) JF Barraud 2007 <jf.barraud@gmail.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type PathVector, write_svg_path } from '@inkscape-web/geom';
import { _, N_ } from '../i18n.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { PathParam } from './parameter/path.ts';

//TODO: growfor/fadefor can be expressed in unit of width.
//TODO: make round/sharp end choices independent for start and end.
//TODO: define more styles like in calligtool.
//TODO: allow fancy ends.

export enum DynastrokeMethod {
  DSM_ELLIPTIC_PEN = 0,
  DSM_THICKTHIN_FAST,
  DSM_THICKTHIN_SLOW,
  DSM_END, // This must be last
}

export enum DynastrokeCappingType {
  DSCT_SHARP = 0,
  DSCT_ROUND,
  // DSCT_PATH,
  DSCT_END, // This must be last
}

const DSMethodConverter = new EnumDataConverter<DynastrokeMethod>([
  { id: DynastrokeMethod.DSM_ELLIPTIC_PEN, label: N_('Elliptic Pen'), key: 'elliptic_pen' },
  { id: DynastrokeMethod.DSM_THICKTHIN_FAST, label: N_('Thick-Thin strokes (fast)'), key: 'thickthin_fast' },
  { id: DynastrokeMethod.DSM_THICKTHIN_SLOW, label: N_('Thick-Thin strokes (slow)'), key: 'thickthin_slow' },
]);

const DSCTConverter = new EnumDataConverter<DynastrokeCappingType>([
  { id: DynastrokeCappingType.DSCT_SHARP, label: N_('Sharp'), key: 'sharp' },
  { id: DynastrokeCappingType.DSCT_ROUND, label: N_('Round'), key: 'round' },
]);

/**
 * Dynamic stroke (upstream LPEDynastroke): a calligraphic outline of the path whose width depends
 * on the direction. The pwd2 math runs in WASM.
 */
export class LPEDynastroke extends Effect {
  readonly method: EnumParam<DynastrokeMethod>;
  readonly width: ScalarParam;
  readonly roundness: ScalarParam;
  readonly angle: ScalarParam;
  readonly start_cap: EnumParam<DynastrokeCappingType>;
  readonly end_cap: EnumParam<DynastrokeCappingType>;
  readonly growfor: ScalarParam;
  readonly fadefor: ScalarParam;
  readonly round_ends: BoolParam;
  readonly capping: PathParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    // initialise your parameters here:
    this.method = new EnumParam(
      _('Method:'),
      _('Choose pen type'),
      'method',
      DSMethodConverter,
      this,
      DynastrokeMethod.DSM_THICKTHIN_FAST,
    );
    this.width = new ScalarParam(_('Pen width:'), _('Maximal stroke width'), 'width', this, 25);
    this.roundness = new ScalarParam(_('Pen roundness:'), _('Min/Max width ratio'), 'roundness', this, 0.2);
    this.angle = new ScalarParam(
      _('Angle:'),
      _('direction of thickest strokes (opposite = thinnest)'),
      'angle',
      this,
      45,
    );
    this.start_cap = new EnumParam(
      _('Start:'),
      _('Choose start capping type'),
      'start_cap',
      DSCTConverter,
      this,
      DynastrokeCappingType.DSCT_SHARP,
    );
    this.end_cap = new EnumParam(
      _('End:'),
      _('Choose end capping type'),
      'end_cap',
      DSCTConverter,
      this,
      DynastrokeCappingType.DSCT_SHARP,
    );
    this.growfor = new ScalarParam(
      _('Grow for:'),
      _("Make the stroke thinner near it's start"),
      'growfor',
      this,
      100,
    );
    this.fadefor = new ScalarParam(
      _('Fade for:'),
      _("Make the stroke thinner near it's end"),
      'fadefor',
      this,
      100,
    );
    this.round_ends = new BoolParam(
      _('Round ends'),
      _('Strokes end with a round end'),
      'round_ends',
      this,
      false,
    );
    this.capping = new PathParam(
      _('Capping:'),
      _('left capping'),
      'capping',
      this,
      'M 100,5 C 50,5 0,0 0,0 0,0 50,-5 100,-5',
    );

    this.registerParameter(this.method);
    this.registerParameter(this.width);
    this.registerParameter(this.roundness);
    this.registerParameter(this.angle);
    this.registerParameter(this.start_cap);
    this.registerParameter(this.growfor);
    this.registerParameter(this.end_cap);
    this.registerParameter(this.fadefor);
    this.registerParameter(this.round_ends);
    this.registerParameter(this.capping);

    this.width.param_set_range(0, Number.MAX_VALUE);
    this.roundness.param_set_range(0.01, 1);
    this.angle.param_set_range(-360, 360);
    this.growfor.param_set_range(0, Number.MAX_VALUE);
    this.fadefor.param_set_range(0, Number.MAX_VALUE);

    this.show_orig_path = true;
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const d = pathBoolopBackend().dynastrokePath(
      write_svg_path(path_in),
      this.method.get_value(),
      this.width.get_value(),
      this.roundness.get_value(),
      this.angle.get_value(),
      this.start_cap.get_value(),
      this.end_cap.get_value(),
      this.growfor.get_value(),
      this.fadefor.get_value(),
    );
    return sp_svg_read_pathv(d);
  }
}
