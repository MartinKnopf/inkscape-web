// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { CubicBezier, LineSegment, QuadraticBezier } from './bezier-curve.ts';
import type { Curve } from './curve.ts';
import { Point } from './point.ts';
import { Rect } from './rect.ts';
import { Rotate, Scale } from './transforms.ts';

const P = (x: number, y: number) => new Point(x, y);

/** Bounding box of many sample points. */
function sampledBounds(c: Curve, n = 2000): Rect {
  return Rect.fromPoints(Array.from({ length: n + 1 }, (_, i) => c.pointAt(i / n)));
}

function expectRectNear(a: Rect, b: Rect, digits: number) {
  for (const [x, y] of [
    [a.left(), b.left()],
    [a.top(), b.top()],
    [a.right(), b.right()],
    [a.bottom(), b.bottom()],
  ] as const) {
    expect(x).toBeCloseTo(y, digits);
  }
}

describe('Bezier curves', () => {
  const cubic = new CubicBezier(P(0, 0), P(10, 40), P(30, -30), P(40, 10));
  const quad = new QuadraticBezier(P(0, 0), P(20, 30), P(40, 0));

  it('evaluates at the ends and the middle', () => {
    expect(cubic.pointAt(0)).toEqual(P(0, 0));
    expect(cubic.pointAt(1)).toEqual(P(40, 10));
    expect(cubic.pointAt(0.5)).toEqual(P(20, 5));
    expect(quad.pointAt(0.5)).toEqual(P(20, 15));
  });

  it('boundsExact contains the extrema, boundsFast the control polygon', () => {
    for (const c of [cubic, quad]) {
      expectRectNear(c.boundsExact(), sampledBounds(c), 3);
      expect(c.boundsFast().contains(c.boundsExact())).toBe(true);
    }
    expect(quad.boundsFast().equals(new Rect(0, 0, 40, 30))).toBe(true);
    expect(quad.boundsExact().bottom()).toBeCloseTo(15, 12);
  });

  it('boundsExact of the transformed curve is the bounds of the transformed points', () => {
    const m = Rotate.from_degrees(33).multiply(Scale(2, 0.5));
    const t = cubic.transformed(m);
    expectRectNear(t.boundsExact(), sampledBounds(t), 3);
  });

  it('portion matches the original curve', () => {
    for (const c of [cubic, quad, new LineSegment(P(1, 1), P(5, 9))]) {
      const part = c.portion(0.25, 0.75);
      expect(part.initialPoint().x).toBeCloseTo(c.pointAt(0.25).x, 12);
      expect(part.finalPoint().y).toBeCloseTo(c.pointAt(0.75).y, 12);
      expect(part.pointAt(0.5).x).toBeCloseTo(c.pointAt(0.5).x, 12);
      expect(part.pointAt(0.5).y).toBeCloseTo(c.pointAt(0.5).y, 12);
    }
    expect(cubic.portion(0, 1).equals(cubic)).toBe(true);
    expect(cubic.portion(1, 0).equals(cubic.reverse())).toBe(true);
  });

  it('reverses', () => {
    expect(cubic.reverse().initialPoint()).toEqual(P(40, 10));
    expect(cubic.reverse().reverse().equals(cubic)).toBe(true);
  });

  it('knows degenerate curves and lines', () => {
    expect(new LineSegment(P(1, 1), P(1, 1)).isDegenerate()).toBe(true);
    expect(new CubicBezier(P(2, 2), P(2, 2), P(2, 2), P(2, 2)).isDegenerate()).toBe(true);
    expect(cubic.isDegenerate()).toBe(false);
    expect(new CubicBezier(P(0, 0), P(0, 0), P(5, 5), P(5, 5)).isLineSegment()).toBe(true);
    expect(new QuadraticBezier(P(0, 0), P(1, 0), P(2, 2)).isLineSegment()).toBe(false);
  });

  it('withFinal moves only the final point', () => {
    const c = cubic.withFinal(P(1, 2));
    expect(c.finalPoint()).toEqual(P(1, 2));
    expect(c.controlPoint(2)).toEqual(cubic.controlPoint(2));
  });
});
