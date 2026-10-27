// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/svg-path-string-test.cpp
/*
 * Authors:
 *   Kārlis Seņko
 *
 * Copyright (C) 2026 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type Coord, PathSink, Point, parse_svg_path } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { PATHSTRING_FORMAT, PathString } from './path-string.ts';
import { sp_svg_read_pathv } from './svg-path.ts';

const { PATHSTRING_ABSOLUTE: ABS, PATHSTRING_RELATIVE: REL, PATHSTRING_OPTIMIZE: OPT } = PATHSTRING_FORMAT;

/** [expected, format, precision, minexp, forceRepeat] */
type Case = [string, PATHSTRING_FORMAT, number, number, boolean];

function make(c: Case): PathString {
  return new PathString({ format: c[1], precision: c[2], minexp: c[3], forceRepeatCommands: c[4] });
}

// Feeds the commands of a parser to a PathString (as upstream's FormatterSink; the arc angle is passed as is).
class FormatterSink extends PathSink {
  constructor(private readonly out: PathString) {
    super();
  }
  moveTo(p: Point): void {
    this.out.moveTo(p);
  }
  lineTo(p: Point): void {
    this.out.lineTo(p);
  }
  quadTo(c: Point, p: Point): void {
    this.out.quadTo(c, p);
  }
  curveTo(c0: Point, c1: Point, p: Point): void {
    this.out.curveTo(c0, c1, p);
  }
  arcTo(rx: Coord, ry: Coord, angle: Coord, largeArc: boolean, sweep: boolean, p: Point): void {
    this.out.arcTo(rx, ry, angle, largeArc, sweep, p);
  }
  closePath(): void {
    this.out.closePath();
  }
  flush(): void {}
}

