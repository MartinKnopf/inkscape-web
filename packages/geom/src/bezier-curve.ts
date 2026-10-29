// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/bezier-curve.h, src/3rdparty/2geom/src/2geom/bezier-curve.cpp
/*
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *   Marco Cecchetti <mrcekets at gmail.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2007-2011 Authors
 */
import type { Affine } from './affine.ts';
import { bernstein_value_at, bounds_exact, bounds_fast, portion } from './bezier.ts';
import type { Coord } from './coord.ts';
import type { Curve } from './curve.ts';
import type { PathSink } from './path-sink.ts';
import { Point } from './point.ts';
import { Rect } from './rect.ts';

/** Bezier curve of order 1 to 3, defined by its control points. Immutable. */
export abstract class BezierCurve implements Curve {
  readonly #points: readonly Point[];

  protected constructor(points: readonly Point[]) {
    this.#points = points;
  }

  /** Same kind of curve with other control points. */
  protected abstract make(points: readonly Point[]): BezierCurve;

  /** Order of the curve: 1 for a line, 2 for quadratic, 3 for cubic. */
  order(): number {
    return this.#points.length - 1;
  }

  controlPoint(i: number): Point {
    return this.#points[i] as Point;
  }

  controlPoints(): readonly Point[] {
    return this.#points;
  }

  initialPoint(): Point {
    return this.#points[0] as Point;
  }

  finalPoint(): Point {
    return this.#points[this.#points.length - 1] as Point;
  }

  isDegenerate(): boolean {
    const [first, ...rest] = this.#points as [Point, ...Point[]];
    return rest.every((p) => p.x === first.x && p.y === first.y);
  }

  /** False if there are at least 3 distinct control points. */
  isLineSegment(): boolean {
    const start = this.initialPoint();
    const end = this.finalPoint();
    return this.#points.slice(1, -1).every((p) => p.equals(start) || p.equals(end));
  }

  pointAt(t: Coord): Point {
    return new Point(
      bernstein_value_at(
        t,
        this.#points.map((p) => p.x),
      ),
      bernstein_value_at(
        t,
        this.#points.map((p) => p.y),
      ),
    );
  }

  /** Arc length within tolerance (upstream BezierCurve::length with bezier_length). */
  length(tolerance = 0.01): Coord {
    if (this.#points.length === 2) return (this.#points[0] as Point).sub(this.#points[1] as Point).length();
    return bezier_length_internal([...this.#points], tolerance, 0);
  }

  /** The two halves split at time t (upstream subdivide()). */
  subdivide(t: Coord): [BezierCurve, BezierCurve] {
    return [this.portion(0, t), this.portion(t, 1)];
  }

  /** Bounding box of the control points. */
  boundsFast(): Rect {
    return new Rect(bounds_fast(this.#points.map((p) => p.x)), bounds_fast(this.#points.map((p) => p.y)));
  }

  /** Bounding box from the end points and the extrema of the curve (roots of the derivative). */
  boundsExact(): Rect {
    return new Rect(bounds_exact(this.#points.map((p) => p.x)), bounds_exact(this.#points.map((p) => p.y)));
  }

  transformed(m: Affine): BezierCurve {
    return this.make(this.#points.map((p) => p.transformed(m)));
  }

  reverse(): BezierCurve {
    return this.make([...this.#points].reverse());
  }

  portion(from: Coord, to: Coord): BezierCurve {
    const xs = portion(
      this.#points.map((p) => p.x),
      from,
      to,
    );
    const ys = portion(
      this.#points.map((p) => p.y),
      from,
      to,
    );
    return this.make(xs.map((x, i) => new Point(x, ys[i] as number)));
  }

  withFinal(p: Point): BezierCurve {
    return this.make([...this.#points.slice(0, -1), p]);
  }

  equals(other: Curve): boolean {
    if (!(other instanceof BezierCurve) || other.order() !== this.order()) return false;
    return this.#points.every((p, i) => p.equals(other.controlPoint(i)));
  }

  feed(sink: PathSink, moveToInitial: boolean): void {
    if (moveToInitial) sink.moveTo(this.initialPoint());
    this.feedSegment(sink);
  }

  /** Send the curve without its initial point to the sink. */
  protected abstract feedSegment(sink: PathSink): void;
}

/*
 * The Bezier length algorithm used in 2Geom utilizes a simple fact:
 * the Bezier curve is longer than the distance between its endpoints
 * but shorter than the length of the polyline formed by its control
 * points. When the difference between the two values is smaller than the
 * error tolerance, we can be sure that the true value is no further than
 * 0.5 * tolerance from their arithmetic mean. When it's larger, we recursively
 * subdivide the Bezier curve into two parts and add their lengths.
 *
 * We cap the maximum number of subdivisions at 256, which corresponds to 8 levels.
 */
function bezier_length_internal(v1: Point[], tolerance: Coord, level: number): Coord {
  const lower = (v1[0] as Point).sub(v1[v1.length - 1] as Point).length();
  let upper = 0.0;
  for (let i = 0; i < v1.length - 1; ++i) upper += (v1[i] as Point).sub(v1[i + 1] as Point).length();
  if (upper - lower <= 2 * tolerance || level >= 8) return (lower + upper) / 2;
  const v2 = [...v1];
  for (let i = 1; i < v1.length; ++i) {
    for (let j = i; j > 0; --j) v1[j - 1] = (v1[j - 1] as Point).add(v1[j] as Point).mul(0.5);
    v2[i] = v1[0] as Point;
  }
  return (
    bezier_length_internal(v1, 0.5 * tolerance, level + 1) +
    bezier_length_internal(v2, 0.5 * tolerance, level + 1)
  );
}

/** Straight line segment (order 1). */
export class LineSegment extends BezierCurve {
  constructor(p0: Point, p1: Point) {
    super([p0, p1]);
  }

  protected make(points: readonly Point[]): LineSegment {
    return new LineSegment(points[0] as Point, points[1] as Point);
  }

  override isDegenerate(): boolean {
    const [a, b] = this.controlPoints() as [Point, Point];
    return a.x === b.x && a.y === b.y;
  }

  override isLineSegment(): boolean {
    return true;
  }

  override portion(from: Coord, to: Coord): LineSegment {
    return new LineSegment(this.pointAt(from), this.pointAt(to));
  }

  protected feedSegment(sink: PathSink): void {
    sink.lineTo(this.controlPoint(1));
  }
}

/** Quadratic Bezier curve (order 2). */
export class QuadraticBezier extends BezierCurve {
  constructor(p0: Point, p1: Point, p2: Point) {
    super([p0, p1, p2]);
  }

  protected make(points: readonly Point[]): QuadraticBezier {
    return new QuadraticBezier(points[0] as Point, points[1] as Point, points[2] as Point);
  }

  protected feedSegment(sink: PathSink): void {
    sink.quadTo(this.controlPoint(1), this.controlPoint(2));
  }
}

/** Cubic Bezier curve (order 3). */
export class CubicBezier extends BezierCurve {
  constructor(p0: Point, p1: Point, p2: Point, p3: Point) {
    super([p0, p1, p2, p3]);
  }

  protected make(points: readonly Point[]): CubicBezier {
    return new CubicBezier(points[0] as Point, points[1] as Point, points[2] as Point, points[3] as Point);
  }

  protected feedSegment(sink: PathSink): void {
    sink.curveTo(this.controlPoint(1), this.controlPoint(2), this.controlPoint(3));
  }
}
