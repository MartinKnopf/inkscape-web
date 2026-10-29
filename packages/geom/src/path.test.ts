// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { CubicBezier, LineSegment } from './bezier-curve.ts';
import { ContinuityError, Path } from './path.ts';
import { PathBuilder } from './path-sink.ts';
import { PathVector } from './pathvector.ts';
import { Point } from './point.ts';
import { Rect } from './rect.ts';
import { parse_svg_path, SVGPathParseError } from './svg-path-parser.ts';
import { write_svg_path } from './svg-path-writer.ts';
import { Scale, Translate } from './transforms.ts';

const P = (x: number, y: number) => new Point(x, y);

function triangle(closed: boolean): Path {
  const path = new Path(P(0, 0));
  path.appendCurve(new LineSegment(P(0, 0), P(10, 0)));
  path.appendCurve(new LineSegment(P(10, 0), P(10, 10)));
  if (closed) path.close();
  return path;
}

describe('Path', () => {
  it('has a closing segment that counts only when closed and not degenerate', () => {
    const open = triangle(false);
    expect([open.size(), open.sizeOpen(), open.sizeClosed()]).toEqual([2, 2, 3]);
    expect(open.finalPoint()).toEqual(P(10, 10));

    const closed = triangle(true);
    expect([closed.size(), closed.sizeOpen()]).toEqual([3, 2]);
    expect(closed.finalPoint()).toEqual(P(0, 0));
    expect(closed.closingSegment().initialPoint()).toEqual(P(10, 10));
    expect(closed.curves().at(-1)).toEqual(closed.closingSegment());
  });

  it('close() drops a final line that ends at the start', () => {
    const path = triangle(false);
    path.appendCurve(new LineSegment(P(10, 10), P(0, 0)));
    path.close();
    expect(path.sizeOpen()).toBe(2);
    expect(path.size()).toBe(3);

    const curved = new Path(P(0, 0));
    curved.appendCurve(new CubicBezier(P(0, 0), P(5, 0), P(5, 5), P(0, 0)));
    curved.close();
    expect(curved.sizeOpen()).toBe(1);
    expect(curved.size()).toBe(1); // the closing segment is degenerate
  });

  it('refuses a curve that does not continue the path', () => {
    const path = triangle(false);
    expect(() => path.appendCurve(new LineSegment(P(1, 1), P(2, 2)))).toThrow(ContinuityError);
  });

  it('starts where the first curve starts', () => {
    const path = new Path();
    path.appendCurve(new LineSegment(P(3, 3), P(4, 4)));
    expect(path.initialPoint()).toEqual(P(3, 3));
  });

  it('has bounds, except for an empty path', () => {
    expect(new Path(P(1, 1)).boundsExact()).toBeNull();
    expect(
      triangle(true)
        .boundsFast()
        ?.equals(new Rect(0, 0, 10, 10)),
    ).toBe(true);
  });

  it('transforms start, curves and closing segment', () => {
    const t = triangle(true).transformed(Scale(2).multiply(Translate(1, 1)));
    expect(t.initialPoint()).toEqual(P(1, 1));
    expect(t.closingSegment().initialPoint()).toEqual(P(21, 21));
    expect(t.closed()).toBe(true);
  });

  it('reverses twice to the original', () => {
    for (const d of [
      'M 0 0 L 10 0 L 10 10 z',
      'M 0 0 L 10 0 L 10 10',
      'M 0 0 C 5 0 5 5 0 0 z',
      'M 0 0 Q 5 5 10 0 L 10 10 z',
    ]) {
      const pv = parse_svg_path(d);
      const twice = PathVector.reversed(PathVector.reversed(pv));
      expect(write_svg_path(twice)).toBe(write_svg_path(pv));
    }
    // The first line becomes the closing segment.
    expect(write_svg_path(PathVector.reversed(parse_svg_path('M 0 0 L 10 0 L 10 10 z')))).toBe(
      'M 0 0 L 10 10 V 0 z',
    );
  });
});

describe('PathBuilder', () => {
  it('starts a new subpath at the last start point after closePath', () => {
    const b = new PathBuilder();
    b.moveTo(P(1, 1));
    b.lineTo(P(2, 2));
    b.closePath();
    b.lineTo(P(5, 5));
    b.flush();
    const pv = b.peek();
    expect(pv).toHaveLength(2);
    expect(pv[1]?.initialPoint()).toEqual(P(1, 1));
  });
});

describe('parse_svg_path', () => {
  it('reports the position of the error', () => {
    try {
      parse_svg_path('M 0 0 L 10 10 x');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SVGPathParseError);
      expect((e as SVGPathParseError).offset).toBe(14);
    }
  });
});

describe('Path.fromRect', () => {
  it('is the closed outline of the rectangle', () => {
    expect(write_svg_path([Path.fromRect(new Rect(1, 2, 3, 4))])).toBe('M 1 2 H 3 V 4 H 1 z');
  });
});

describe('Path.fromCircle', () => {
  it('is a closed path of two arcs around the center', () => {
    const p = Path.fromCircle(new Point(10, 20), 5);
    expect(p.closed()).toBe(true);
    expect(p.size()).toBe(2);
    expect(p.boundsExact()).toEqual(new Rect(5, 15, 15, 25));
    expect(write_svg_path([p])).toBe('M 15 20 A 5 5 0 0 1 5 20 A 5 5 0 0 1 15 20 z');
  });
});
