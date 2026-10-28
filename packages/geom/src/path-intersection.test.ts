// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { CubicBezier, LineSegment } from './bezier-curve.ts';
import { Path } from './path.ts';
import { lineCrossings } from './path-intersection.ts';
import { Point } from './point.ts';

const P = (x: number, y: number) => new Point(x, y);

function square(x0: number, y0: number, x1: number, y1: number): Path {
  const path = new Path(P(x0, y0));
  path.appendCurve(new LineSegment(P(x0, y0), P(x1, y0)));
  path.appendCurve(new LineSegment(P(x1, y0), P(x1, y1)));
  path.appendCurve(new LineSegment(P(x1, y1), P(x0, y1)));
  path.close();
  return path;
}

describe('lineCrossings', () => {
  it('finds the two edges of a closed square as times along the line', () => {
    const t = lineCrossings(P(0, 5), P(100, 5), [square(20, 0, 60, 10)]);
    expect(t).toHaveLength(2);
    expect(t[0]).toBeCloseTo(0.2, 9);
    expect(t[1]).toBeCloseTo(0.6, 9);
  });

  it('ignores crossings outside the segment and counts a line through a corner once', () => {
    expect(lineCrossings(P(0, 5), P(10, 5), [square(20, 0, 60, 10)])).toEqual([]);
    // The diagonal enters at the corner (40, 8) .. (60, 12): the line from (0,0) to (100,20) leaves through x=60.
    const t = lineCrossings(P(0, 0), P(100, 20), [square(40, 0, 60, 20)]);
    expect(t.map((x) => Number(x.toFixed(6)))).toEqual([0.4, 0.6]);
    // Through the corner (20, 10): one crossing.
    expect(lineCrossings(P(0, 0), P(40, 20), [square(20, 10, 60, 40)])).toHaveLength(1);
  });

  it('finds the crossings of a curve', () => {
    // Cubic arch from (0,0) to (100,0) with its top at y = 56.25.
    const arch = new Path(P(0, 0));
    arch.appendCurve(new CubicBezier(P(0, 0), P(0, 75), P(100, 75), P(100, 0)));
    const t = lineCrossings(P(-10, 30), P(110, 30), [arch]);
    expect(t).toHaveLength(2);
    expect(t[0] ?? 1).toBeLessThan(0.2);
    expect(t[1] ?? 0).toBeGreaterThan(0.8);
    expect(lineCrossings(P(-10, 60), P(110, 60), [arch])).toEqual([]);
  });
});
