// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/bezier-utils.h, src/3rdparty/2geom/src/2geom/bezier-utils.cpp
/* Bezier interpolation for inkscape drawing code.
 *
 * Original code published in:
 *   An Algorithm for Automatically Fitting Digitized Curves
 *   by Philip J. Schneider
 *  "Graphics Gems", Academic Press, 1990
 *
 * Authors:
 *   Philip J. Schneider
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Peter Moulder <pmoulder@mail.csse.monash.edu.au>
 *
 * Copyright (C) 1990 Philip J. Schneider
 * Copyright (C) 2001 Lauris Kaplinski
 * Copyright (C) 2001 Ximian, Inc.
 * Copyright (C) 2003,2004 Monash University
 */

import { distance, dot, Point, rot90, unit_vector } from './point.ts';

const unconstrained_tangent = new Point(0, 0);

// B0, B1, B2, B3 : Bezier multipliers
const B0 = (u: number): number => (1.0 - u) * (1.0 - u) * (1.0 - u);
const B1 = (u: number): number => 3 * u * (1.0 - u) * (1.0 - u);
const B2 = (u: number): number => 3 * u * u * (1.0 - u);
const B3 = (u: number): number => u * u * u;

const lensq = (p: Point): number => dot(p, p);

/**
 * Fit a single-segment Bezier curve to a set of digitized points.
 * `bezier` is filled with 4 points.
 *
 * @returns Number of segments generated, or -1 on error.
 */
export function bezier_fit_cubic(
  bezier: Point[],
  data: readonly Point[],
  len: number,
  error: number,
): number {
  return bezier_fit_cubic_r(bezier, data, len, error, 1);
}

/**
 * Fit a multi-segment Bezier curve to a set of digitized points, with
 * possible weedout of identical points and NaNs.
 *
 * @param bezier Result array, must have room for maxBeziers * 4 elements.
 * @returns Number of segments generated, or -1 on error.
 */
export function bezier_fit_cubic_r(
  bezier: Point[],
  data: readonly Point[],
  len: number,
  error: number,
  maxBeziers: number,
): number {
  if (len <= 0 || maxBeziers >= 2 ** (31 - 2 - 1 - 3)) return -1;

  const uniqued_data = copy_without_nans_or_adjacent_duplicates(data, len);
  if (uniqued_data.length < 2) return 0;

  // Call fit-cubic function with recursion.
  return bezier_fit_cubic_full(
    bezier,
    null,
    uniqued_data,
    uniqued_data.length,
    unconstrained_tangent,
    unconstrained_tangent,
    error,
    maxBeziers,
  );
}

/** Copy points, filter out points containing NaN and adjacent points with equal x and y. */
function copy_without_nans_or_adjacent_duplicates(src: readonly Point[], srcLen: number): Point[] {
  let si = 0;
  const dest: Point[] = [];
  for (;;) {
    if (si === srcLen) return [];
    const p = src[si] as Point;
    if (!Number.isNaN(p.x) && !Number.isNaN(p.y)) {
      dest.push(p);
      ++si;
      break;
    }
    si++;
  }
  for (; si < srcLen; ++si) {
    const srcPt = src[si] as Point;
    if (!srcPt.equals(dest[dest.length - 1] as Point) && !Number.isNaN(srcPt.x) && !Number.isNaN(srcPt.y)) {
      dest.push(srcPt);
    }
  }
  return dest;
}

/**
 * Fit a multi-segment Bezier curve to a set of digitized points, without
 * possible weedout of identical points and NaNs.
 *
 * Precondition: data is uniqued, i.e. no i with data[i] equal to data[i + 1].
 *
 * @param bezier Result array (filled in place), must have room for maxBeziers * 4 elements.
 * @param splitPoints Optional output array of split point indices (maxBeziers - 1 elements), or null.
 * @param maxBeziers Maximum number of generated segments.
 * @returns Number of segments generated, or -1 on error.
 */
export function bezier_fit_cubic_full(
  bezier: Point[],
  splitPoints: number[] | null,
  data: readonly Point[],
  len: number,
  tHat1: Point,
  tHat2: Point,
  error: number,
  maxBeziers: number,
): number {
  return fit_cubic_full(bezier, 0, splitPoints, 0, data, len, tHat1, tHat2, error, maxBeziers);
}

