// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-recursiveskeleton.cpp, src/live_effects/lpe-recursiveskeleton.h
/**
 * @file
 * Inspired by Hofstadter's 'Goedel Escher Bach', chapter V.
 */
/* Authors:
 *   Johan Engelen <j.b.c.engelen@utwente.nl>
 *
 * Copyright (C) 2007-2009 Authors
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
 * Recursive skeleton (upstream LPERecursiveSkeleton): the path is placed along itself, again for
 * each iteration. The pwd2 math runs in WASM.
 */
export class LPERecursiveSkeleton extends Effect {
  readonly iterations: ScalarParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.iterations = new ScalarParam(_('Iterations:'), _('recursivity'), 'iterations', this, 2);
    this.show_orig_path = true;
    this.concatenate_before_pwd2 = true;
    this.iterations.param_make_integer(true);
    this.iterations.param_set_range(1, 15);
    this.registerParameter(this.iterations);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const d = pathBoolopBackend().recursiveSkeletonPath(write_svg_path(path_in), this.iterations.get_value());
    return sp_svg_read_pathv(d);
  }
}
