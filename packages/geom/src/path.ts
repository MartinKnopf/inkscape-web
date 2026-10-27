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
import type { Curve } from './curve.ts';
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