/** Implementation of bezier_fit_cubic_full; `bo` and `so` are offsets into bezier and splitPoints. */
function fit_cubic_full(
  bezier: Point[],
  bo: number,
  splitPoints: number[] | null,
  so: number,
  data: readonly Point[],
  len: number,
  tHat1: Point,
  tHat2: Point,
  error: number,
  maxBeziers: number,
): number {
  if (!(len > 0) || !(maxBeziers >= 1) || !(error >= 0.0)) return -1;

  if (len < 2) return 0;

  if (len === 2) {
    // We have 2 points, which can be fitted trivially.
    const p0 = data[0] as Point;
    const p3 = data[len - 1] as Point;
    bezier[bo] = p0;
    bezier[bo + 3] = p3;
    const dist = distance(p0, p3) / 3.0;
    if (Number.isNaN(dist)) {
      // Numerical problem, fall back to straight line segment.
      bezier[bo + 1] = p0;
      bezier[bo + 2] = p3;
    } else {
      bezier[bo + 1] = tHat1.isZero() ? p0.mul(2).add(p3).div(3) : p0.add(tHat1.mul(dist));
      bezier[bo + 2] = tHat2.isZero() ? p0.add(p3.mul(2)).div(3) : p3.add(tHat2.mul(dist));
    }
    return 1;
  }

  // Parameterize points, and attempt to fit curve.
  let splitPoint = 0; // Point to split point set at.
  let is_corner: boolean;
  {
    const u = new Array<number>(len).fill(0);
    chord_length_parameterize(data, u, len);
    if (u[len - 1] === 0.0) {
      // Zero-length path: every point in data[] is the same.
      return 0;
    }

    const b: Point[] = [
      unconstrained_tangent,
      unconstrained_tangent,
      unconstrained_tangent,
      unconstrained_tangent,
    ];
    const store = (): void => {
      for (let i = 0; i < 4; i++) bezier[bo + i] = b[i] as Point;
    };

    generate_bezier(b, data, u, len, tHat1, tHat2, error);
    reparameterize(data, len, u, b);

    // Find max deviation of points to fitted curve.
    const tolerance = Math.sqrt(error + 1e-9);
    let r = compute_max_error_ratio(data, u, len, b, tolerance);
    splitPoint = r.splitPoint;
    let maxErrorRatio = r.ratio;

    if (Math.abs(maxErrorRatio) <= 1.0) {
      store();
      return 1;
    }

    // If error not too large, then try some reparameterization and iteration.
    if (0.0 <= maxErrorRatio && maxErrorRatio <= 3.0) {
      const maxIterations = 4; // max times to try iterating
      for (let i = 0; i < maxIterations; i++) {
        generate_bezier(b, data, u, len, tHat1, tHat2, error);
        reparameterize(data, len, u, b);
        r = compute_max_error_ratio(data, u, len, b, tolerance);
        splitPoint = r.splitPoint;
        maxErrorRatio = r.ratio;
        if (Math.abs(maxErrorRatio) <= 1.0) {
          store();
          return 1;
        }
      }
    }
    store();
    is_corner = maxErrorRatio < 0;
  }

  if (is_corner) {
    if (splitPoint === 0) {
      if (tHat1.isZero()) {
        // Got spike even with unconstrained initial tangent.
        ++splitPoint;
      } else {
        return fit_cubic_full(
          bezier,
          bo,
          splitPoints,
          so,
          data,
          len,
          unconstrained_tangent,
          tHat2,
          error,
          maxBeziers,
        );
      }
    } else if (splitPoint === len - 1) {
      if (tHat2.isZero()) {
        // Got spike even with unconstrained final tangent.
        --splitPoint;
      } else {
        return fit_cubic_full(
          bezier,
          bo,
          splitPoints,
          so,
          data,
          len,
          tHat1,
          unconstrained_tangent,
          error,
          maxBeziers,
        );
      }
    }
  }

  if (1 < maxBeziers) {
    // Fitting failed -- split at max error point and fit recursively.
    const recMaxBeziers1 = maxBeziers - 1;

    let recTHat2: Point;
    let recTHat1: Point;
    if (is_corner) {
      if (!(0 < splitPoint && splitPoint < len - 1)) return -1;
      recTHat1 = recTHat2 = unconstrained_tangent;
    } else {
      // Unit tangent vector at splitPoint.
      recTHat2 = darray_center_tangent(data, splitPoint, len);
      recTHat1 = recTHat2.neg();
    }
    const nsegs1 = fit_cubic_full(
      bezier,
      bo,
      splitPoints,
      so,
      data,
      splitPoint + 1,
      tHat1,
      recTHat2,
      error,
      recMaxBeziers1,
    );
    if (nsegs1 < 0) return -1;
    if (splitPoints !== null) {
      splitPoints[so + nsegs1 - 1] = splitPoint;
    }
    const recMaxBeziers2 = maxBeziers - nsegs1;
    const nsegs2 = fit_cubic_full(
      bezier,
      bo + nsegs1 * 4,
      splitPoints,
      so + nsegs1,
      data.slice(splitPoint),
      len - splitPoint,
      recTHat1,
      tHat2,
      error,
      recMaxBeziers2,
    );
    if (nsegs2 < 0) return -1;
    return nsegs1 + nsegs2;
  }
  return -1;
}

