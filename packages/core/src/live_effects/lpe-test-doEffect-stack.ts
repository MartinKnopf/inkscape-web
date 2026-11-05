// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-test-doEffect-stack.cpp, src/live_effects/lpe-test-doEffect-stack.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type PathVector, write_svg_path } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { PathParam } from './parameter/path.ts';
import { PointParam } from './parameter/point.ts';

/**
 * doEffect stack test (upstream LPEdoEffectStackTest): a test effect. With step 0 the path stays
 * as it is; from step 2 it goes through the pwd2 stage of Effect::doEffect_path unchanged.
 */
export class LPEdoEffectStackTest extends Effect {
  readonly step: ScalarParam;
  readonly point: PointParam;
  readonly path: PathParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.step = new ScalarParam(_('Stack step:'), 'How deep we should go into the stack', 'step', this);
    this.point = new PointParam(_('Point param:'), 'tooltip of point parameter', 'point_param', this);
    this.path = new PathParam(
      _('Path param:'),
      'tooltip of path parameter',
      'path_param',
      this,
      'M 0,100 100,0',
    );
    this.registerParameter(this.step);
    this.registerParameter(this.point);
    this.registerParameter(this.path);
  }

  override doEffect(curve: PathVector): PathVector {
    if (this.step.get_value() >= 1) return super.doEffect(curve);
    // return here
    return curve;
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    if (this.step.get_value() >= 2) {
      return sp_svg_read_pathv(pathBoolopBackend().identityPwd2Path(write_svg_path(path_in)));
    }
    // return here
    return path_in;
  }
}
