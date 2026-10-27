// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/interval.h, src/3rdparty/2geom/include/2geom/generic-interval.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Nathan Hurst <njh@mail.csse.monash.edu.au>
 *   bulia byak <buliabyak@users.sf.net>
 *   MenTaLguY <mental@rydia.net>
 *   Michael Sloan <mgsloan@gmail.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2007 Michael Sloan <mgsloan@gmail.com>
 * Copyright 2011 Krzysztof Kosiński <tweenk.pl@gmail.com>
 */
import { type Coord, lerp } from './coord.ts';

/** A closed interval [min, max] of reals. Immutable. */
export class Interval {
  readonly #min: Coord;
  readonly #max: Coord;

  /** Interval between u and v in either order; a single value gives a one-point interval. */
  constructor(u: Coord = 0, v: Coord = u) {
    if (u <= v) {
      this.#min = u;
      this.#max = v;
    } else {
      this.#min = v;
      this.#max = u;
    }
  }

  /** Smallest interval that contains all values. */
  static fromArray(values: readonly Coord[]): Interval {
    const [first, ...rest] = values;
    if (first === undefined) throw new RangeError('Interval.fromArray: no values');
    return rest.reduce((r, v) => r.expandTo(v), new Interval(first));
  }

  min(): Coord {
    return this.#min;
  }

  max(): Coord {
    return this.#max;
  }

  extent(): Coord {
    return this.#max - this.#min;
  }

  middle(): Coord {
    return (this.#max + this.#min) / 2;
  }

  isSingular(): boolean {
    return this.#min === this.#max;
  }

  isFinite(): boolean {
    return Number.isFinite(this.#min) && Number.isFinite(this.#max);
  }

  clamp(val: Coord): Coord {
    return Math.min(Math.max(val, this.#min), this.#max);
  }

  /** The end of the interval that is closer to val. */
  nearestEnd(val: Coord): Coord {
    return Math.abs(val - this.#min) <= Math.abs(val - this.#max) ? this.#min : this.#max;
  }

  contains(val: Coord | Interval): boolean {
    if (typeof val === 'number') return this.#min <= val && val <= this.#max;
    return this.#min <= val.#min && val.#max <= this.#max;
  }

  interiorContains(val: Coord | Interval): boolean {
    if (typeof val === 'number') return this.#min < val && val < this.#max;
    return this.#min < val.#min && val.#max < this.#max;
  }

  /** min <= val < max */
  lowerContains(val: Coord | Interval): boolean {
    if (typeof val === 'number') return this.#min <= val && val < this.#max;
    return this.#min <= val.#min && val.#max < this.#max;
  }

  intersects(val: Interval): boolean {
    return this.contains(val.#min) || this.contains(val.#max) || val.contains(this);
  }

  interiorIntersects(val: Interval): boolean {
    return Math.max(this.#min, val.#min) < Math.min(this.#max, val.#max);
  }

  setMin(val: Coord): Interval {
    return val > this.#max ? new Interval(val) : new Interval(val, this.#max);
  }

  setMax(val: Coord): Interval {
    return val < this.#min ? new Interval(val) : new Interval(this.#min, val);
  }

  /** Smallest interval that contains this one and val. */
  expandTo(val: Coord): Interval {
    // No else: comparisons with NaN keep the bound.
    return new Interval(val < this.#min ? val : this.#min, val > this.#max ? val : this.#max);
  }

  /** Grow by amount on both sides; a negative amount shrinks, down to the middle at most. */
  expandBy(amount: Coord): Interval {
    const lo = this.#min - amount;
    const hi = this.#max + amount;
    if (lo > hi) {
      const halfway = (lo + hi) / 2;
      return new Interval(halfway);
    }
    return new Interval(lo, hi);
  }

  /** Smallest interval that contains both. */
  unionWith(a: Interval): Interval {
    // Not Math.min/max: they would propagate NaN, upstream keeps the bound.
    // biome-ignore lint/complexity/useMathMinMax: see above
    return new Interval(a.#min < this.#min ? a.#min : this.#min, a.#max > this.#max ? a.#max : this.#max);
  }

  /** The overlap, or null when the intervals are disjoint. */
  intersect(o: Interval): Interval | null {
    const u = Math.max(this.#min, o.#min);
    const v = Math.min(this.#max, o.#max);
    return u <= v ? new Interval(u, v) : null;
  }

  /** Value at time t, where time 0 is min and 1 is max. */
  valueAt(t: Coord): Coord {
    return lerp(t, this.#min, this.#max);
  }

  timeAt(v: Coord): Coord {
    return (v - this.#min) / this.extent();
  }

  nearestTime(v: Coord): Coord {
    if (v <= this.#min) return 0;
    if (v >= this.#max) return 1;
    return this.timeAt(v);
  }

  /** Shift by an offset. */
  offset(amount: Coord): Interval {
    return new Interval(this.#min + amount, this.#max + amount);
  }

  equals(o: Interval): boolean {
    return this.#min === o.#min && this.#max === o.#max;
  }
}

/** An interval or nothing. */
export type OptInterval = Interval | null;