/**
 * Fill in `bezier` (4 points) based on the given data and tangent requirements, using
 * a least-squares fit.
 *
 * Each of tHat1 and tHat2 should be either a zero vector or a unit vector.
 * If it is zero, then bezier[1 or 2] is estimated without constraint; otherwise,
 * bezier[1 or 2] is placed in the specified direction from bezier[0 or 3].
 *
 * @param tolerance_sq Used only for an initial guess as to tangent directions
 *   when tHat1 or tHat2 is zero.
 */
function generate_bezier(
  bezier: Point[],
  data: readonly Point[],
  u: readonly number[],
  len: number,
  tHat1: Point,
  tHat2: Point,
  tolerance_sq: number,
): void {
  const est1 = tHat1.isZero();
  const est2 = tHat2.isZero();
  let est_tHat1 = est1 ? darray_left_tangent(data, len, tolerance_sq) : tHat1;
  const est_tHat2 = est2 ? darray_right_tangent(data, len, tolerance_sq) : tHat2;
  estimate_lengths(bezier, data, u, len, est_tHat1, est_tHat2);
  // We find that darray_right_tangent tends to produce better results
  // for our current freehand tool than full estimation.
  if (est1) {
    estimate_bi(bezier, 1, data, u, len);
    if (!(bezier[1] as Point).equals(bezier[0] as Point)) {
      est_tHat1 = unit_vector((bezier[1] as Point).sub(bezier[0] as Point));
    }
    estimate_lengths(bezier, data, u, len, est_tHat1, est_tHat2);
  }
}

function estimate_lengths(
  bezier: Point[],
  data: readonly Point[],
  uPrime: readonly number[],
  len: number,
  tHat1: Point,
  tHat2: Point,
): void {
  // Matrices C and X.
  let C00 = 0.0;
  let C01 = 0.0;
  let C11 = 0.0;
  let X0 = 0.0;
  let X1 = 0.0;

  // First and last control points of the Bezier curve are positioned exactly at the first and
  // last data points.
  const p0 = data[0] as Point;
  const p3 = data[len - 1] as Point;
  bezier[0] = p0;
  bezier[3] = p3;

  for (let i = 0; i < len; i++) {
    const ui = uPrime[i] as number;
    // Bezier control point coefficients.
    const b0 = B0(ui);
    const b1 = B1(ui);
    const b2 = B2(ui);
    const b3 = B3(ui);

    // rhs for eqn
    const a1 = tHat1.mul(b1);
    const a2 = tHat2.mul(b2);

    C00 += dot(a1, a1);
    C01 += dot(a1, a2);
    C11 += dot(a2, a2);

    // Additional offset to the data point from the predicted point if we were to set bezier[1]
    // to bezier[0] and bezier[2] to bezier[3].
    const shortfall = (data[i] as Point).sub(p0.mul(b0 + b1)).sub(p3.mul(b2 + b3));
    X0 += dot(a1, shortfall);
    X1 += dot(a2, shortfall);
  }
  const C10 = C01;

  // We've constructed a pair of equations in the form of a matrix product C * alpha = X.
  // Now solve for alpha.
  let alpha_l: number;
  let alpha_r: number;

  // Compute the determinants of C and X.
  const det_C0_C1 = C00 * C11 - C10 * C01;
  if (det_C0_C1 !== 0) {
    // Apparently Kramer's rule.
    const det_C0_X = C00 * X1 - C01 * X0;
    const det_X_C1 = X0 * C11 - X1 * C01;
    alpha_l = det_X_C1 / det_C0_C1;
    alpha_r = det_C0_X / det_C0_C1;
  } else {
    // The matrix is under-determined. Try requiring alpha_l == alpha_r, trying each row in turn.
    const c0 = C00 + C01;
    if (c0 !== 0) {
      alpha_l = alpha_r = X0 / c0;
    } else {
      const c1 = C10 + C11;
      if (c1 !== 0) {
        alpha_l = alpha_r = X1 / c1;
      } else {
        alpha_l = alpha_r = 0;
      }
    }
  }

  // If alpha negative, use the Wu/Barsky heuristic (see text). (If alpha is 0, you get
  // coincident control points that lead to divide by zero in any subsequent
  // NewtonRaphsonRootFind() call.)
  if (alpha_l < 1.0e-6 || alpha_r < 1.0e-6) {
    alpha_l = alpha_r = distance(p0, p3) / 3.0;
  }

  // Control points 1 and 2 are positioned an alpha distance out on the tangent vectors, left and
  // right, respectively.
  bezier[1] = tHat1.mul(alpha_l).add(p0);
  bezier[2] = tHat2.mul(alpha_r).add(p3);
}

