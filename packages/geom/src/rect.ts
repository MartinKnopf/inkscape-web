// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/rect.h, src/3rdparty/2geom/include/2geom/generic-rect.h, src/3rdparty/2geom/src/2geom/rect.cpp
/*
 * Authors:
 *   Michael Sloan <mgsloan@gmail.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 * Copyright 2007-2011 Authors
 *
 * Authors of original rect class:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Nathan Hurst <njh@mail.csse.monash.edu.au>
 *   bulia byak <buliabyak@users.sf.net>
 *   MenTaLguY <mental@rydia.net>
 */
import type { Affine } from './affine.ts';
import { type Coord, type Dim2, EPSILON, X } from './coord.ts';
import { Interval } from './interval.ts';
import { Point } from './point.ts';

/** Axis-aligned rectangle. Immutable; Y grows downwards, so top() is the smaller Y. */
export class Rect {
  /** Range in X. */
  readonly xInterval: Interval;
  /** Range in Y. */
  readonly yInterval: Interval;

  constructor(x: Interval, y: Interval);
  constructor(a: Point, b: Point);
  constructor(x0: Coord, y0: Coord, x1: Coord, y1: Coord);
  constructor(a: Interval | Point | Coord = 0, b: Interval | Point | Coord = 0, c?: Coord, d?: Coord) {
    if (a instanceof Interval && b instanceof Interval) {
      this.xInterval = a;
      this.yInterval = b;
    } else if (a instanceof Point && b instanceof Point) {
      this.xInterval = new Interval(a.x, b.x);
      this.yInterval = new Interval(a.y, b.y);
    } else {
      this.xInterval = new Interval(a as Coord, c ?? 0);
      this.yInterval = new Interval(b as Coord, d ?? 0);
    }
  }

  /** Smallest rectangle that contains all points. */
  static fromPoints(points: readonly Point[]): Rect {
    const [first, ...rest] = points;
    if (!first) throw new RangeError('Rect.fromPoints: no points');
    return rest.reduce((r, p) => r.expandTo(p), new Rect(first, first));
  }

  static fromXywh(x: Coord, y: Coord, w: Coord, h: Coord): Rect {
    return new Rect(new Point(x, y), new Point(x + w, y + h));
  }

  /** Interval of the given dimension (upstream `r[d]`). */
  at(d: Dim2): Interval {
    return d === X ? this.xInterval : this.yInterval;
  }

  min(): Point {
    return new Point(this.xInterval.min(), this.yInterval.min());
  }

  max(): Point {
    return new Point(this.xInterval.max(), this.yInterval.max());
  }

  /** Corner i modulo 4, clockwise on screen from the top left: (min,min), (max,min), (max,max), (min,max). */
  corner(i: number): Point {
    switch (((i % 4) + 4) % 4) {
      case 0:
        return new Point(this.xInterval.min(), this.yInterval.min());
      case 1:
        return new Point(this.xInterval.max(), this.yInterval.min());
      case 2:
        return new Point(this.xInterval.max(), this.yInterval.max());
      default:
        return new Point(this.xInterval.min(), this.yInterval.max());
    }
  }

  corners(): [Point, Point, Point, Point] {
    return [this.corner(0), this.corner(1), this.corner(2), this.corner(3)];
  }

  top(): Coord {
    return this.yInterval.min();
  }

  bottom(): Coord {
    return this.yInterval.max();
  }

  left(): Coord {
    return this.xInterval.min();
  }

  right(): Coord {
    return this.xInterval.max();
  }

  width(): Coord {
    return this.xInterval.extent();
  }

  height(): Coord {
    return this.yInterval.extent();
  }

  aspectRatio(): Coord {
    return this.width() / this.height();
  }

  dimensions(): Point {
    return new Point(this.width(), this.height());
  }

  midpoint(): Point {
    return new Point(this.xInterval.middle(), this.yInterval.middle());
  }

  area(): Coord {
    return this.width() * this.height();
  }

  hasZeroArea(eps: number = EPSILON): boolean {
    return this.area() <= eps;
  }

