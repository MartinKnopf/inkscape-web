// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/measure-tool.cpp
// @vitest-environment happy-dom
import { Preferences, SPDocument } from '@inkscape-web/core';
import { LineSegment, Path, type PathVector, Point, Translate } from '@inkscape-web/geom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import {
  angle_arc_points,
  type LabelPlacement,
  type MeasureTool,
  measure_angle,
  measure_intersections,
  measure_length,
  measure_text,
  reposition_overlapping_labels,
} from './measure-tool.ts';

const P = (x: number, y: number) => new Point(x, y);

function box(x0: number, y0: number, x1: number, y1: number): PathVector {
  const path = new Path(P(x0, y0));
  path.appendCurve(new LineSegment(P(x0, y0), P(x1, y0)));
  path.appendCurve(new LineSegment(P(x1, y0), P(x1, y1)));
  path.appendCurve(new LineSegment(P(x1, y1), P(x0, y1)));
  path.close();
  return [path];
}

describe('measure computations', () => {
  it('measures the angle of the line in radians, optionally from a base direction', () => {
    expect(measure_angle(P(0, 0), P(10, 0))).toBe(0);
    expect(measure_angle(P(0, 0), P(0, 10))).toBeCloseTo(Math.PI / 2, 12);
    expect(measure_angle(P(5, 5), P(0, 5))).toBeCloseTo(Math.PI, 12);
    // from a base at 90 degrees, a line at -90 degrees is -180 degrees away; a line at 180 from a base at -90 is 270, wrapped to -90
    expect(measure_angle(P(0, 0), P(0, -10), P(0, 10))).toBeCloseTo(-Math.PI, 12);
    expect(measure_angle(P(0, 0), P(-10, 0), P(0, -10))).toBeCloseTo(-Math.PI / 2, 12);
    expect(measure_angle(P(0, 0), P(10, 0), P(0, 10))).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('converts px lengths to the unit with the scale and writes labels with the precision', () => {
    expect(measure_length(96, 'in', 1)).toBeCloseTo(1, 12);
    expect(measure_length(10, 'mm', 0.5)).toBeCloseTo((10 / 3.779527559055119) * 0.5, 12);
    expect(measure_text(2.5, 2, 'mm')).toBe('2.50 mm');
    expect(measure_text(45, 0, 'mm', true)).toBe('45 °');
    expect(measure_text(1.234, 1, 'px', false, 'S1')).toBe('S1: 1.2 px');
  });

  it('finds the crossings of the line with the shapes in document coordinates', () => {
    // The shape is at 20..60 in its own coordinates and moved by 10 to the right.
    const shapes = [{ pathv: box(20, 0, 60, 10), i2doc: Translate(10, 0) }];
    const pts = measure_intersections(P(0, 5), P(100, 5), shapes, true, true);
    expect(pts.map((p) => p.x)).toEqual([30, 70].map((x) => expect.closeTo(x, 9)));

    // two shapes: 4 crossings; without "in between" only the first and the last remain
    const two = [...shapes, { pathv: box(80, 0, 90, 10), i2doc: Translate(0, 0) }];
    expect(measure_intersections(P(0, 5), P(100, 5), two, true, true)).toHaveLength(4);
    const outer = measure_intersections(P(0, 5), P(100, 5), two, false, true);
    expect(outer.map((p) => Math.round(p.x))).toEqual([30, 90]);

    // with "ignore first and last" off, the ends of the line are crossings too
    const ends = measure_intersections(P(0, 5), P(100, 5), shapes, true, false);
    expect(ends.map((p) => Math.round(p.x))).toEqual([0, 30, 70, 100]);
  });

  it('moves a label that overlaps another one away from the line', () => {
    const at = (end: Point): LabelPlacement => ({ label: '', lengthVal: 1, offset: 35, start: end, end });
    const placements = [at(P(0, 0)), at(P(1, 0))];
    // 1 screen px is 1 desktop unit and the normal points down
    reposition_overlapping_labels(placements, (v) => v, P(0, 1), 10, 2);
    const [a, b] = placements as [LabelPlacement, LabelPlacement];
    expect(a.end.y === 0 || b.end.y === 0).toBe(true);
    expect(Math.abs(a.end.y - b.end.y)).toBeGreaterThanOrEqual(10);
    expect(Math.max(a.offset, b.offset)).toBe(35 + 13);
  });

  it('the angle arc starts on the line at the label distance and turns by the angle', () => {
    const arc = angle_arc_points(P(0, 0), P(100, 0), P(40, 0), Math.PI / 2);
    expect(arc).not.toBeNull();
    const [p1, , , p4] = arc as [Point, Point, Point, Point];
    expect(p1.x).toBeCloseTo(40, 9);
    expect(p1.y).toBeCloseTo(0, 9);
    expect(p4.x).toBeCloseTo(0, 9);
    expect(p4.y).toBeCloseTo(-40, 9);
    expect(angle_arc_points(P(3, 3), P(3, 3), P(4, 4), 1)).toBeNull();
  });
});

describe('MeasureTool', () => {
  const PREFS = ['unit', 'precision', 'scale', 'measure-start', 'measure-end'];
  beforeEach(() => {
    Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
  });
  afterEach(() => {
    for (const p of PREFS) Preferences.get().remove(`/tools/measure/${p}`);
  });

  it('a drag shows the length with unit, precision and scale, and the angle', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect x="100" y="0" width="100" height="100"/></svg>',
    );
    if (!doc) throw new Error('parse failed');
    const host = document.createElement('div');
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const dt = new SPDesktop(new Canvas(host), doc);
    dt.zoom_absolute(P(0, 0), 1, false);
    dt.scroll_absolute(P(0, 0));
    Preferences.get().setString('/tools/measure/unit', 'in');
    Preferences.get().setInt('/tools/measure/precision', 3);
    Preferences.get().setDouble('/tools/measure/scale', 50);
    tool_switch('Measure', dt);
    const tool = dt.getTool() as MeasureTool;
    const svg = dt.getCanvas().svg;
    const fire = (type: string, x: number, y: number) =>
      svg.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      );
    fire('pointerdown', 0, 50);
    fire('pointermove', 150, 50);
    fire('pointermove', 288, 50);
    fire('pointerup', 288, 50);

    const texts = [...dt.getCanvas().svg.querySelectorAll('text')].map((t) => t.textContent);
    // 288 px = 3 in, at scale 50 %
    expect(texts).toContain('1.500 in');
    expect(texts).toContain('0.000 °');
    // the line crosses the rectangle at x = 100 and 200: one segment of 100 px = 1.0417 in * 0.5
    expect(texts).toContain('0.521 in');
    expect(tool.start_p.x).toBeCloseTo(0, 6);
    expect(tool.end_p.x).toBeCloseTo(288, 6);
  });
});