function estimate_bi(
  bezier: Point[],
  ei: number,
  data: readonly Point[],
  u: readonly number[],
  len: number,
): void {
  if (!(1 <= ei && ei <= 2)) return;
  const oi = 3 - ei;
  let numX = 0;
  let numY = 0;
  let den = 0;
  const b0p = bezier[0] as Point;
  const bop = bezier[oi] as Point;
  const b3p = bezier[3] as Point;
  for (let i = 0; i < len; ++i) {
    const ui = u[i] as number;
    const b = [B0(ui), B1(ui), B2(ui), B3(ui)];
    const be = b[ei] as number;
    const bo = b[oi] as number;
    const di = data[i] as Point;
    numX += be * (B0(ui) * b0p.x + bo * bop.x + B3(ui) * b3p.x + -di.x);
    numY += be * (B0(ui) * b0p.y + bo * bop.y + B3(ui) * b3p.y + -di.y);
    den -= be * be;
  }

  if (den !== 0) {
    bezier[ei] = new Point(numX / den, numY / den);
  } else {
    bezier[ei] = b0p.mul(oi).add(b3p.mul(ei)).div(3);
  }
}

/**
 * Given set of points and their parameterization, try to find a better assignment of parameter
 * values for the points. Updates `u` in place.
 *
 * @param d Array of digitized points.
 * @param u Current parameter values.
 * @param bezCurve Current fitted curve.
 * @param len Number of values in both d and u arrays.
 */
function reparameterize(d: readonly Point[], len: number, u: number[], bezCurve: readonly Point[]): void {
  const last = len - 1;
  for (let i = 1; i < last; i++) {
    u[i] = NewtonRaphsonRootFind(bezCurve, d[i] as Point, u[i] as number);
  }
}

/**
 * Use Newton-Raphson iteration to find better root.
 *
 * @param Q Current fitted curve
 * @param P Digitized point
 * @param u Parameter value for "P"
 * @returns Improved u
 */
