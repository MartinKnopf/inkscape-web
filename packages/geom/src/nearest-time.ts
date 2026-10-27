// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/nearest-time.h, src/3rdparty/2geom/src/2geom/nearest-time.cpp, src/3rdparty/2geom/src/2geom/pathvector.cpp
/*
 * Nearest time routines for D2<SBasis> and Piecewise<D2<SBasis>>
 *
 * Authors:
 *   Marco Cecchetti <mrcekets at gmail.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2007-2008 authors
 */
import { BezierCurve, LineSegment } from './bezier-curve.ts';
import type { Coord } from './coord.ts';
import type { Curve } from './curve.ts';
import type { Path } from './path.ts';
import { distanceSq, dot, type Point } from './point.ts';

/** Number of intervals searched for sign changes of the derivative of the squared distance. */
const SAMPLES = 64;

/**
 * The time in [0, 1] of the point of a line or Bezier curve nearest to p
 * (upstream nearest_time for D2<Bezier>). Upstream finds the roots of
 * dot(B - p, B') with Bernstein root finding; here sign changes of the same
 * polynomial are bracketed by sampling and refined by bisection.
 */
export function nearest_time(p: Point, c: BezierCurve): Coord {
  if (c instanceof LineSegment) {
    const a = c.initialPoint();
    const d = c.finalPoint().sub(a);
    const l2 = dot(d, d);
    if (l2 === 0) return 0;
    return Math.min(Math.max(dot(p.sub(a), d) / l2, 0), 1);
  }
  const pts = c.controlPoints();
  const n = pts.length - 1;
  // Control points of the derivative.
  const dpts = pts.slice(1).map((q, i) => q.sub(pts[i] as Point).mul(n));
  const deriv = (t: Coord): Point => bezierPoint(dpts, t);
  const f = (t: Coord): Coord => dot(c.pointAt(t).sub(p), deriv(t));

  let best = 0;
  let mind = distanceSq(c.initialPoint(), p);
  const consider = (t: Coord) => {
    const d = distanceSq(c.pointAt(t), p);
    if (d < mind) {
      mind = d;
      best = t;
    }
  };
  consider(1);
  let t0 = 0;
  let f0 = f(0);
  for (let i = 1; i <= SAMPLES; ++i) {
    const t1 = i / SAMPLES;
    const f1 = f(t1);
    if (f0 === 0) consider(t0);
    else if (f0 * f1 < 0) consider(bisect(f, t0, t1, f0));
    t0 = t1;
    f0 = f1;
  }
  return best;
}

/** Time of the nearest point of a curve (lines and Bezier curves; other curves by sampling). */
export function curve_nearest_time(p: Point, c: Curve): Coord {
  if (c instanceof BezierCurve) return nearest_time(p, c);
  let best = 0;
  let mind = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= SAMPLES; ++i) {
    const d = distanceSq(c.pointAt(i / SAMPLES), p);
    if (d < mind) {
      mind = d;
      best = i / SAMPLES;
    }
  }
  return best;
}

/** Position on a path vector: path index, curve index in the path and time on the curve. */
export interface PathVectorTime {
  path_index: number;
  curve_index: number;
  t: Coord;
}

/**
 * The time of the point of pv nearest to p (upstream PathVector::nearestTime).
 * Curves are those of Path.curves() (closed paths include a non-degenerate
 * closing segment). Returns null for a path vector without curves.
 */
export function pathv_nearest_time(pv: readonly Path[], p: Point): PathVectorTime | null {
  let best: PathVectorTime | null = null;
  let mind = Number.POSITIVE_INFINITY;
  pv.forEach((path, path_index) => {
    path.curves().forEach((c, curve_index) => {
      const t = curve_nearest_time(p, c);
      const d = distanceSq(c.pointAt(t), p);
      if (d < mind) {
        mind = d;
        best = { path_index, curve_index, t };
      }
    });
  });
  return best;
}

/** The point of pv at pvt (upstream PathVector::pointAt). */
export function pathv_point_at(pv: readonly Path[], pvt: PathVectorTime): Point {
  return (pv[pvt.path_index] as Path).curves()[pvt.curve_index]?.pointAt(pvt.t) as Point;
}

function bezierPoint(pts: readonly Point[], t: Coord): Point {
  // De Casteljau.
  let q = [...pts];
  while (q.length > 1) q = q.slice(1).map((b, i) => (q[i] as Point).lerp(t, b));
  return q[0] as Point;
}

function bisect(f: (t: Coord) => Coord, a: Coord, b: Coord, fa: Coord): Coord {
  for (let i = 0; i < 50; ++i) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm === 0) return m;
    if (fa * fm < 0) b = m;
    else {
      a = m;
      fa = fm;
    }
  }
  return (a + b) / 2;
}
