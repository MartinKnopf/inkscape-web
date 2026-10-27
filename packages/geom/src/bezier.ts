// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/bezier.h, src/3rdparty/2geom/src/2geom/bezier.cpp
/*
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *   Michael Sloan <mgsloan@gmail.com>
 *   Nathan Hurst <njh@njhurst.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2007-2015 Authors
 */
import { type Coord, EPSILON, lerp } from './coord.ts';
import { Interval } from './interval.ts';

// A Bezier polynomial is a plain array of Bernstein coefficients (order = length - 1).

/** Value of the polynomial at t (upstream bernstein_value_at). */
export function bernstein_value_at(t: Coord, c: readonly Coord[]): Coord {
  const n = c.length - 1;
  const u = 1 - t;
  let bc = 1;
  let tn = 1;
  let tmp = (c[0] as number) * u;
  for (let i = 1; i < n; i++) {
    tn = tn * t;
    bc = (bc * (n - i + 1)) / i;
    tmp = (tmp + tn * bc * (c[i] as number)) * u;
  }
  return tmp + tn * t * (c[n] as number);
}

/** Coefficients of the polynomial restricted to [0, t] (De Casteljau). */
function subdivideLeft(t: Coord, v: readonly Coord[]): Coord[] {
  const order = v.length - 1;
  const val = bernstein_value_at(t, v);
  const left = [...v];
  for (let i = order; i > 0; --i) {
    for (let j = i; j <= order; ++j) {
      left[j] = lerp(t, left[j - 1] as number, left[j] as number);
    }
  }
  left[order] = val;
  return left;
}

/** Coefficients of the polynomial restricted to [t, 1] (De Casteljau). */
function subdivideRight(t: Coord, v: readonly Coord[]): Coord[] {
  const order = v.length - 1;
  const val = bernstein_value_at(t, v);
  const right = [...v];
  for (let i = 1; i <= order; ++i) {
    for (let j = i; j > 0; --j) {
      right[j - 1] = lerp(t, right[j - 1] as number, right[j] as number);
    }
  }
  right[0] = val;
  return right;
}

/** The polynomial restricted to [from, to]; from > to reverses the result. */
export function portion(a: readonly Coord[], from: Coord, to: Coord): Coord[] {
  let ret = [...a];
  let reverseResult = false;
  if (from > to) {
    [from, to] = [to, from];
    reverseResult = true;
  }
  if (from === 0) {
    if (to !== 1) ret = subdivideLeft(to, ret);
  } else {
    ret = subdivideRight(from, ret);
    if (to !== 1) {
      ret = subdivideLeft((to - from) / (1 - from), ret);
      // Protect against numerical inaccuracy in the expression above: evaluate the last
      // coefficient directly on the original polynomial.
      ret[ret.length - 1] = bernstein_value_at(to, a);
    }
  }
  return reverseResult ? ret.reverse() : ret;
}

/** Range of the control values. Contains the polynomial on [0, 1]. */
export function bounds_fast(b: readonly Coord[]): Interval {
  return Interval.fromArray(b);
}

/**
 * Expand `range` to the image of the quadratic polynomial on [0, 1], assuming it already
 * contains x0.
 */
function expandQuadratic(range: Interval, x0: Coord, x1: Coord, x2: Coord): Interval {
  range = range.expandTo(x2);
  // The interval contains all control points, and therefore the entire curve.
  if (range.contains(x1)) return range;

  // p'(t) / 2 = at + b
  const a = x2 - x1 - (x1 - x0);
  const b = x1 - x0;
  if (Math.abs(a) > EPSILON) {
    const t = -b / a;
    if (t > 0 && t < 1) {
      const s = 1 - t;
      range = range.expandTo(s * s * x0 + 2 * s * t * x1 + t * t * x2);
    }
  }
  return range;
}

/**
 * Expand `range` to the image of the cubic polynomial on [0, 1], assuming it already
 * contains x0.
 */
function expandCubic(range: Interval, x0: Coord, x1: Coord, x2: Coord, x3: Coord): Interval {
  range = range.expandTo(x3);
  if (range.contains(x1) && range.contains(x2)) return range;

  // p'(t) / 3 = at^2 + 2bt + c
  const a = x3 - x0 - 3 * (x2 - x1);
  const b = x2 - x1 - (x1 - x0);
  const c = x1 - x0;

  const expand = (t: Coord) => {
    if (t > 0 && t < 1) {
      const s = 1 - t;
      range = range.expandTo(s * s * s * x0 + 3 * s * s * t * x1 + 3 * t * t * s * x2 + t * t * t * x3);
    }
  };

  // t = (-b +- sqrt(b^2 - ac)) / a
  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) > EPSILON) expand(-c / (2 * b));
  } else {
    const d2 = b * b - a * c;
    if (d2 >= 0) {
      const bsign = b >= 0 ? 1 : -1;
      const tmp = -(b + bsign * Math.sqrt(d2));
      expand(tmp / a);
      expand(c / tmp); // Vieta's formula: the product of the roots is c/a
    }
  }
  return range;
}

/** Exact range of a polynomial of order 1 to 3 on [0, 1]: the ends and the extrema in between. */
export function bounds_exact(b: readonly Coord[]): Interval {
  const [x0, x1, x2, x3] = b as [number, number, number, number];
  const start = new Interval(x0);
  switch (b.length) {
    case 2:
      return start.expandTo(x1);
    case 3:
      return expandQuadratic(start, x0, x1, x2);
    case 4:
      return expandCubic(start, x0, x1, x2, x3);
    default:
      throw new RangeError('bounds_exact: only Bezier polynomials up to order 3 are supported');
  }
}
