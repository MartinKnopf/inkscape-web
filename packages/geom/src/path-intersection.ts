// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/path-intersection.h, src/3rdparty/2geom/src/2geom/path-intersection.cpp
/*
 * Authors:
 *   Michael G. Sloan <mgsloan@gmail.com>
 *   Nathan Hurst <njh@njhurst.com>
 *
 * Copyright 2006-2008 authors
 */
import type { Curve } from './curve.ts';
import type { Path } from './path.ts';
import type { Point } from './point.ts';

/** Samples per curve that is not a line; a crossing is found where the sign of the distance changes. */
const SAMPLES = 64;
const BISECTIONS = 50;
/** Crossings closer than this on the line are one crossing (the line passes a vertex of the path). */
const DUPLICATE_TIME = 1e-9;

/**
 * The times t in [0, 1] along the line segment a to b (the point is a + t (b - a)) where it crosses
 * paths, sorted, without duplicates (upstream: Geom::crossings(), then the `ta` of the crossings with
 * delete_duplicates()). The curves are sampled and the crossings refined by bisection, so a crossing is
 * missed when the path only touches the line between two samples.
 */
export function lineCrossings(a: Point, b: Point, paths: readonly Path[]): number[] {
  const d = b.sub(a);
  const len2 = d.lengthSq();
  if (len2 === 0) return [];
  // Signed distance (times |d|) of a point from the line through a and b.
  const side = (p: Point): number => d.x * (p.y - a.y) - d.y * (p.x - a.x);
  const times: number[] = [];

  const crossCurve = (c: Curve) => {
    const n = c.isLineSegment() ? 1 : SAMPLES;
    let u0 = 0;
    let f0 = side(c.pointAt(0));
    for (let i = 1; i <= n; i++) {
      const u1 = i / n;
      const f1 = side(c.pointAt(u1));
      if (f0 < 0 !== f1 < 0) {
        let lo = u0;
        let hi = u1;
        const flo = f0;
        for (let k = 0; k < BISECTIONS; k++) {
          const mid = (lo + hi) / 2;
          if (side(c.pointAt(mid)) < 0 === flo < 0) lo = mid;
          else hi = mid;
        }
        const q = c.pointAt((lo + hi) / 2).sub(a);
        const t = (q.x * d.x + q.y * d.y) / len2;
        if (t >= 0 && t <= 1) times.push(t);
      }
      u0 = u1;
      f0 = f1;
    }
  };

  for (const path of paths) for (const c of path.curves()) if (!c.isDegenerate()) crossCurve(c);

  times.sort((x, y) => x - y);
  return times.filter((t, i) => i === 0 || t - (times[i - 1] ?? 0) > DUPLICATE_TIME);
}
