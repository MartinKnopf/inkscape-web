// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/3rdparty/2geom/src/2geom/bezier-utils.cpp
import { describe, expect, it } from 'vitest';
import { bezier_fit_cubic, bezier_fit_cubic_full, bezier_pt, darray_left_tangent } from './bezier-utils.ts';
import { Point } from './point.ts';

const P = (x: number, y: number) => new Point(x, y);

const corner = [
  P(0, 0),
  P(1, 0),
  P(2, 0),
  P(3, 0),
  P(4, 0),
  P(5, 0),
  P(5, 1),
  P(5, 2),
  P(5, 3),
  P(5, 4),
  P(5, 5),
];

describe('bezier-utils', () => {
  it('bezier_pt evaluates a cubic with the Bernstein basis', () => {
    // t = 0.5: (P0 + 3 P1 + 3 P2 + P3) / 8
    const p = bezier_pt(3, [P(0, 0), P(0, 8), P(8, 8), P(8, 0)], 0.5);
    expect(p.x).toBeCloseTo(4, 12);
    expect(p.y).toBeCloseTo(6, 12);
  });

  it('two points with constrained tangents give handles at a third of the distance', () => {
    const out: Point[] = [];
    const n = bezier_fit_cubic_full(out, null, [P(0, 0), P(3, 0)], 2, P(0, 1), P(0, 1), 0.1, 1);
    expect(n).toBe(1);
    expect(out.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0, 1],
      [3, 1],
      [3, 0],
    ]);
  });

  it('fits points sampled from a cubic with fixed tangents to one Bezier', () => {
    const ctrl = [P(0, 0), P(0, 4), P(10, 4), P(10, 0)];
    const data = Array.from({ length: 8 }, (_, k) => bezier_pt(3, ctrl, k / 7));
    const out: Point[] = [];
    const n = bezier_fit_cubic_full(out, null, data, data.length, P(0, 1), P(0, 1), 0.01, 1);
    expect(n).toBe(1);
    // Fixed tangents keep the handles on the vertical lines x = 0 and x = 10.
    expect(out[1]?.x).toBe(0);
    expect(out[2]?.x).toBe(10);
    // Least squares recovers the handle length 4 (chord-length parameters differ slightly
    // from the sampling parameters, so allow slack).
    expect(out[1]?.y).toBeCloseTo(4, 0);
    expect(out[2]?.y).toBeCloseTo(4, 0);
    expect(out[0]).toEqual(ctrl[0]);
    expect(out[3]).toEqual(ctrl[3]);
  });

  it('bezier_fit_cubic puts all control points on a straight line', () => {
    const out: Point[] = [];
    expect(bezier_fit_cubic(out, [P(0, 0), P(1, 0), P(2, 0), P(3, 0)], 4, 0.01)).toBe(1);
    expect(out).toHaveLength(4);
    for (const p of out) expect(p.y).toBeCloseTo(0, 12);
  });

  it('a right-angle corner needs two Beziers and reports the split point', () => {
    // One cubic cannot follow the corner within 0.01, so the hook check splits at the corner.
    const out: Point[] = [];
    const split: number[] = [];
    const n = bezier_fit_cubic_full(out, split, corner, corner.length, P(0, 0), P(0, 0), 0.01, 4);
    expect(n).toBe(2);
    expect(split[0]).toBe(5);
    expect(out[3]).toEqual(P(5, 0));
    expect(out[4]).toEqual(P(5, 0));
  });

  it('returns -1 when more segments are needed than allowed', () => {
    expect(bezier_fit_cubic([], corner, corner.length, 0.01)).toBe(-1);
  });

  it('left tangent skips points within the tolerance', () => {
    const t = darray_left_tangent([P(0, 0), P(0.1, 0), P(0, 5)], 3, 1);
    expect(t.x).toBe(0);
    expect(t.y).toBe(1);
  });
});
