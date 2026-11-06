// SPDX-License-Identifier: GPL-2.0-or-later
import { type PathVector, parse_svg_path } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { dash_pathv } from './metafile-print.ts';

/** Each path as its list of points, rounded. */
const points = (pv: PathVector) =>
  pv.map((p) =>
    [p.initialPoint(), ...p.openCurves().map((c) => c.finalPoint())].map((q) => [
      +q.x.toFixed(3),
      +q.y.toFixed(3),
    ]),
  );

describe('dash_pathv (FixPPTDashLine)', () => {
  it('does not close an open path', () => {
    // the dashes 0-5 and 10-12; the first dash is written last (upstream first_frag)
    expect(points(dash_pathv(parse_svg_path('M0 0 L12 0'), [5, 5]))).toEqual([
      [
        [10, 0],
        [12, 0],
      ],
      [
        [0, 0],
        [5, 0],
      ],
    ]);
  });

  it('keeps the dash phase over subpaths but does not join them', () => {
    // length 4 + 4; dashes 0-3, 4-7 (the second subpath from 0 to 3), the gap 3-4 is skipped
    expect(points(dash_pathv(parse_svg_path('M0 0 L4 0 M0 10 L4 10'), [3, 1]))).toEqual([
      [
        [0, 10],
        [3, 10],
      ],
      [
        [0, 0],
        [3, 0],
      ],
    ]);
    // a dash over the end of a subpath is split into one piece on each subpath
    expect(points(dash_pathv(parse_svg_path('M0 0 L4 0 M0 10 L4 10'), [2, 1, 3, 1]))).toEqual([
      [
        [3, 0],
        [4, 0],
      ],
      [
        [0, 10],
        [2, 10],
      ],
      [
        [3, 10],
        [4, 10],
      ],
      [
        [0, 0],
        [2, 0],
      ],
    ]);
  });

  it('joins the last dash of a closed path with the first one', () => {
    // square of length 40, dashes 0-15 and 20-40: they meet at the start point and become one path
    const out = points(dash_pathv(parse_svg_path('M0 0 H10 V10 H0 Z'), [15, 5, 25, 5]));
    expect(out).toEqual([
      [
        [10, 10],
        [0, 10],
        [0, 0],
        [10, 0],
        [10, 5],
      ],
    ]);
  });

  it('joins the last dash with the first one when they meet within 0.01', () => {
    // the path ends 0.005 from its start: the last dash (10-20) ends there, the first (0-5) starts at 0;
    // they become one path through the end point
    const out = points(dash_pathv(parse_svg_path('M0 0 L10 0 L0.005 0'), [5, 5, 20, 5]));
    expect(out).toEqual([
      [
        [10, 0],
        [0.005, 0],
        [5, 0],
      ],
    ]);
  });
});
