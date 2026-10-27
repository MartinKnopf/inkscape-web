// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { EllipticalArc } from './elliptical-arc.ts';
import { Point } from './point.ts';
import { Rect } from './rect.ts';
import { Rotate, Scale, Translate } from './transforms.ts';

const P = (x: number, y: number) => new Point(x, y);

const sampledBounds = (arc: EllipticalArc, n = 4000) =>
  Rect.fromPoints(Array.from({ length: n + 1 }, (_, i) => arc.pointAt(i / n)));

function expectRectNear(a: Rect, b: Rect, digits = 3) {
  expect(a.left()).toBeCloseTo(b.left(), digits);
  expect(a.top()).toBeCloseTo(b.top(), digits);
  expect(a.right()).toBeCloseTo(b.right(), digits);
  expect(a.bottom()).toBeCloseTo(b.bottom(), digits);
}

describe('EllipticalArc', () => {
  it('the two flags select one of four arcs through the same end points', () => {
    const centers = [false, true].flatMap((large) =>
      [false, true].map((sweep) => new EllipticalArc(P(0, 0), 10, 10, 0, large, sweep, P(10, 10))),
    );
    for (const arc of centers) {
      expect(arc.pointAt(0)).toEqual(P(0, 0));
      expect(arc.pointAt(1)).toEqual(P(10, 10));
      // Every point of the arc is on the circle around the arc's center.
      const mid = arc.pointAt(0.5).sub(arc.center()).length();
      expect(mid).toBeCloseTo(10, 12);
    }
    const [small0, small1, large0, large1] = centers as [
      EllipticalArc,
      EllipticalArc,
      EllipticalArc,
      EllipticalArc,
    ];
    expect(small0.center()).toEqual(P(10, 0));
    expect(small1.center()).toEqual(P(0, 10));
    expect(large0.center()).toEqual(P(0, 10));
    expect(large1.center()).toEqual(P(10, 0));
    expect(small1.sweep()).toBe(true);
    expect(Math.abs(large0.sweepAngle())).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(Math.abs(small0.sweepAngle())).toBeCloseTo(Math.PI / 2, 12);
  });

  it('enlarges rays that are too small', () => {
    const arc = new EllipticalArc(P(0, 0), 1, 2, 0, false, true, P(100, 0));
    expect(arc.ray(0)).toBeCloseTo(50, 12);
    expect(arc.ray(1)).toBeCloseTo(100, 12);
    expect(arc.center().x).toBeCloseTo(50, 12);
  });

  it('is a chord when a ray is zero', () => {
    const arc = new EllipticalArc(P(0, 0), 0, 5, 0.3, true, true, P(10, 10));
    expect(arc.isChord()).toBe(true);
    expect(arc.isLineSegment()).toBe(true);
    expect(arc.pointAt(0.25)).toEqual(P(2.5, 2.5));
    expect(arc.boundsExact().equals(new Rect(0, 0, 10, 10))).toBe(true);
  });

  it('boundsExact matches sampling, also for rotated ellipses and partial arcs', () => {
    for (const [rx, ry, rot, large, sweep] of [
      [10, 5, 0.7, false, true],
      [10, 5, 0.7, true, false],
      [8, 20, -2, true, true],
      [10, 10, 0, true, true],
    ] as const) {
      const arc = new EllipticalArc(P(1, 2), rx, ry, rot, large, sweep, P(15, 9));
      expectRectNear(arc.boundsExact(), sampledBounds(arc));
    }
  });

  it('stays an arc under a non-uniform transform: end points map, shape follows', () => {
    const arc = new EllipticalArc(P(0, 0), 10, 6, 0.4, true, false, P(12, 3));
    for (const m of [
      Scale(3, 0.5),
      Rotate.from_degrees(40).multiply(Scale(2, 1)).multiply(Translate(5, -3)),
      Scale(-1, 2), // flips the sweep
    ]) {
      const t = arc.transformed(m);
      expect(t.initialPoint()).toEqual(arc.initialPoint().transformed(m));
      expect(t.finalPoint()).toEqual(arc.finalPoint().transformed(m));
      const sampled = Rect.fromPoints(
        Array.from({ length: 4001 }, (_, i) => arc.pointAt(i / 4000).transformed(m)),
      );
      expectRectNear(t.boundsExact(), sampled);
      expect(t.largeArc()).toBe(arc.largeArc());
    }
    expect(arc.transformed(Scale(-1, 2)).sweep()).toBe(!arc.sweep());
  });

  it('a singular transform gives a chord', () => {
    const arc = new EllipticalArc(P(0, 0), 10, 10, 0, false, true, P(10, 10));
    const t = arc.transformed(Scale(1, 0));
    expect(t.isChord()).toBe(true);
    expect(t.finalPoint()).toEqual(P(10, 0));
  });

  it('reverses and takes portions', () => {
    const arc = new EllipticalArc(P(0, 0), 10, 6, 0.4, false, true, P(12, 3));
    const r = arc.reverse();
    expect(r.initialPoint()).toEqual(P(12, 3));
    expect(r.pointAt(0.3).x).toBeCloseTo(arc.pointAt(0.7).x, 12);
    expect(r.pointAt(0.3).y).toBeCloseTo(arc.pointAt(0.7).y, 12);

    const part = arc.portion(0.2, 0.6);
    expect(part.initialPoint()).toEqual(arc.pointAt(0.2));
    expect(part.finalPoint()).toEqual(arc.pointAt(0.6));
    expect(part.pointAt(0.5).x).toBeCloseTo(arc.pointAt(0.4).x, 9);
    expect(part.pointAt(0.5).y).toBeCloseTo(arc.pointAt(0.4).y, 9);
    expect(arc.portion(0.6, 0.2).pointAt(0.5).x).toBeCloseTo(arc.pointAt(0.4).x, 9);
  });

  it('withFinal recomputes the center for the new end point', () => {
    const arc = new EllipticalArc(P(0, 0), 10, 10, 0, false, true, P(10, 10));
    const moved = arc.withFinal(P(0, 20));
    expect(moved.finalPoint()).toEqual(P(0, 20));
    expect(moved.pointAt(0.5).sub(moved.center()).length()).toBeCloseTo(10, 12);
  });
});
