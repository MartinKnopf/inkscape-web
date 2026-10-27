// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/svg-path-geom-test.cpp
/*
 * Authors: see git history
 *
 * Copyright (C) 2010 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { CubicBezier, LineSegment, Path, type PathVector, Point } from '@inkscape-web/geom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHSTRING_FORMAT } from './path-string.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from './svg-path.ts';

const rectanglesAbsoluteClosed = ['M 1,2 L 4,2 L 4,8 L 1,8 z', 'M 1,2 4,2 4,8 1,8 z', 'M 1,2 H 4 V 8 H 1 z'];
const rectanglesRelativeClosed = [
  'm 1,2 l 3,0 l 0,6 l -3,0 z',
  'm 1,2 3,0 0,6 -3,0 z',
  'm 1,2 h 3 v 6 h -3 z',
];
const rectanglesAbsoluteOpen = [
  'M 1,2 L 4,2 L 4,8 L 1,8 L 1,2',
  'M 1,2 4,2 4,8 1,8 1,2',
  'M 1,2 H 4 V 8 H 1 V 2',
];
const rectanglesRelativeOpen = [
  'm 1,2 l 3,0 l 0,6 l -3,0 l 0,-6',
  'm 1,2 3,0 0,6 -3,0 0,-6',
  'm 1,2 h 3 v 6 h -3 v -6',
];
const rectanglesAbsoluteClosed2 = [
  'M 1,2 L 4,2 L 4,8 L 1,8 L 1,2 z',
  'M 1,2 4,2 4,8 1,8 1,2 z',
  'M 1,2 H 4 V 8 H 1 V 2 z',
];
const rectanglesRelativeClosed2 = [
  'm 1,2 l 3,0 l 0,6 l -3,0 l 0,-6 z',
  'm 1,2 3,0 0,6 -3,0 0,-6 z',
  'm 1,2 h 3 v 6 h -3 v -6 z',
];

/** Path of line segments through the points, optionally closed. */
function polyline(points: [number, number][], closed: boolean): Path {
  const pts = points.map(([x, y]) => new Point(x, y));
  const path = new Path(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    path.appendCurve(new LineSegment(pts[i - 1] as Point, pts[i] as Point));
  }
  path.close(closed);
  return path;
}

const rect: [number, number][] = [
  [1, 2],
  [4, 2],
  [4, 8],
  [1, 8],
];
const rectanglepvopen = (): PathVector => [polyline([...rect, [1, 2]], false)];
const rectanglepvclosed = (): PathVector => [polyline(rect, true)];
const rectanglepvclosed2 = (): PathVector => [polyline([...rect, [1, 2]], true)];

