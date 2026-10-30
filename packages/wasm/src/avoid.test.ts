// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream libavoid in WASM: connectors route around shapes.
import { describe, expect, it } from 'vitest';
import { loadGeom } from './index.ts';

const geom = await loadGeom();

/** A box from (x0, y0) to (x1, y1) as a polygon. */
const box = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

describe('AvoidRouter', () => {
  it('routes an orthogonal connector around a shape and reports the change', () => {
    const r = geom.newAvoidRouter();
    r.addShape(1, box(40, -20, 60, 20));
    r.addConnector(2, true);
    r.setEndpoints(2, 0, 0, 100, 0);
    r.processTransaction();
    expect(r.takeChanged()).toEqual([2]);
    const { points, types } = r.route(2, 0);
    // Start and end stay; the route leaves the straight line to pass the box.
    expect(points.slice(0, 2)).toEqual([0, 0]);
    expect(points.slice(-2)).toEqual([100, 0]);
    expect(points.length).toBeGreaterThan(4);
    expect(types).toMatch(/^L+$/);
    // Every segment is horizontal or vertical.
    for (let i = 2; i < points.length; i += 2) {
      const dx = points[i]! - points[i - 2]!;
      const dy = points[i + 1]! - points[i - 1]!;
      expect(dx === 0 || dy === 0).toBe(true);
    }
    r.free();
  });

  it('routes a straight polyline when nothing is in the way, and reroutes when a shape moves', () => {
    const r = geom.newAvoidRouter();
    r.addShape(1, box(40, 50, 60, 70));
    r.addConnector(2, false);
    r.setEndpoints(2, 0, 0, 100, 0);
    r.processTransaction();
    expect(r.route(2, 0).points).toEqual([0, 0, 100, 0]);
    r.takeChanged();
    r.moveShape(1, box(40, -20, 60, 20));
    r.processTransaction();
    expect(r.takeChanged()).toEqual([2]);
    expect(r.route(2, 0).points.length).toBeGreaterThan(4);
    // A curvature gives a curved polyline with cubic segments.
    expect(r.route(2, 1).types).toContain('C');
    r.free();
  });
});
