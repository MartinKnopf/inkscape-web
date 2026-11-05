// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-circle_3pts.cpp, src/live_effects/lpe-circle_3pts.h
/** \file
 * LPE "Circle through 3 points" implementation
 */
/*
 * Authors:
 *   Maximilian Albert
 *
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 * Copyright (C) Maximilian Albert 2008 <maximilian.albert@gmail.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { L2, Path, type PathVector, type Point } from '@inkscape-web/geom';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';

/** The circle through the points A, B and C as a path. */
function circle3(A: Point, B: Point, C: Point): PathVector {
  const D = A.add(B).div(2);
  const E = B.add(C).div(2);

  const v = B.sub(A).ccw();
  const w = C.sub(B).ccw();

  const det = -v.x * w.y + v.y * w.x;

  let M: Point;
  if (!v.isZero()) {
    const F = E.sub(D);
    const lambda = det === 0 ? 0 : (-w.y * F.x + w.x * F.y) / det;
    M = D.add(v.mul(lambda));
  } else {
    M = E;
  }

  const radius = L2(M.sub(A));
  return [Path.fromCircle(M, radius)];
}

/** Circle through 3 points (upstream LPECircle3Pts): the circle through the first three nodes. */
export class LPECircle3Pts extends Effect {
  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const first = path_in[0];
    if (!first) return path_in;
    // we assume that the path has >= 3 nodes
    const A = first.initialPoint();
    const B = first.pointAt(1);
    const C = first.pointAt(2);
    return circle3(A, B, C);
  }
}
