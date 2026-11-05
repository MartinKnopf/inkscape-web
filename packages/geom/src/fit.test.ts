// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
import { describe, expect, it } from 'vitest';
import { Circle } from './circle.ts';
import { Ellipse } from './ellipse.ts';
import { solveLeastSquares } from './least-squares.ts';
import { Point } from './point.ts';

describe('solveLeastSquares', () => {
  it('solves a square system', () => {
    const x = solveLeastSquares(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    );
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(3, 12);
  });

  it('gives the line through the least squares for more equations than unknowns', () => {
    // y = a x + b through (0,1), (1,2), (2,2), (3,5): a = 1.2, b = 0.7
    const x = solveLeastSquares(
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
      ],
      [1, 2, 2, 5],
    );
    expect(x[0]).toBeCloseTo(1.2, 12);
    expect(x[1]).toBeCloseTo(0.7, 12);
  });

  it('throws for a matrix of rank 1', () => {
    expect(() =>
      solveLeastSquares(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(RangeError);
  });
});

describe('Circle.fit', () => {
  it('gives the circle through 3 points', () => {
    const c = Circle.fit([new Point(0, 0), new Point(10, 0), new Point(10, 10)]);
    expect(c.center.x).toBeCloseTo(5, 10);
    expect(c.center.y).toBeCloseTo(5, 10);
    expect(c.radius).toBeCloseTo(5 * Math.SQRT2, 10);
  });

  it('gives the circle with the diameter between 2 points', () => {
    const c = Circle.fit([new Point(0, 0), new Point(6, 8)]);
    expect(c.center.x).toBeCloseTo(3, 12);
    expect(c.center.y).toBeCloseTo(4, 12);
    expect(c.radius).toBeCloseTo(5, 12);
  });

  it('fits more than 3 points in the least squares sense', () => {
    // 4 points on the circle around (100,200) with radius 50
    const pts = [0.3, 1.7, 3.1, 5.2].map((t) => new Point(100 + 50 * Math.cos(t), 200 + 50 * Math.sin(t)));
    const c = Circle.fit(pts);
    expect(c.center.x).toBeCloseTo(100, 8);
    expect(c.center.y).toBeCloseTo(200, 8);
    expect(c.radius).toBeCloseTo(50, 8);
  });

  it('throws for points on a line', () => {
    expect(() => Circle.fit([new Point(0, 0), new Point(1, 1), new Point(2, 2)])).toThrow(RangeError);
  });
});

describe('Ellipse.fit', () => {
  it('gives the ellipse through 5 points', () => {
    const rot = 0.4;
    const pts = [0.2, 1.4, 2.5, 3.9, 5.4].map((t) => {
      const x = 30 * Math.cos(t);
      const y = 12 * Math.sin(t);
      return new Point(50 + x * Math.cos(rot) - y * Math.sin(rot), -20 + x * Math.sin(rot) + y * Math.cos(rot));
    });
    const e = Ellipse.fit(pts);
    expect(e.center().x).toBeCloseTo(50, 8);
    expect(e.center().y).toBeCloseTo(-20, 8);
    expect(e.ray(0)).toBeCloseTo(30, 8);
    expect(e.ray(1)).toBeCloseTo(12, 8);
    expect(e.rotationAngle().radians()).toBeCloseTo(rot, 8);
  });

  it('throws for less than 5 points', () => {
    expect(() => Ellipse.fit([new Point(0, 0), new Point(1, 0), new Point(0, 1), new Point(1, 1)])).toThrow(
      RangeError,
    );
  });

  it('throws for 5 points on a line', () => {
    const pts = [0, 1, 2, 3, 4].map((i) => new Point(i, 2 * i));
    expect(() => Ellipse.fit(pts)).toThrow(RangeError);
  });
});
