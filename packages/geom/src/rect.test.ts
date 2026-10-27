// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Interval } from './interval.ts';
import { Point } from './point.ts';
import { intersect, Rect, unify } from './rect.ts';
import { Rotate } from './transforms.ts';

describe('Interval', () => {
  it('orders its ends, expands and intersects', () => {
    const i = new Interval(5, 2);
    expect([i.min(), i.max(), i.extent(), i.middle()]).toEqual([2, 5, 3, 3.5]);
    expect(i.expandTo(7).max()).toBe(7);
    expect(i.expandBy(-2).equals(new Interval(3.5))).toBe(true);
    expect(i.intersect(new Interval(4, 9))?.equals(new Interval(4, 5))).toBe(true);
    expect(i.intersect(new Interval(6, 9))).toBeNull();
  });
});

describe('Rect', () => {
  const r = new Rect(1, 2, 5, 10);

  it('has corners, size and center', () => {
    expect(r.corners()).toEqual([new Point(1, 2), new Point(5, 2), new Point(5, 10), new Point(1, 10)]);
    expect(r.dimensions()).toEqual(new Point(4, 8));
    expect(r.midpoint()).toEqual(new Point(3, 6));
    expect([r.left(), r.top(), r.right(), r.bottom(), r.area()]).toEqual([1, 2, 5, 10, 32]);
  });

  it('contains points and rects, and intersects', () => {
    expect(r.contains(new Point(1, 10))).toBe(true);
    expect(r.contains(new Point(0, 5))).toBe(false);
    expect(r.contains(new Rect(2, 3, 4, 4))).toBe(true);
    expect(r.intersects(new Rect(5, 10, 6, 11))).toBe(true);
    expect(r.intersects(new Rect(6, 0, 7, 1))).toBe(false);
    expect(r.intersects(null)).toBe(false);
  });

  it('unions and intersects optional rects', () => {
    expect(unify(null, null)).toBeNull();
    expect(unify(r, null)).toBe(r);
    expect(unify(r, new Rect(0, 0, 2, 3))?.equals(new Rect(0, 0, 5, 10))).toBe(true);
    expect(intersect(r, new Rect(4, 8, 9, 9))?.equals(new Rect(4, 8, 5, 9))).toBe(true);
    expect(intersect(r, new Rect(6, 0, 7, 1))).toBeNull();
  });

  it('expands and shrinks', () => {
    expect(r.expandBy(1, 2).equals(new Rect(0, 0, 6, 12))).toBe(true);
    expect(r.expandTo(new Point(9, 0)).equals(new Rect(1, 0, 9, 10))).toBe(true);
    expect(r.shrinkBy(10).midpoint()).toEqual(r.midpoint());
  });

  it('gives the bounds of the transformed corners', () => {
    const b = new Rect(0, 0, 2, 2).transformed(Rotate.from_degrees(45));
    expect(b.width()).toBeCloseTo(2 * Math.SQRT2, 12);
    expect(b.left()).toBeCloseTo(-Math.SQRT2, 12);
  });
});
