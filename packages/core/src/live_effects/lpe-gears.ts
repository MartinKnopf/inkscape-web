// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-gears.cpp, src/live_effects/lpe-gears.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 * Copyright 2006 Michael G. Sloan <mgsloan@gmail.com>
 * Copyright 2006 Aaron Spike <aaron@ekips.org>
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

/**
 * Gears (upstream LPEGears): the first node is the centre of the first gear, the second sets its
 * radius, each further node is the centre of a gear that meshes with the previous one. The gear
 * outlines (class Gear) are computed in WASM.
 */
export class LPEGears extends Effect {
  readonly teeth: ScalarParam;
  readonly phi: ScalarParam;
  readonly min_radius: ScalarParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.teeth = new ScalarParam(_('_Teeth:'), _('The number of teeth'), 'teeth', this, 10);
    this.phi = new ScalarParam(
      _('_Phi:'),
      _('Tooth pressure angle (typically 20-25 deg).  The ratio of teeth not in contact.'),
      'phi',
      this,
      5,
    );
    this.min_radius = new ScalarParam(
      _('Min Radius:'),
      _('Minimum radius, low values can be slow'),
      'min_radius',
      this,
      5.0,
    );
    /* Tooth pressure angle: The angle between the tooth profile and a perpendicular to the pitch
     * circle, usually at the point where the pitch circle meets the tooth profile. Standard angles
     * are 20 and 25 degrees. The pressure angle affects the force that tends to separate mating
     * gears. A high pressure angle means that higher ratio of teeth not in contact. However, this
     * allows the teeth to have higher capacity and also allows fewer teeth without undercutting.
     */
    this.teeth.param_make_integer();
    this.teeth.param_set_range(3, 1e10);
    this.min_radius.param_set_range(0.01, Number.MAX_VALUE);
    this.registerParameter(this.teeth);
    this.registerParameter(this.phi);
    this.registerParameter(this.min_radius);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const d = pathBoolopBackend().gearsPath(
      write_svg_path(path_in.slice(0, 1)),
      this.teeth.get_value(),
      this.phi.get_value(),
      this.min_radius.get_value(),
    );
    return sp_svg_read_pathv(d);
  }
}
