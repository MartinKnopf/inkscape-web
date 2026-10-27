// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Affine } from './affine.ts';
import { angle_between, middle_point, Point } from './point.ts';

describe('Point', () => {
  it('polar is exact for right angles', () => {
    expect(Point.polar(0)).toEqual(new Point(1, 0));
    expect(Point.polar(Math.PI / 2)).toEqual(new Point(0, 1));
    expect(Point.polar(Math.PI)).toEqual(new Point(-1, 0));
    expect(Point.polar(-Math.PI / 2)).toEqual(new Point(0, -1));
    expect(Point.polar(2 * Math.PI)).toEqual(new Point(1, 0));
  });

  it('normalizes, keeping the zero vector', () => {
    expect(new Point(3, 4).normalized()).toEqual(new Point(0.6, 0.8));
    expect(new Point(0, 0).normalized()).toEqual(new Point(0, 0));
    expect(new Point(Number.POSITIVE_INFINITY, 3).normalized()).toEqual(new Point(1, 0));
  });

  it('does vector arithmetic', () => {
    const a = new Point(1, 2);
    const b = new Point(3, -1);
    expect(a.add(b)).toEqual(new Point(4, 1));
    expect(a.cross(b)).toBe(-7);
    expect(a.dot(b)).toBe(1);
    expect(a.rot90()).toEqual(new Point(-2, 1));
    expect(a.lerp(0.5, b)).toEqual(new Point(2, 0.5));
    expect(middle_point(a, b)).toEqual(new Point(2, 0.5));
    expect(angle_between(new Point(1, 0), new Point(0, 2))).toBeCloseTo(Math.PI / 2, 15);
  });

  it('transforms as a row vector', () => {
    expect(new Point(1, 2).transformed(new Affine(2, 0, 0, 3, 10, 20))).toEqual(new Point(12, 26));
    expect(new Point(1, 2).transformed(new Affine(0, 1, -1, 0, 0, 0))).toEqual(new Point(-2, 1));
  });
});