  isFinite(): boolean {
    return this.xInterval.isFinite() && this.yInterval.isFinite();
  }

  maxExtent(): Coord {
    return Math.max(this.width(), this.height());
  }

  minExtent(): Coord {
    return Math.min(this.width(), this.height());
  }

  /** Distance between the two opposite corners. */
  diameter(): Coord {
    return this.corner(0).sub(this.corner(2)).length();
  }

  /** The point of the rectangle nearest to p. */
  clamp(p: Point): Point {
    return new Point(this.xInterval.clamp(p.x), this.yInterval.clamp(p.y));
  }

  distanceSq(p: Point): Coord {
    return p.sub(this.clamp(p)).lengthSq();
  }

  contains(v: Rect | Point | null): boolean {
    if (v === null) return true;
    if (v instanceof Point) return this.xInterval.contains(v.x) && this.yInterval.contains(v.y);
    return this.xInterval.contains(v.xInterval) && this.yInterval.contains(v.yInterval);
  }

  interiorContains(v: Rect | Point | null): boolean {
    if (v === null) return true;
    if (v instanceof Point)
      return this.xInterval.interiorContains(v.x) && this.yInterval.interiorContains(v.y);
    return this.xInterval.interiorContains(v.xInterval) && this.yInterval.interiorContains(v.yInterval);
  }

  intersects(r: Rect | null): boolean {
    return r !== null && this.xInterval.intersects(r.xInterval) && this.yInterval.intersects(r.yInterval);
  }

  interiorIntersects(r: Rect): boolean {
    return this.xInterval.interiorIntersects(r.xInterval) && this.yInterval.interiorIntersects(r.yInterval);
  }

  /** Smallest rectangle that contains this one and p. */
  expandTo(p: Point): Rect {
    return new Rect(this.xInterval.expandTo(p.x), this.yInterval.expandTo(p.y));
  }

  /** Smallest rectangle that contains both. A null argument is ignored. */
  unionWith(b: Rect | null): Rect {
    return b ? new Rect(this.xInterval.unionWith(b.xInterval), this.yInterval.unionWith(b.yInterval)) : this;
  }

  /** The overlap, or null when the rectangles are disjoint. */
  intersect(b: Rect | null): Rect | null {
    if (!b) return null;
    const x = this.xInterval.intersect(b.xInterval);
    const y = this.yInterval.intersect(b.yInterval);
    return x && y ? new Rect(x, y) : null;
  }

  /** Grow by `x` left and right and `y` (default: same as x) top and bottom. Negative values shrink. */
  expandBy(x: Coord, y: Coord = x): Rect {
    return new Rect(this.xInterval.expandBy(x), this.yInterval.expandBy(y));
  }

  shrinkBy(x: Coord, y: Coord = x): Rect {
    return this.expandBy(-x, -y);
  }

  /** Shift by a vector. */
  offset(p: Point): Rect {
    return new Rect(this.xInterval.offset(p.x), this.yInterval.offset(p.y));
  }

  /** Bounding box of the rectangle after the transform (of its four corners). */
  transformed(m: Affine): Rect {
    const [p0, p1, p2, p3] = this.corners().map((c) => c.transformed(m)) as [Point, Point, Point, Point];
    return new Rect(
      new Interval(Math.min(p0.x, p1.x, p2.x, p3.x), Math.max(p0.x, p1.x, p2.x, p3.x)),
      new Interval(Math.min(p0.y, p1.y, p2.y, p3.y), Math.max(p0.y, p1.y, p2.y, p3.y)),
    );
  }

  equals(o: Rect): boolean {
    return this.xInterval.equals(o.xInterval) && this.yInterval.equals(o.yInterval);
  }
}

/** A rectangle or nothing. */
export type OptRect = Rect | null;

/** Union of two optional rectangles; null only if both are null. */
export function unify(a: OptRect, b: OptRect): OptRect {
  if (!a) return b;
  return a.unionWith(b);
}

/** Overlap of two optional rectangles. */
export function intersect(a: OptRect, b: OptRect): OptRect {
  return a ? a.intersect(b) : null;
}
