// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/circle.h, src/3rdparty/2geom/src/2geom/circle.cpp
/*
 * Authors:
 *   Marco Cecchetti <mrcekets at gmail.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2008-2014 Authors
 */
import type { Coord } from './coord.ts';
import { solveLeastSquares } from './least-squares.ts';
import { Point } from './point.ts';

/** A circle with a center and a radius. Immutable. */
export class Circle {
  constructor(
    readonly center: Point = new Point(),
    readonly radius: Coord = 0,
  ) {}

  /**
   * The circle A (x^2 + y^2) + B x + C y + D = 0. Throws a RangeError when A is 0 or the radius
   * would be imaginary.
   */
  static fromCoefficients(A: Coord, B: Coord, C: Coord, D: Coord): Circle {
    if (A === 0) throw new RangeError('square term coefficient == 0');
    const b = B / A;
    const c = C / A;
    const d = D / A;
    const center = new Point(-b / 2, -c / 2);
    const r2 = center.x * center.x + center.y * center.y - d;
    if (r2 < 0) throw new RangeError('ray^2 < 0');
    return new Circle(center, Math.sqrt(r2));
  }

  /**
   * The circle that fits the points best (upstream Circle::fit). Two points give the circle with
   * the segment between them as diameter. Throws a RangeError for less than two points.
   */
  static fit(points: readonly Point[]): Circle {
    if (points.length < 2) throw new RangeError('fitting error: too few points passed');
    const [p0, p1] = points as [Point, Point];
    if (points.length === 2) return new Circle(p0.mul(0.5).add(p1.mul(0.5)), p0.sub(p1).length() / 2);
    // LFMCircle: x^2 + y^2 + B x + C y + D = 0, so (x, y, 1) * (B, C, D) = -(x^2 + y^2).
    const rows = points.map((p) => [p.x, p.y, 1]);
    const rhs = points.map((p) => -(p.x * p.x + p.y * p.y));
    const [B, C, D] = solveLeastSquares(rows, rhs) as [number, number, number];
    return Circle.fromCoefficients(1, B, C, D);
  }
}
