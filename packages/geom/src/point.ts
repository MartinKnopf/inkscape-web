// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/point.h, src/3rdparty/2geom/src/2geom/point.cpp
/*
 * Authors:
 *   Michael G. Sloan <mgsloan@gmail.com>
 *   Nathan Hurst <njh@njhurst.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2006-2009 Authors
 */

import type { Affine } from './affine.ts';
import { are_near, type Coord, type Dim2, EPSILON, hypot, type Vec2, X } from './coord.ts';

/** Remainder of an angle in [0, 2pi), like upstream Angle::radians0(). */
function normalizeAngle(angle: number): number {
  const a = angle % (2 * Math.PI);
  return a < 0 ? a + 2 * Math.PI : a;
}

/** A point (or vector) in the plane. Immutable. */
export class Point implements Vec2 {
  readonly x: Coord;
  readonly y: Coord;

  constructor(x: Coord = 0, y: Coord = 0) {
    this.x = x;
    this.y = y;
  }

  /** Unit vector at the given angle (radians), exact for multiples of pi/2 within EPSILON. */
  static polar(angle: Coord, radius?: Coord): Point {
    const p = Point.#unitAt(angle);
    return radius === undefined ? p : p.mul(radius);
  }

  static #unitAt(angle: Coord): Point {
    const remainder = normalizeAngle(angle);
    if (are_near(remainder, 0) || are_near(remainder, 2 * Math.PI)) return new Point(1, 0);
    if (are_near(remainder, Math.PI / 2)) return new Point(0, 1);
    if (are_near(remainder, Math.PI)) return new Point(-1, 0);
    if (are_near(remainder, (3 * Math.PI) / 2)) return new Point(0, -1);
    return new Point(Math.cos(angle), Math.sin(angle));
  }

  /** Coordinate by dimension (upstream `p[d]`). */
  at(d: Dim2): Coord {
    return d === X ? this.x : this.y;
  }

  length(): Coord {
    return hypot(this.x, this.y);
  }

  lengthSq(): Coord {
    return this.x * this.x + this.y * this.y;
  }

  /** Unit vector in the same direction; the zero vector stays zero. */
  normalized(): Point {
    let len = hypot(this.x, this.y);
    if (len === 0 || Number.isNaN(len)) return this;
    if (len !== Infinity) return this.div(len);
    let infCoords = 0;
    const tmp = [0, 0] as [number, number];
    for (const [i, v] of [this.x, this.y].entries()) {
      if (v === Infinity) {
        infCoords++;
        tmp[i] = 1;
      } else if (v === -Infinity) {
        infCoords++;
        tmp[i] = -1;
      }
    }
    if (infCoords === 0) {
      // Both coordinates are near +/-DBL_MAX.
      const q = this.div(4);
      len = hypot(q.x, q.y);
      return q.div(len);
    }
    const t = new Point(tmp[0], tmp[1]);
    return infCoords === 1 ? t : t.mul(Math.sqrt(0.5));
  }

  /** (x, y) -> (y, -x). */
  ccw(): Point {
    return new Point(this.y, -this.x);
  }

  cw(): Point {
    return new Point(-this.y, this.x);
  }

  /** (x, y) -> (-y, x), upstream `rot90()`. */
  rot90(): Point {
    return new Point(-this.y, this.x);
  }

  neg(): Point {
    return new Point(-this.x, -this.y);
  }

  add(o: Point): Point {
    return new Point(this.x + o.x, this.y + o.y);
  }

  sub(o: Point): Point {
    return new Point(this.x - o.x, this.y - o.y);
  }

  /** Multiply both coordinates by a scalar. */
  mul(s: Coord): Point {
    return new Point(this.x * s, this.y * s);
  }

  /** Multiply component-wise. */
  scaled(o: Point): Point {
    return new Point(this.x * o.x, this.y * o.y);
  }

  div(s: Coord): Point {
    return new Point(this.x / s, this.y / s);
  }

  dot(o: Point): Coord {
    return this.x * o.x + this.y * o.y;
  }

  /** x1 * y2 - y1 * x2. */
  cross(o: Point): Coord {
    return this.x * o.y - this.y * o.x;
  }

  /** (1 - t) * this + t * o. */
  lerp(t: Coord, o: Point): Point {
    return this.mul(1 - t).add(o.mul(t));
  }

  /** The point transformed by an affine: this * m. */
  transformed(m: Affine): Point {
    return new Point(this.x * m.c0 + this.y * m.c2 + m.c4, this.x * m.c1 + this.y * m.c3 + m.c5);
  }

  isFinite(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y);
  }

  isZero(): boolean {
    return this.x === 0 && this.y === 0;
  }

  isNormalized(eps: number = EPSILON): boolean {
    return are_near(this.length(), 1, eps);
  }

  equals(o: Point): boolean {
    return this.x === o.x && this.y === o.y;
  }
}

export function L2(p: Point): Coord {
  return p.length();
}

export function L2sq(p: Point): Coord {
  return p.lengthSq();
}

export function L1(p: Point): Coord {
  return Math.abs(p.x) + Math.abs(p.y);
}

export function dot(a: Point, b: Point): Coord {
  return a.dot(b);
}

export function cross(a: Point, b: Point): Coord {
  return a.cross(b);
}

export function rot90(p: Point): Point {
  return p.rot90();
}

export function distance(a: Point, b: Point): Coord {
  return a.sub(b).length();
}

export function distanceSq(a: Point, b: Point): Coord {
  return a.sub(b).lengthSq();
}

export function middle_point(a: Point, b: Point): Point {
  return a.lerp(0.5, b);
}

export function unit_vector(a: Point): Point {
  return a.normalized();
}

/** Angle of the vector from the +X axis, in (-pi, pi]. */
export function atan2(p: Point): Coord {
  return Math.atan2(p.y, p.x);
}

/** Signed angle from a to b. */
export function angle_between(a: Point, b: Point): Coord {
  return Math.atan2(cross(a, b), dot(a, b));
}