/** Compare the structure of two path vectors (types of curves and their control points). */
function expectPathVectorsEqual(a: PathVector, b: PathVector, eps = 1e-16): void {
  expect(a.length).toBe(b.length);
  a.forEach((pa, i) => {
    const pb = b[i] as Path;
    expect(pa.closed()).toBe(pb.closed());
    expect(pa.size()).toBe(pb.size());
    for (let j = 0; j < pa.size(); j++) {
      const ca = pa.at(j);
      const cb = pb.at(j);
      expect(ca.constructor).toBe(cb.constructor);
      if (ca instanceof LineSegment || ca instanceof CubicBezier) {
        const [pta, ptb] = [ca.controlPoints(), (cb as typeof ca).controlPoints()];
        pta.forEach((p, k) => {
          expect(Math.abs(p.x - (ptb[k] as Point).x)).toBeLessThanOrEqual(eps);
          expect(Math.abs(p.y - (ptb[k] as Point).y)).toBeLessThanOrEqual(eps);
        });
      }
    }
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('sp_svg_read_pathv', () => {
  it.each([
    ['absolute closed', rectanglesAbsoluteClosed, rectanglepvclosed],
    ['relative closed', rectanglesRelativeClosed, rectanglepvclosed],
    ['absolute open', rectanglesAbsoluteOpen, rectanglepvopen],
    ['relative open', rectanglesRelativeOpen, rectanglepvopen],
    ['absolute closed with last segment', rectanglesAbsoluteClosed2, rectanglepvclosed2],
    ['relative closed with last segment', rectanglesRelativeClosed2, rectanglepvclosed2],
  ])('reads rectangles, %s', (_name, strs, expected) => {
    for (const str of strs) {
      expectPathVectorsEqual(sp_svg_read_pathv(str), expected());
    }
  });

  it('reads concatenated paths', () => {
    const good = [
      polyline(rect, true),
      polyline([...rect.map(([x, y]) => [x + 1, y + 2] as [number, number]), [2, 4]], false),
      polyline(
        rect.map(([x, y]) => [x + 2, y + 4] as [number, number]),
        true,
      ),
      polyline([...rect, [1, 2]], false),
    ];
    const str =
      (rectanglesAbsoluteClosed[0] as string) +
      rectanglesRelativeOpen[0] +
      rectanglesRelativeClosed[0] +
      rectanglesAbsoluteOpen[0];
    expectPathVectorsEqual(sp_svg_read_pathv(str), good);
  });

  it('keeps zero-length subpaths', () => {
    const good = [
      new Path(new Point(0, 0)),
      polyline(
        [
          [1, 1],
          [2, 2],
        ],
        false,
      ),
      (() => {
        const p = new Path(new Point(3, 3));
        p.close();
        return p;
      })(),
      polyline(
        [
          [4, 4],
          [5, 5],
        ],
        true,
      ),
      new Path(new Point(6, 6)),
    ];
    expectPathVectorsEqual(sp_svg_read_pathv('M 0,0 M 1,1 L 2,2 M 3,3 z M 4,4 L 5,5 z M 6,6'), good);
    expectPathVectorsEqual(sp_svg_read_pathv('m 0,0 m 1,1 l 1,1 m 1,1 z m 1,1 l 1,1 z m 2,2'), good);
  });

  it('starts a new subpath at the start point after z', () => {
    const good = [
      polyline(
        [
          [1, 1],
          [2, 2],
        ],
        true,
      ),
      polyline(
        [
          [1, 1],
          [3, 3],
        ],
        true,
      ),
    ];
    expectPathVectorsEqual(sp_svg_read_pathv('M 1,1 L 2,2 z L 3,3 z'), good);
    expectPathVectorsEqual(sp_svg_read_pathv('M 1,1 l 1,1 z l 2,2 z'), good);
  });

  it('reads decimals, exponents and numbers without separators', () => {
    const good1 = polyline(
      [
        [0.01, 0.02],
        [0.04, 0.02],
        [1.5, 1.6],
        [0.01, 0.08],
        [0.01, 0.02],
      ],
      true,
    );
    expectPathVectorsEqual(sp_svg_read_pathv('M .01,.02 L.04.02 L1.5,1.6L0.01,0.08 .01.02 z'), [good1]);
    const good2 = polyline(
      [
        [0.01, 0.02],
        [0.04, 0.02],
        [1.5, 1.6],
        [0.01, 0.08],
      ],
      true,
    );
    expectPathVectorsEqual(
      sp_svg_read_pathv('M 1e-2,.2e-1 L 0.004e1,0.0002e+2 L0150E-2,1.6e0L1.0e-2,80e-3 z'),
      [good2],
    );
    const good3 = polyline(
      [
        [0.1, 0.2],
        [0.4, 0.2],
        [0.4, 0.8],
        [0.1, 0.8],
      ],
      true,
    );
    expectPathVectorsEqual(sp_svg_read_pathv('M .1.2+0.4.2e0.4e0+8e-1.1.8 z'), [good3]);
    expectPathVectorsEqual(sp_svg_read_pathv('m .1.2+0.3.0e0.0e0+6e-1-.3.0 z'), [good3]);
  });

  it.each([
    'M 1,2 4,2 4,8 1,8 z , m 13,15',
    'M 1,2 4,2 4,8 1,8 z m,13,15',
    'M 1,2 4,2 4,8 1,8 z . m 13,15',
    'M 1,2 4,2 4,8 1,8 z + - m 13,15',
    'M 1,2 4,2 4,8 1,8 z 9809 m 13,15',
    'M 1,2 4,2 4,8 1,8 z m 13e4e5,15',
    'M 1,2 4,2 4,8 1,8 z m +-13,15',
    'M 1,2 4,2 4,8 1,8 z m 13e+-12,15',
    'M 1,2 4,2 4,8 1,8 z m .e12,15',
    'M 1,2 4,2 4,8 1,8 z m .,15',
    'M 1,2 4,2 4,8 1,8 z m +,15',
  ])('keeps the path before the error in %j', (str) => {
    expectPathVectorsEqual(sp_svg_read_pathv(str), rectanglepvclosed());
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('returns an empty path vector for null', () => {
    expect(sp_svg_read_pathv(null)).toEqual([]);
  });
});

describe('sp_svg_write_path', () => {
  it('writes the shortest form by default', () => {
    expect(sp_svg_write_path(sp_svg_read_pathv('M 1,2 L 4,2 L 4,8 L 1,8 z'))).toBe('M 1,2 H 4 V 8 H 1 Z');
    expect(sp_svg_write_path(sp_svg_read_pathv('M 10,20 C 11,21 12,22 13,23 Q 1,2 3,4'))).toBe(
      'm 10,20 c 1,1 2,2 3,3 Q 1,2 3,4',
    );
  });

  it('writes a single path', () => {
    const [path] = sp_svg_read_pathv('m 1,2 h 3 v 6');
    expect(sp_svg_write_path(path as Path)).toBe('M 1,2 H 4 V 8');
  });

  it('honours the PathString options', () => {
    const pv = sp_svg_read_pathv('M 1,2 L 4,2 L 4,8');
    expect(sp_svg_write_path(pv, { pathString: { format: PATHSTRING_FORMAT.PATHSTRING_ABSOLUTE } })).toBe(
      'M 1,2 H 4 V 8',
    );
    expect(sp_svg_write_path(pv, { pathString: { format: PATHSTRING_FORMAT.PATHSTRING_RELATIVE } })).toBe(
      'm 1,2 h 3 v 6',
    );
    expect(sp_svg_write_path(pv, { pathString: { forceRepeatCommands: true } })).toBe('M 1,2 H 4 V 8');
  });

  it('normalizes: absolute, 4 digits, repeated commands, no H/V, quadratics as cubics', () => {
    const pv = sp_svg_read_pathv('M 1.23456,2 H 4 Q 5,5 6,6 L 7,7');
    expect(sp_svg_write_path(pv, { normalize: true })).toBe(
      'M 1.235,2 L 4,2 C 4.667,4 5.333,5.333 6,6 L 7,7',
    );
  });

  it('writes arcs with the angle in degrees', () => {
    const pv = sp_svg_read_pathv('M 10,10 A 6,5 30 0 1 16,15');
    expect(sp_svg_write_path(pv)).toBe('m 10,10 a 6,5 30 0 1 6,5');
  });
});