describe('PathString', () => {
  it.each<Case>([
    ['M 12,13 M 15.1,18.7', ABS, 4, -8, true],
    ['m 12,13 m 3.1,5.7', REL, 4, -8, true],
    ['m 12,13 m 3.1,5.7', OPT, 4, -8, true],
    // M M doesn't get merged
    ['M 12,13 M 15.1,18.7', ABS, 4, -8, false],
    ['m 12,13 m 3.1,5.7', REL, 4, -8, false],
  ])('moves: %s', (...c) => {
    expect(make(c).moveTo(12, 13).moveTo(15.1, 18.7).string()).toBe(c[0]);
  });

  it.each<Case>([
    ['M 12,13 L 15,18 L 16,19 V 21 V 25 H 26 H 29', ABS, 2, -8, true],
    ['m 12,13 l 3,5 l 1,1 v 2 v 4 h 10 h 3', OPT, 2, -8, true],
    // M x1,y1 x2,y2 is a shorthand for M x1,y1 L x2,y2
    ['M 12,13 15,18 16,19 V 21 25 H 26 29', ABS, 2, -8, false],
    ['m 12,13 3,5 1,1 v 2 4 h 10 3', REL, 2, -8, false],
    ['m 12,13 3,5 1,1 v 2 4 h 10 3', OPT, 2, -8, false],
  ])('lines: %s', (...c) => {
    const f = make(c);
    f.moveTo(12, 13).lineTo(15, 18).lineTo(16, 19);
    f.verticalLineTo(21).verticalLineTo(25).horizontalLineTo(26).horizontalLineTo(29);
    expect(f.string()).toBe(c[0]);
  });

  it('switches from absolute to relative in H and V runs', () => {
    const f = new PathString({ format: OPT, precision: 8, minexp: -8 });
    const positions = [10.5, 21, 31.5, 42, 43, 44, 45];
    for (const p of positions) f.horizontalLineTo(p);
    for (const p of positions) f.verticalLineTo(p);
    expect(f.string()).toBe('H 10.5 21 31.5 42 h 1 1 1 V 10.5 21 31.5 42 v 1 1 1');
  });

  it.each<Case>([
    ['M 12,13 Q 14,16 16,19 Q 18,22 22,27 C 23,29 25,31 25,34 C 33,39 35,31 35,44', ABS, 2, -8, true],
    ['m 12,13 q 2,3 4,6 q 2,3 6,8 c 1,2 3,4 3,7 c 8,5 10,-3 10,10', OPT, 2, -8, true],
    ['m 12,13 q 2,3 4,6 2,3 6,8 c 1,2 3,4 3,7 8,5 10,-3 10,10', REL, 2, -8, false],
  ])('curves: %s', (...c) => {
    const f = make(c);
    f.moveTo(12, 13).quadTo(14, 16, 16, 19).quadTo(new Point(18, 22), new Point(22, 27));
    f.curveTo(23, 29, 25, 31, 25, 34).curveTo(new Point(33, 39), new Point(35, 31), new Point(35, 44));
    expect(f.string()).toBe(c[0]);
  });

  it.each<Case>([
    ['M 10,10 A 6,5 0 0 1 16,15 A 6,5 0 1 0 10,10 Z', ABS, 2, -8, true],
    ['m 10,10 a 6,5 0 0 1 6,5 a 6,5 0 1 0 -6,-5 z', OPT, 2, -8, true],
    ['M 10,10 A 6,5 0 0 1 16,15 6,5 0 1 0 10,10 Z', ABS, 2, -8, false],
    ['m 10,10 a 6,5 0 0 1 6,5 6,5 0 1 0 -6,-5 z', REL, 2, -8, false],
  ])('arcs: %s', (...c) => {
    const f = make(c);
    f.moveTo(10, 10);
    f.arcTo(6, 5, 0, false, true, new Point(16, 15));
    f.arcTo(6, 5, 0, true, false, new Point(10, 10));
    f.closePath();
    expect(f.string()).toBe(c[0]);
  });

  // The best choice is to mix absolute and relative commands.
  it.each<Case>([
    [
      'm 100,100 l 1,1 l 1,1 l 1,1 l 1,1 L 1,1 L 2,2 L 1,1 l 1,1 l 8,8 l 1,1 l 1,1 l 93,93 L 206.5,206.5 L 307,307 l 101.5,101.5',
      OPT,
      5,
      -8,
      true,
    ],
    [
      'm 100,100 1,1 1,1 1,1 1,1 -103,-103 1,1 -1,-1 1,1 8,8 1,1 1,1 93,93 101.5,101.5 100.5,100.5 101.5,101.5',
      REL,
      5,
      -8,
      false,
    ],
    [
      'm 100,100 1,1 1,1 1,1 1,1 L 1,1 2,2 1,1 l 1,1 8,8 1,1 1,1 93,93 L 206.5,206.5 307,307 408.5,408.5',
      OPT,
      5,
      -8,
      false,
    ],
  ])('mixes absolute and relative: %s', (...c) => {
    const f = make(c);
    const pv = parse_svg_path(
      'M 100,100 L 101,101 102,102, 103,103 104,104 1,1 2,2 1,1 2,2 10,10 11,11 12,12 105,105 206.5,206.5 307,307 408.5,408.5',
    );
    new FormatterSink(f).feedPathVector(pv);
    expect(f.string()).toBe(c[0]);
  });

  it('flushes small numbers according to minexp and precision', () => {
    const pv = sp_svg_read_pathv(
      'M 123456781,1.23456781e-8 L 123456782,1.23456782e-8 L 123456785,1.23456785e-8 L 10123456400,1.23456785e-8 L ' +
        '123456789,1.23456789e-8 L 123456789,101.234564e-8 L 123456789,1.23456789e-8',
    );
    const f = new PathString({ format: OPT, precision: 8, minexp: -8 });
    new FormatterSink(f).feedPathVector(pv);
    expect(f.string()).toBe(
      'm 123456780,1.2345678e-8 0,0 10,1e-15 9999999210,0 -9999999210,0 0,9.99999921e-7 0,-9.99999921e-7',
    );
  });

  it('does not accumulate errors in relative moves', () => {
    const steps = 80000;
    const points = Array.from({ length: steps }, (_, i) => {
      const angle = ((Math.PI / 2) * i) / steps;
      return new Point(Math.sin(angle) * 100, Math.cos(angle) * 100);
    });
    const f = new PathString({ format: REL, precision: 8, minexp: -8 });
    f.moveTo(0, 0);
    for (const p of points) f.lineTo(p);

    const pv = sp_svg_read_pathv(f.string());
    const last = points[points.length - 1] as Point;
    const [p0, p1] = [points[0] as Point, points[1] as Point];
    const spacing = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const end = pv[0]?.finalPoint() as Point;
    expect(Math.hypot(last.x - end.x, last.y - end.y)).toBeLessThanOrEqual(spacing);
  });
});
