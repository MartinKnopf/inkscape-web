// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/path-sink.h, src/3rdparty/2geom/src/2geom/path-sink.cpp
/*
 * callback interface for SVG path data
 *
 * Copyright 2007 MenTaLguY <mental@rydia.net>
 */
import { CubicBezier, LineSegment, QuadraticBezier } from './bezier-curve.ts';
import type { Coord } from './coord.ts';
import type { Curve } from './curve.ts';
import { EllipticalArc } from './elliptical-arc.ts';
import { Path } from './path.ts';
import type { PathVector } from './pathvector.ts';
import { Point } from './point.ts';
import type { Rect } from './rect.ts';

/**
 * Receiver of path commands, like the commands of SVG path data. The coordinates are absolute.
 * Implemented by PathBuilder (stores paths) and SVGPathWriter (writes path data).
 */
export abstract class PathSink {
  /** Move to a different point without creating a segment. Usually starts a new subpath. */
  abstract moveTo(p: Point): void;
  /** Output a line segment. */
  abstract lineTo(p: Point): void;
  /** Output a quadratic Bezier segment. */
  abstract quadTo(c: Point, p: Point): void;
  /** Output a cubic Bezier segment. */
  abstract curveTo(c0: Point, c1: Point, p: Point): void;
  /** Output an elliptical arc segment. `angle` is the rotation of the ellipse in radians. */
  abstract arcTo(rx: Coord, ry: Coord, angle: Coord, largeArc: boolean, sweep: boolean, p: Point): void;
  /** Close the current path with a line segment. */
  abstract closePath(): void;
  /**
   * Flush any internal state. This implicitly finishes the current subpath.
   * Calling it again must have no effect.
   */
  abstract flush(): void;

  /** Output a curve, with a moveTo to its initial point if `moveToInitial`. */
  feedCurve(c: Curve, moveToInitial = true): void {
    c.feed(this, moveToInitial);
  }

  /** Output a subpath. The closing segment is never output, only closePath(). */
  feedPath(path: Path): void {
    this.flush();
    this.moveTo(path.initialPoint());
    for (const c of path.openCurves()) {
      c.feed(this, false);
    }
    if (path.closed()) this.closePath();
    this.flush();
  }

  feedPathVector(pv: PathVector): void {
    for (const path of pv) {
      this.feedPath(path);
    }
  }

  /** Output an axis-aligned rectangle with moveTo, lineTo and closePath. */
  feedRect(r: Rect): void {
    this.moveTo(r.corner(0));
    this.lineTo(r.corner(1));
    this.lineTo(r.corner(2));
    this.lineTo(r.corner(3));
    this.closePath();
  }
}

/** A PathSink that collects the subpaths in a PathVector. */
export class PathBuilder extends PathSink {
  readonly #out: PathVector;
  #inPath = false;
  #path = new Path();
  #startP = new Point(0, 0);

  /** Collect into `out`, or into a new internal vector. */
  constructor(out: PathVector = []) {
    super();
    this.#out = out;
  }

  /** The paths collected so far. Call flush() first to include the unfinished subpath. */
  peek(): PathVector {
    return this.#out;
  }

  /** Forget the collected paths. */
  clear(): void {
    this.#out.length = 0;
  }

  /** True while a subpath is being built, that is, lineTo etc. will not start a new one. */
  inPath(): boolean {
    return this.#inPath;
  }

  moveTo(p: Point): void {
    this.flush();
    this.#path.start(p);
    this.#startP = p;
    this.#inPath = true;
  }

  lineTo(p: Point): void {
    this.#ensureInPath();
    this.#path.appendCurve(new LineSegment(this.#path.finalPoint(), p));
  }

  quadTo(c: Point, p: Point): void {
    this.#ensureInPath();
    this.#path.appendCurve(new QuadraticBezier(this.#path.finalPoint(), c, p));
  }

  curveTo(c0: Point, c1: Point, p: Point): void {
    this.#ensureInPath();
    this.#path.appendCurve(new CubicBezier(this.#path.finalPoint(), c0, c1, p));
  }

  arcTo(rx: Coord, ry: Coord, angle: Coord, largeArc: boolean, sweep: boolean, p: Point): void {
    this.#ensureInPath();
    this.#path.appendCurve(new EllipticalArc(this.#path.finalPoint(), rx, ry, angle, largeArc, sweep, p));
  }

  closePath(): void {
    if (this.#inPath) {
      this.#path.close();
      this.flush();
    }
  }

  flush(): void {
    if (this.#inPath) {
      this.#inPath = false;
      this.#out.push(this.#path);
      this.#path = new Path();
    }
  }

  override feedPath(other: Path): void {
    this.flush();
    this.#out.push(other);
  }

  /** Implicit moveTo after closePath, like in "M 1,1 L 2,2 z l 2,2 z". */
  #ensureInPath(): void {
    if (!this.#inPath) this.moveTo(this.#startP);
  }
}
