// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/path.h, src/3rdparty/2geom/src/2geom/path.cpp
/*
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *   Marco Cecchetti <mrcekets at gmail.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2007-2014 Authors
 */
import type { Affine } from './affine.ts';
import { LineSegment } from './bezier-curve.ts';
import type { Coord } from './coord.ts';
import type { Curve } from './curve.ts';
import { EllipticalArc } from './elliptical-arc.ts';
import { Point } from './point.ts';
import { type OptRect, type Rect, unify } from './rect.ts';

/** Thrown when a curve does not start where the path ends. */
export class ContinuityError extends Error {
  constructor(message = 'Non-contiguous path') {
    super(message);
    this.name = 'ContinuityError';
  }
}

/**
 * A continuous sequence of curves, open or closed.
 *
 * As in upstream, a closed path has a closing segment: a line from the end of the last curve
 * back to the start. It is part of the path only if it is not degenerate. `curves()` and
 * `size()` include it, `openCurves()` and `sizeOpen()` never do. Unlike the other geometry
 * classes a Path is mutable, because paths are built step by step.
 */
export class Path {
  #curves: Curve[] = [];
  /** Start point; used while there are no curves. */
  #start: Point;
  #closed = false;

  /** An empty path that starts at p. */
  constructor(start: Point = new Point(0, 0)) {
    this.#start = start;
  }

