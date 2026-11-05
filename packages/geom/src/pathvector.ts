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
import type { Point } from './point.ts';
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

  /**
   * The winding number of the paths around p (upstream PathVector::winding); open paths count as
   * closed. Positive for paths that turn from +x to +y. Curves other than lines are sampled
   * (32 points each), which is exact enough for inside tests.
   */
  winding(pv: readonly Path[], p: Point): number {
    let wind = 0;
    for (const path of pv) {
      let a = path.initialPoint();
      const curves = path.closed() ? path.curves() : [...path.curves(), path.closingSegment()];
      for (const c of curves) {
        const n = c.isLineSegment() ? 1 : 32;
        for (let i = 1; i <= n; i++) {
          const b = c.pointAt(i / n);
          const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
          if (a.y <= p.y) {
            if (b.y > p.y && side > 0) wind++;
          } else if (b.y <= p.y && side < 0) {
            wind--;
          }
          a = b;
        }
      }
    }
    return wind;
  },

  /** Total number of curves in all paths. */
  curveCount(pv: readonly Path[]): number {
    return pv.reduce((n, p) => n + p.size(), 0);
  },
};
