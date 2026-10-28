// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path/splinefit/bezier-fit.cpp, src/path/splinefit/bezier-fit.h
import { bezier_fit_cubic, bezier_fit_cubic_full, type Point } from '@inkscape-web/geom';

/** A point to fit, with the time on its segment and optionally the slope (handles) at the point. */
export interface InputPoint {
  pt: Point;
  t: number;
  /** Handle positions: front (outgoing) and back (incoming). Set for the first and last point. */
  front?: Point;
  back?: Point;
}

/**
 * Fit one cubic Bezier curve to the input points; the curve keeps the end
 * points and the slopes of the first and last points. Returns the four
 * control points, or null if no fit was found.
 * Upstream fits with ApproximateSplineFromPointsSlopes (FontForge splinefit,
 * Levien's method) and falls back to bezier_fit_cubic. Here the fit is
 * Schneider's least squares fit with the end tangents fixed (bezier-utils),
 * with the same fallback.
 * TODO: port src/path/splinefit/splinefit.c.
 */
export function bezier_fit(data: readonly InputPoint[]): [Point, Point, Point, Point] | null {
  if (data.length <= 2) return null;
  const first = data[0] as InputPoint;
  const last = data[data.length - 1] as InputPoint;
  const pts = data.map((d) => d.pt);
  const bezier: Point[] = [];

  const tHat1 = first.front ? first.front.sub(first.pt).normalized() : null;
  const tHat2 = last.back ? last.back.sub(last.pt).normalized() : null;
  let ok = false;
  if (tHat1 && tHat2 && !tHat1.isZero() && !tHat2.isZero()) {
    ok = bezier_fit_cubic_full(bezier, null, pts, pts.length, tHat1, tHat2, Number.MAX_VALUE, 1) > 0;
    // When handles are near parallel, solutions may be unstable and give too long handles.
    if (ok) {
      const [b0, b1, b2, b3] = bezier as [Point, Point, Point, Point];
      const a = b0.sub(b3).length();
      if (b0.sub(b1).length() > a || b2.sub(b3).length() > a) ok = false;
    }
  }
  if (!ok) ok = bezier_fit_cubic(bezier, pts, pts.length, 0.5) > 0;
  return ok ? (bezier.slice(0, 4) as [Point, Point, Point, Point]) : null;
}
