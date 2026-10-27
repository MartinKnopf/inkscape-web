// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/pathvector.h, src/3rdparty/2geom/src/2geom/pathvector.cpp
/*
 * Authors:
 *   Johan Engelen <goejendaagh@zonnet.nl>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2008-2014 authors
 */
import type { Affine } from './affine.ts';
import type { Path } from './path.ts';
import { type OptRect, unify } from './rect.ts';

/** A set of subpaths. */
export type PathVector = Path[];

export const PathVector = {
  /** Bounding box from the fast bounds of the paths; null if there is no non-empty path. */
  boundsFast(pv: readonly Path[]): OptRect {
    return pv.reduce<OptRect>((acc, p) => unify(acc, p.boundsFast()), null);
  },

  /** Tight bounding box; null if there is no non-empty path. */
  boundsExact(pv: readonly Path[]): OptRect {
    return pv.reduce<OptRect>((acc, p) => unify(acc, p.boundsExact()), null);
  },

  /** The paths after the transform. */
  transformed(pv: readonly Path[], m: Affine): PathVector {
    return pv.map((p) => p.transformed(m));
  },

  /** Every path reversed, and by default also the order of the paths. */
  reversed(pv: readonly Path[], reversePaths = true): PathVector {
    const ret = pv.map((p) => p.reversed());
    return reversePaths ? ret.reverse() : ret;
  },

  /** Total number of curves in all paths. */
  curveCount(pv: readonly Path[]): number {
    return pv.reduce((n, p) => n + p.size(), 0);
  },
};