  /** A closed circle of two arcs that starts at the rightmost point (upstream Path(Circle)). */
  static fromCircle(center: Point, radius: Coord): Path {
    const p1 = center.add(new Point(radius, 0));
    const p2 = center.sub(new Point(radius, 0));
    const p = new Path(p1);
    p.#curves = [
      new EllipticalArc(p1, radius, radius, 0, false, true, p2),
      new EllipticalArc(p2, radius, radius, 0, false, true, p1),
    ];
    p.#closed = true;
    return p;
  }

  /** Copy of the path. Curves are immutable, so they are shared. */
  clone(): Path {
    const p = new Path(this.#start);
    p.#curves = [...this.#curves];
    p.#closed = this.#closed;
    return p;
  }

  /** The curves without the closing segment. */
  openCurves(): readonly Curve[] {
    return this.#curves;
  }

  /** The closing segment: from the end of the last curve to the initial point. */
  closingSegment(): LineSegment {
    return new LineSegment(this.#finalOpen(), this.initialPoint());
  }

  /** The curves of the path, with the closing segment if it counts (closed and not degenerate). */
  curves(): readonly Curve[] {
    return this.#includesClosingSegment() ? [...this.#curves, this.closingSegment()] : this.#curves;
  }

  /** Curve i. Index `sizeOpen()` is the closing segment. */
  at(i: number): Curve {
    if (i === this.#curves.length) return this.closingSegment();
    const c = this.#curves[i];
    if (!c) throw new RangeError(`Path.at: index ${i} out of range`);
    return c;
  }

  /** Number of curves without the closing segment. */
  sizeOpen(): number {
    return this.#curves.length;
  }

  /** Number of curves including a non-degenerate closing segment, whether the path is closed or not. */
  sizeClosed(): number {
    return this.closingSegment().isDegenerate() ? this.#curves.length : this.#curves.length + 1;
  }

  /** Number of curves: `sizeClosed()` for a closed path, otherwise `sizeOpen()`. */
  size(): number {
    return this.#includesClosingSegment() ? this.sizeClosed() : this.sizeOpen();
  }

  /** True when the path has no curves (the closing segment does not count). */
  empty(): boolean {
    return this.#curves.length === 0;
  }

  closed(): boolean {
    return this.#closed;
  }

  initialPoint(): Point {
    return this.#curves[0]?.initialPoint() ?? this.#start;
  }

  /** The end of the path: the initial point if the path is closed. */
  finalPoint(): Point {
    return this.#closed ? this.initialPoint() : this.#finalOpen();
  }

  /**
   * Close or open the path. When closing, a final line segment that ends at the initial point
   * is dropped: the closing segment takes its place.
   */
  close(closed = true): void {
    if (closed === this.#closed) return;
    if (closed && this.#curves.length >= 1) {
      const last = this.#curves[this.#curves.length - 1] as Curve;
      if (last.isLineSegment() && last.finalPoint().equals(this.initialPoint())) {
        this.#curves.pop();
        if (this.#curves.length === 0) this.#start = last.initialPoint();
      }
    }
    this.#closed = closed;
  }

  /** Remove all curves; the path is open and starts at (0, 0) again. */
  clear(): void {
    this.#curves = [];
    this.#start = new Point(0, 0);
    this.#closed = false;
  }

  /** Remove all curves and start the path at p. */
  start(p: Point): void {
    this.clear();
    this.#start = p;
  }

  /**
   * Append a curve. It must start at the end of the path (or the path must be empty, then the
   * path starts there). Throws ContinuityError otherwise.
   */
  appendCurve(c: Curve): void {
    if (!this.empty() && !this.#finalOpen().equals(c.initialPoint())) throw new ContinuityError();
    if (this.#closed && c.isLineSegment() && c.finalPoint().equals(this.initialPoint())) {
      // A curve that matches the closing segment has no effect.
      return;
    }
    this.#curves.push(c);
  }

  /** Append the curves of other; it must start at the end of this path (see appendCurve()). */
  append(other: Path): void {
    for (const c of other.curves()) this.appendCurve(c);
  }

  /** Remove the last curve (not the closing segment). */
  erase_last(): void {
    const last = this.#curves.pop();
    if (last && this.#curves.length === 0) this.#start = last.initialPoint();
  }

  /** Move the initial point; the first curve changes with it. */
  setInitial(p: Point): void {
    const first = this.#curves[0];
    if (first) this.#curves[0] = first.reverse().withFinal(p).reverse();
    else this.#start = p;
  }

  /** Move the final point of the open path; the last curve changes with it. */
  setFinal(p: Point): void {
    const n = this.#curves.length;
    const last = this.#curves[n - 1];
    if (last) this.#curves[n - 1] = last.withFinal(p);
    else this.#start = p;
  }

  /**
   * The point at path time t: the integer part is the curve index, the fraction the time on that
   * curve (the closing segment counts if it is not degenerate). Throws for t outside [0, size()].
   */
  pointAt(t: number): Point {
    const [i, ct] = this.#factorTime(t);
    return this.at(i).pointAt(ct);
  }

  /**
   * The part of the path between the path times from and to (upstream Path::portion(Coord, Coord)
   * with appendPortionTo). from > to wraps around the end, as upstream. The result is open.
   */
  portion(from: number, to: number): Path {
    const ret = new Path();
    if (!(from >= 0 && to >= 0)) throw new RangeError('from and to must be >=0 in Path::appendPortionTo');
    const curves = this.curves();
    if (to === 0) to = curves.length + 0.999999;
    if (from === to) return ret;
    let fi = Math.trunc(from);
    let ti = Math.trunc(to);
    const ff = from - fi;
    let tf = to - ti;
    if (tf === 0) {
      ti--;
      tf = 1;
    }
    const curve = (i: number) => {
      const c = curves[i];
      if (!c) throw new RangeError(`Path.portion: index ${i} out of range`);
      return c;
    };
    if (fi === ti && from < to) {
      ret.appendCurve(curve(fi).portion(ff, tf));
      return ret;
    }
    if (ff !== 1) ret.appendCurve(curve(fi).portion(ff, 1));
    if (from >= to) {
      let ender = curves.length;
      const closing = this.closingSegment();
      if (ender === this.#curves.length && closing.initialPoint().equals(closing.finalPoint())) ender++;
      for (fi++; fi < Math.min(ender, curves.length); fi++) ret.appendCurve(curve(fi));
      for (let i = 0; i < ti; i++) ret.appendCurve(curve(i));
    } else {
      for (fi++; fi < ti; fi++) ret.appendCurve(curve(fi));
    }
    ret.appendCurve(curve(ti).portion(0, tf));
    return ret;
  }

  /** Curve index and curve time of path time t (upstream Path::_factorTime). */
  #factorTime(t: number): [number, number] {
    const sz = this.size();
    if (t < 0 || t > sz) throw new RangeError('parameter t out of bounds');
    let k = Math.trunc(t);
    let ct = t - k;
    if (k === sz) {
      k--;
      ct = 1;
    }
    return [k, ct];
  }

  /** Bounding box from the fast bounds of the curves; null for an empty path. */
  boundsFast(): OptRect {
    return this.#bounds((c) => c.boundsFast());
  }

  /** Tight bounding box; null for an empty path. */
  boundsExact(): OptRect {
    return this.#bounds((c) => c.boundsExact());
  }

  /** The path after the transform. */
  transformed(m: Affine): Path {
    const p = new Path(this.#start.transformed(m));
    p.#curves = this.#curves.map((c) => c.transformed(m));
    p.#closed = this.#closed;
    return p;
  }

  /** The path traversed in the opposite direction. */
  reversed(): Path {
    const ret = new Path(this.finalPoint());
    if (this.empty()) return ret;

    // Curves that are walked backwards, in the order of the original path.
    let source = [...this.curves()];
    ret.#closed = this.#closed;
    if (this.#closed) {
      const front = this.#curves[0] as Curve;
      if (front.isLineSegment()) {
        // The initial segment is linear: it becomes the new closing segment.
        source = source.slice(1);
      }
      // Otherwise the closing segment becomes degenerate.
    }
    ret.#curves = source.reverse().map((c) => c.reverse());
    ret.#start = ret.#curves[0]?.initialPoint() ?? this.finalPoint();
    return ret;
  }

  /** Same closed state and equal curves. */
  equals(other: Path): boolean {
    if (this === other) return true;
    if (this.#closed !== other.#closed || this.#curves.length !== other.#curves.length) return false;
    return (
      this.#curves.every((c, i) => c.equals(other.#curves[i] as Curve)) &&
      this.closingSegment().equals(other.closingSegment())
    );
  }

  #finalOpen(): Point {
    return this.#curves[this.#curves.length - 1]?.finalPoint() ?? this.#start;
  }

  #includesClosingSegment(): boolean {
    return this.#closed && !this.closingSegment().isDegenerate();
  }

  #bounds(of: (c: Curve) => Rect): OptRect {
    if (this.empty()) return null;
    return this.curves().reduce<OptRect>((acc, c) => unify(acc, of(c)), null);
  }
}
