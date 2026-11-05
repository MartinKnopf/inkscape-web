// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-circle_with_radius.cpp, src/live_effects/lpe-circle_with_radius.h
/**
 * @file
 * LPE effect that draws a circle based on two points and a radius.
 */
/* Authors:
 *   Johan Engelen <j.b.c.engelen@utwente.nl>
 *
 * Copyright (C) 2007 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { L2, Path, type PathVector } from '@inkscape-web/geom';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';

/** Circle with radius (upstream LPECircleWithRadius): the circle around the first node through the last node. */
export class LPECircleWithRadius extends Effect {
  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const first = path_in[0];
    if (!first) return path_in;
    const center = first.initialPoint();
    const pt = first.finalPoint();
    const radius = L2(pt.sub(center));
    return [Path.fromCircle(center, radius)];
  }
}