function NewtonRaphsonRootFind(Q: readonly Point[], P: Point, u: number): number {
  // Generate control vertices for Q'.
  const Q1: Point[] = [];
  for (let i = 0; i < 3; i++) {
    Q1[i] = (Q[i + 1] as Point).sub(Q[i] as Point).mul(3.0);
  }

  // Generate control vertices for Q''.
  const Q2: Point[] = [];
  for (let i = 0; i < 2; i++) {
    Q2[i] = (Q1[i + 1] as Point).sub(Q1[i] as Point).mul(2.0);
  }

  // Compute Q(u), Q'(u) and Q''(u).
  const Q_u = bezier_pt(3, Q, u);
  const Q1_u = bezier_pt(2, Q1, u);
  const Q2_u = bezier_pt(1, Q2, u);

  // Compute f(u)/f'(u), where f is the derivative wrt u of distsq(u) = 0.5 * the square of the
  // distance from P to Q(u). Here we're using Newton-Raphson to find a stationary point in the
  // distsq(u), hopefully corresponding to a local minimum in distsq.
  const diff = Q_u.sub(P);
  const numerator = dot(diff, Q1_u);
  const denominator = dot(Q1_u, Q1_u) + dot(diff, Q2_u);

  let improved_u: number;
  if (denominator > 0) {
    // One iteration of Newton-Raphson: improved_u = u - f(u)/f'(u)
    improved_u = u - numerator / denominator;
  } else if (numerator > 0) {
    // Newton-Raphson would move towards a local maximum, so move an arbitrary amount in the
    // right direction.
    improved_u = u * 0.98 - 0.01;
  } else if (numerator < 0) {
    // Deliberately asymmetrical, to reduce the chance of cycling.
    improved_u = 0.031 + u * 0.98;
  } else {
    improved_u = u;
  }

  if (!Number.isFinite(improved_u)) {
    improved_u = u;
  } else if (improved_u < 0.0) {
    improved_u = 0.0;
  } else if (improved_u > 1.0) {
    improved_u = 1.0;
  }

  // Ensure that improved_u isn't actually worse.
  const diff_lensq = lensq(diff);
  for (let proportion = 0.125; ; proportion += 0.125) {
    if (lensq(bezier_pt(3, Q, improved_u).sub(P)) > diff_lensq) {
      if (proportion > 1.0) {
        improved_u = u;
        break;
      }
      improved_u = (1 - proportion) * improved_u + proportion * u;
    } else {
      break;
    }
  }

  return improved_u;
}

/** Pascal's triangle. */
const pascal: readonly (readonly number[])[] = [
  [1, 0, 0, 0],
  [1, 1, 0, 0],
  [1, 2, 1, 0],
  [1, 3, 3, 1],
];

/**
 * Evaluate a Bezier curve at parameter value `t`.
 *
 * @param degree The degree of the Bezier curve: 3 for cubic, 2 for quadratic etc. Must be less than 4.
 * @param V The control points for the Bezier curve. Must have (degree + 1) elements.
 * @param t The "parameter" value, typically in the range [0.0, 1.0].
 */
export function bezier_pt(degree: number, V: readonly Point[], t: number): Point {
  const s = 1.0 - t;

  // Calculate powers of t and s.
  const spow = [1.0, s, 0, 0];
  const tpow = [1.0, t, 0, 0];
  for (let i = 1; i < degree; ++i) {
    spow[i + 1] = (spow[i] as number) * s;
    tpow[i + 1] = (tpow[i] as number) * t;
  }

  const row = pascal[degree] as readonly number[];
  let ret = (V[0] as Point).mul(spow[degree] as number);
  for (let i = 1; i <= degree; ++i) {
    ret = ret.add(
      (V[i] as Point).mul((row[i] as number) * (spow[degree - i] as number) * (tpow[i] as number)),
    );
  }
  return ret;
}

/*
 * ComputeLeftTangent, ComputeRightTangent, ComputeCenterTangent :
 * Approximate unit tangents at endpoints and "center" of digitized curve
 */

/**
 * Estimate the (forward) tangent at point d[0].
 *
 * Without `tolerance_sq`, estimates the tangent at d[0.5]: unit_vector(d[1] - d[0]).
 * With it, uses the first point farther than sqrt(tolerance_sq) from d[0].
 * Unlike the center and right versions, this calculates the tangent wrt increasing index.
 *
 * Precondition: 2 <= len and d[0] != d[1].
 */
export function darray_left_tangent(d: readonly Point[], len: number, tolerance_sq?: number): Point {
  if (tolerance_sq === undefined) {
    return unit_vector((d[1] as Point).sub(d[0] as Point));
  }
  for (let i = 1; ; ) {
    const t = (d[i] as Point).sub(d[0] as Point);
    const distsq = dot(t, t);
    if (tolerance_sq < distsq) {
      return unit_vector(t);
    }
    ++i;
    if (i === len) {
      return distsq === 0 ? darray_left_tangent(d, len) : unit_vector(t);
    }
  }
}

/**
 * Estimate the (backward) tangent at d[len - 1].
 *
 * The tangent is "backwards", i.e. it is with respect to decreasing index.
 * Without `tolerance_sq`, estimates the tangent at d[last - 0.5].
 *
 * Precondition: 2 <= len and d[len - 1] != d[len - 2].
 */
