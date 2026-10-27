// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/angle.h
/*
 * Authors:
 *   Johan Engelen <goejendaagh@zonnet.nl>
 *   Marco Cecchetti <mrcekets at gmail.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2007-2010 Authors
 */
import type { Coord } from './coord.ts';
import { angle_between, atan2, type Point } from './point.ts';

const TWO_PI = 2 * Math.PI;

/**
 * An angle in radians, stored in [0, 2pi). Arithmetic wraps around. Immutable.
 * `radians()` gives the value in [-pi, pi), the convention of C's math library.
 */
export class Angle {
  readonly #angle: Coord;

  constructor(v: Coord = 0) {
    let a = v % TWO_PI;
    if (a < 0) a += TWO_PI;
    this.#angle = a;
  }

  /** Direction of a vector. */
  static fromPoint(p: Point): Angle {
    return new Angle(atan2(p));
  }

  /** Signed angle from vector a to vector b. */
  static between(a: Point, b: Point): Angle {
    return new Angle(angle_between(a, b));
  }

  static from_degrees(d: Coord): Angle {
    return new Angle(d * (Math.PI / 180));
  }

  /** Value in [-pi, pi). */
  radians(): Coord {
    return this.#angle >= Math.PI ? this.#angle - TWO_PI : this.#angle;
  }

  /** Value in [0, 2pi). */
  radians0(): Coord {
    return this.#angle;
  }

  degrees(): Coord {
    return this.radians() * (180 / Math.PI);
  }

  plus(o: Angle | Coord): Angle {
    return new Angle(this.#angle + toAngle(o).#angle);
  }

  minus(o: Angle | Coord): Angle {
    return new Angle(this.#angle - toAngle(o).#angle);
  }

  equals(o: Angle | Coord): boolean {
    return this.#angle === toAngle(o).#angle;
  }
}

function toAngle(a: Angle | Coord): Angle {
  return typeof a === 'number' ? new Angle(a) : a;
}

/**
 * Part of a circle of angles: from a start to an end angle, going in the direction of increasing
 * angles (`sweep` true) or decreasing ones. A full circle has equal ends and `full` set.
 * Immutable.
 */
export class AngleInterval {
  readonly #start: Angle;
  readonly #end: Angle;
  readonly #sweep: boolean;
  readonly #full: boolean;

  constructor(start: Angle | Coord = 0, end: Angle | Coord = 0, sweep = false, full = false) {
    this.#start = toAngle(start);
    this.#end = toAngle(end);
    this.#sweep = sweep;
    this.#full = full;
  }

  static createFull(start: Angle, sweep = true): AngleInterval {
    return new AngleInterval(start, start, sweep, true);
  }

  initialAngle(): Angle {
    return this.#start;
  }

  finalAngle(): Angle {
    return this.#end;
  }

  sweep(): boolean {
    return this.#sweep;
  }

  isDegenerate(): boolean {
    return this.#start.equals(this.#end) && !this.#full;
  }

  isFull(): boolean {
    return this.#start.equals(this.#end) && this.#full;
  }

  withInitial(a: Angle | Coord, preferFull = false): AngleInterval {
    const s = toAngle(a);
    return new AngleInterval(s, this.#end, this.#sweep, preferFull && s.equals(this.#end));
  }

  withFinal(a: Angle | Coord, preferFull = false): AngleInterval {
    const e = toAngle(a);
    return new AngleInterval(this.#start, e, this.#sweep, preferFull && e.equals(this.#start));
  }

  withAngles(s: Angle | Coord, e: Angle | Coord, preferFull = false): AngleInterval {
    const sa = toAngle(s);
    const ea = toAngle(e);
    return new AngleInterval(sa, ea, this.#sweep, preferFull && sa.equals(ea));
  }

  withSweep(sweep: boolean): AngleInterval {
    return new AngleInterval(this.#start, this.#end, sweep, this.#full);
  }

  reversed(): AngleInterval {
    return new AngleInterval(this.#end, this.#start, !this.#sweep, this.#full);
  }

  /** Angle at time t, where time 0 is the start and 1 the end. */
  angleAt(t: Coord): Angle {
    const span = this.extent();
    return new Angle(this.#start.radians0() + span * (this.#sweep ? t : -t));
  }

  /** Inverse of angleAt(). Angles outside the interval give times outside [0, 1]. */
  timeAtAngle(a: Angle): Coord {
    if (this.#full) {
      const ta = this.#sweep ? a.minus(this.#start) : this.#start.minus(a);
      return ta.radians0() / TWO_PI;
    }
    const ex = this.extent();
    const outex = TWO_PI - ex;
    if (this.#sweep) {
      const midout = this.#start.minus(outex / 2);
      const acmp = a.minus(midout);
      const scmp = this.#start.minus(midout);
      if (acmp.radians0() >= scmp.radians0()) {
        return a.minus(this.#start).radians0() / ex;
      }
      return -this.#start.minus(a).radians0() / ex;
    }
    const midout = this.#start.plus(outex / 2);
    const acmp = a.minus(midout);
    const scmp = this.#start.minus(midout);
    if (acmp.radians0() <= scmp.radians0()) {
      return this.#start.minus(a).radians0() / ex;
    }
    return -a.minus(this.#start).radians0() / ex;
  }

  contains(a: Angle): boolean {
    if (this.#full) return true;
    const s = this.#start.radians0();
    const e = this.#end.radians0();
    const x = a.radians0();
    if (this.#sweep) {
      if (s < e) return x >= s && x <= e;
      return x >= s || x <= e;
    }
    if (s > e) return x <= s && x >= e;
    return x <= s || x >= e;
  }

  /** Size of the interval in radians, in [0, 2pi]. */
  extent(): Coord {
    if (this.#full) return TWO_PI;
    return this.#sweep ? this.#end.minus(this.#start).radians0() : this.#start.minus(this.#end).radians0();
  }

  /** Signed size: positive when the sweep goes in the direction of increasing angles. */
  sweepAngle(): Coord {
    if (this.#full) return this.#sweep ? TWO_PI : -TWO_PI;
    let sa = this.#end.radians0() - this.#start.radians0();
    if (this.#sweep && sa < 0) sa += TWO_PI;
    if (!this.#sweep && sa > 0) sa -= TWO_PI;
    return sa;
  }
}