export function darray_right_tangent(d: readonly Point[], len: number, tolerance_sq?: number): Point {
  const last = len - 1;
  if (tolerance_sq === undefined) {
    return unit_vector((d[last - 1] as Point).sub(d[last] as Point));
  }
  for (let i = last - 1; ; i--) {
    const t = (d[i] as Point).sub(d[last] as Point);
    const distsq = dot(t, t);
    if (tolerance_sq < distsq) {
      return unit_vector(t);
    }
    if (i === 0) {
      return distsq === 0 ? darray_right_tangent(d, len) : unit_vector(t);
    }
  }
}

/**
 * Estimate the (backward) tangent at d[center], by averaging the two
 * segments connected to d[center] (and then normalizing the result).
 *
 * Precondition: 0 < center < len - 1 and d is uniqued near center.
 */
function darray_center_tangent(d: readonly Point[], center: number, _len: number): Point {
  const prev = d[center - 1] as Point;
  const next = d[center + 1] as Point;
  let ret: Point;
  if (next.equals(prev)) {
    // Rotate 90 degrees in an arbitrary direction.
    ret = rot90((d[center] as Point).sub(prev));
  } else {
    ret = prev.sub(next);
  }
  return ret.normalized();
}

/**
 * Assign parameter values to digitized points using relative distances between points.
 * `u` must have room for `len` items.
 */
function chord_length_parameterize(d: readonly Point[], u: number[], len: number): void {
  if (!(2 <= len)) return;

  // First let u[i] equal the distance travelled along the path from d[0] to d[i].
  u[0] = 0.0;
  for (let i = 1; i < len; i++) {
    const dist = distance(d[i] as Point, d[i - 1] as Point);
    u[i] = (u[i - 1] as number) + dist;
  }

  // Then scale to [0.0 .. 1.0].
  const tot_len = u[len - 1] as number;
  if (!(tot_len !== 0)) return;
  if (Number.isFinite(tot_len)) {
    for (let i = 1; i < len; ++i) {
      u[i] = (u[i] as number) / tot_len;
    }
  } else {
    for (let i = 1; i < len; ++i) {
      u[i] = i / (len - 1);
    }
  }

  u[len - 1] = 1;
}

/**
 * Find the maximum squared distance of digitized points to fitted curve, and (if this maximum
 * error is non-zero) the corresponding index (splitPoint).
 *
 * Precondition: 2 <= len, u[0] == 0, u[len - 1] == 1.0.
 */
function compute_max_error_ratio(
  d: readonly Point[],
  u: readonly number[],
  len: number,
  bezCurve: readonly Point[],
  tolerance: number,
): { ratio: number; splitPoint: number } {
  const last = len - 1;

  let maxDistsq = 0.0; // Maximum error
  let max_hook_ratio = 0.0;
  let snap_end = 0;
  let splitPoint = 0;
  let prev = bezCurve[0] as Point;
  for (let i = 1; i <= last; i++) {
    const curr = bezier_pt(3, bezCurve, u[i] as number);
    const distsq = lensq(curr.sub(d[i] as Point));
    if (distsq > maxDistsq) {
      maxDistsq = distsq;
      splitPoint = i;
    }
    const hook_ratio = compute_hook(
      prev,
      curr,
      0.5 * ((u[i - 1] as number) + (u[i] as number)),
      bezCurve,
      tolerance,
    );
    if (max_hook_ratio < hook_ratio) {
      max_hook_ratio = hook_ratio;
      snap_end = i;
    }
    prev = curr;
  }

  const dist_ratio = Math.sqrt(maxDistsq) / tolerance;
  if (max_hook_ratio <= dist_ratio) {
    return { ratio: dist_ratio, splitPoint };
  }
  return { ratio: -max_hook_ratio, splitPoint: snap_end - 1 };
}

/**
 * Whereas compute_max_error_ratio() checks for itself that each data point
 * is near some point on the curve, this function checks that each point on
 * the curve is near some data point (or near some point on the polyline
 * defined by the data points, allowing for "reasonable curviness").
 * Only the curve point halfway between the estimated parameters of a and b is tested.
 * Returns 0 if within tolerance, else a metric that increases with the distance
 * from that point to the allowed circle.
 */
function compute_hook(a: Point, b: Point, u: number, bezCurve: readonly Point[], tolerance: number): number {
  const P = bezier_pt(3, bezCurve, u);
  const dist = distance(a.add(b).mul(0.5), P);
  if (dist < tolerance) {
    return 0;
  }
  const allowed = distance(a, b) + tolerance;
  return dist / allowed;
}
