// SPDX-License-Identifier: GPL-2.0-or-later
// The TypeScript port must give the same results as upstream lib2geom, which packages/wasm
// compiles from the real C++ sources. Paths without arcs must match byte for byte; arcs use
// sin/cos/atan2 whose last digit may differ between the C++ and JavaScript math libraries,
// so their numbers are compared with a tolerance.
import { type AffineMatrix, type Geom, loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { Affine } from './affine.ts';
import { PathVector } from './pathvector.ts';
import { parse_svg_path, SVGPathParseError } from './svg-path-parser.ts';
import { write_svg_path } from './svg-path-writer.ts';
import { Rotate, Scale, Translate } from './transforms.ts';

const geom: Geom = await loadGeom();

const LINES: Record<string, string> = {
  triangle: 'M 10 20 L 30 40 L 50 20 z',
  'horizontal and vertical': 'M0 0 H 10 V 10 H 0 z',
  relative: 'm 10,10 l 5,5 h 10 v -5 c 1,2 3,4 5,6 s 2,2 4,4 q 1,1 2,2 t 3,3 z',
  'implicit lineto': 'M 0 0 10 10 20 0',
  'implicit relative lineto': 'm 1 1 2 2 3 3',
  'compact numbers': 'M.5.5L1e2-3.5E-1 1.5.5-.5e+1-5',
  shorthands: 'M0 0 C 10 0 20 10 30 10 S 50 20 60 10 Q 70 0 80 10 T 100 10',
  'curves with equal tangents': 'M0 0 C 0 10 10 10 10 0 C 10 -10 20 -10 20 0 Q 30 10 40 0 Q 50 -10 60 0',
  subpaths: 'M0 0 L10 0 L10 10 z M 20 20 L 30 20 L 30 30 z M 5 5',
  'lineto after z': 'M 1 1 L 2 2 z l 2 2 z',
  'last line closes path': 'M 0 0 L 10 0 L 10 10 L 0 0 Z',
  'cubic ends at start': 'M 0 0 C 10 0 10 10 0 0 z',
  'relative close snaps': 'm 0 0 l 10 0 l 0 10 l -10 -0.0000000001 z',
  'nearly vertical and horizontal': 'M 0 0 L 0.0000001 10 L 10 10.0000001',
  'tiny and huge numbers': 'M 1234567 0 L 0.0001 1e-7 L 1e21 1e22 L 0.001 0.00099',
  'degenerate segments': 'M 5 5 L 5 5 C 5 5 5 5 5 5 Q 5 5 5 5 z',
  'separators and white space': '  M 1,2\n\tL 3 ,4\r\n,5 6 ',
  'empty path': '',
  'white space only': '   ',
};

const ARCS: Record<string, string> = {
  'small arc, no sweep': 'M 0 0 A 10 10 0 0 0 20 0',
  'small arc, sweep': 'M 0 0 A 10 10 0 0 1 20 0',
  'large arc, no sweep': 'M 0 0 A 10 10 0 1 0 10 10',
  'large arc, sweep': 'M 0 0 A 10 10 0 1 1 10 10',
  'rotated ellipse': 'M 0 0 A 20 10 30 1 0 40 10',
  'radii too small': 'M 0 0 A 1 1 0 0 0 100 0',
  'radii too small, rotated': 'M 0 0 a 1 3 45 0 1 30 10',
  'zero radius is a line': 'M 0 0 A 0 5 0 0 0 10 10 A 5 0 30 1 1 20 0',
  'same end point is ignored': 'M 5 5 A 10 10 0 0 0 5 5 L 6 6',
  'flags without separators': 'M0 0a10 10 0 1110 10a5 5 0 0010 0',
  'negative radii': 'M 0 0 A -10 -5 0 0 1 20 0',
  'rotation of 180 degrees': 'M 0 0 A 10 5 180 0 1 20 0',
  'rotation of 90 and 270 degrees': 'M 0 0 A 10 5 90 0 1 20 0 A 10 5 270 1 1 40 0',
  'half ellipse': 'M 0 0 A 10 10 0 0 1 20 0 A 10 10 0 1 1 0 0 z',
  'arcs in a closed shape': 'M 10 0 A 10 10 0 0 1 0 10 A 10 10 0 0 1 -10 0 A 10 10 0 0 1 10 0 z',
  'relative arcs': 'm 10 10 a 5 8 15 0 1 10 10 a 5 8 15 1 0 -10 10',
  'arc then line then close': 'M 0 0 A 10 10 0 0 1 10 10 L 0 10 Z',
};

const MATRICES: Record<string, AffineMatrix> = {
  identity: [1, 0, 0, 1, 0, 0],
  translation: [1, 0, 0, 1, 12.5, -7.25],
  'uniform scale': [2, 0, 0, 2, 0, 0],
  rotation: [Math.cos(0.5), Math.sin(0.5), -Math.sin(0.5), Math.cos(0.5), 3, 4],
  'non-uniform scale': [3, 0, 0, 0.5, 1, 1],
  'shear and scale': [1.5, 0.25, -0.75, 2, -3, 5],
  flip: [-1, 0, 0, 1, 10, 0],
  'rotation with flip': [0, 1, 1, 0, 0, 0],
  singular: [1, 1, 1, 1, 0, 0],
};

const ALL = { ...LINES, ...ARCS };

/** Split path data into command letters and numbers. */
const tokens = (d: string) => d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];

/** Expect equal path data: exact, or with numbers equal within a relative tolerance. */
function expectSamePath(actual: string, expected: string, d: string, tolerance: number) {
  if (tolerance === 0) {
    expect(actual).toBe(expected);
    return;
  }
  const a = tokens(actual);
  const e = tokens(expected);
  expect(a.length, `${actual}\n${expected}`).toBe(e.length);
  a.forEach((tok, i) => {
    const other = e[i] as string;
    const x = Number(tok);
    const y = Number(other);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      expect(tok, d).toBe(other);
    } else {
      expect(Math.abs(x - y), `${tok} vs ${other} in ${d}`).toBeLessThanOrEqual(
        tolerance * Math.max(1, Math.abs(y)),
      );
    }
  });
}

const toleranceFor = (name: string) => (name in ARCS ? 0 : 0);

const affine = (m: AffineMatrix) => new Affine(...m);

describe('parse and write match lib2geom', () => {
  it.each(Object.entries(ALL))('%s', (name, d) => {
    const pv = parse_svg_path(d);
    expectSamePath(write_svg_path(pv), geom.writePath(d, -1, false, true), d, toleranceFor(name));
  });

  describe.each([
    { precision: -1, optimize: true, shorthands: true },
    { precision: -1, optimize: false, shorthands: false },
    { precision: 3, optimize: false, shorthands: true },
    { precision: 5, optimize: true, shorthands: true },
    { precision: 2, optimize: true, shorthands: false },
  ])('writer options %j', ({ precision, optimize, shorthands }) => {
    it.each(Object.entries(ALL))('%s', (name, d) => {
      const pv = parse_svg_path(d);
      expectSamePath(
        write_svg_path(pv, precision, optimize, shorthands),
        geom.writePath(d, precision, optimize, shorthands),
        d,
        toleranceFor(name),
      );
    });
  });

  it('rounds like printf, half to even on the exact value', () => {
    const d = 'M 0.125 2.5 L 1.0625 100000 L 123456.5 0.00001234 L 99.96 0.5';
    for (const precision of [1, 2, 3, 4, 6]) {
      expect(write_svg_path(parse_svg_path(d), precision, false, true)).toBe(
        geom.writePath(d, precision, false, true),
      );
    }
  });
});

describe('transforms match lib2geom', () => {
  const cases = Object.entries(ALL).flatMap(([name, d]) =>
    Object.entries(MATRICES).map(([mname, m]) => ({ name: `${name} / ${mname}`, arcs: name in ARCS, d, m })),
  );

  it.each(cases)('$name: path data', ({ arcs, d, m }) => {
    const transformed = PathVector.transformed(parse_svg_path(d), affine(m));
    expectSamePath(write_svg_path(transformed), geom.transformPath(d, m), d, arcs ? 1e-12 : 0);
  });

  it.each(cases)('$name: bounds', ({ d, m }) => {
    const pv = parse_svg_path(d);
    const t = affine(m);
    for (const exact of [false, true]) {
      const expected = geom.pathBounds(d, exact, m);
      const r = exact
        ? PathVector.boundsExact(PathVector.transformed(pv, t))
        : PathVector.boundsFast(PathVector.transformed(pv, t));
      const actual = r ? [r.left(), r.top(), r.right(), r.bottom()] : [];
      expect(actual.length).toBe(expected.length);
      actual.forEach((v, i) => {
        expect(Math.abs(v - (expected[i] as number))).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(v)));
      });
    }
  });
});

describe('reversing matches lib2geom', () => {
  it.each(Object.entries(ALL))('%s', (name, d) => {
    expectSamePath(
      write_svg_path(PathVector.reversed(parse_svg_path(d))),
      geom.reversePath(d),
      d,
      toleranceFor(name),
    );
  });
});

describe('malformed data keeps the paths read so far, like sp_svg_read_pathv', () => {
  const BAD = [
    'M 0 0 L 10 10 L 20',
    'M 0 0 L 10 10 x',
    'M 0 0 L 10 10 L 20 20 L 30 30 x',
    'L 0 0',
    'M 0 0 10',
    'M 0 0 L 1 2 z 5',
    'M 0 0 C 1 2 3 4 5 6 7',
    'M 0 0 L 1 2 , M 3 4',
    'M 0 0 L 1 2 M 3 4 L 5 6 L 7 8 M 1 1 2',
    'M 0 0 A 1 1 0 2 0 1 1',
    'M 0 0 L 1 1 z L 2 2 1e',
    'M 0 0 l 1 1 l 2 2 ! 5 5',
    'M 0 0 L . 5',
    'M 0 0 L 1,,2',
    'M 0 0 a 1 1 0 0 1 5 5 a 1 1 011 3 3',
  ];

  it.each(BAD)('%s', (d) => {
    const expected = geom.readPath(d, 1e-6);
    expect(expected.ok).toBe(false);
    let error: unknown;
    try {
      parse_svg_path(d, { zSnapThreshold: 1e-6 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SVGPathParseError);
    expect(write_svg_path((error as SVGPathParseError).partial)).toBe(expected.d);
  });

  it('accepts what lib2geom accepts', () => {
    for (const d of Object.values(ALL)) {
      expect(geom.readPath(d, 1e-6).ok).toBe(true);
      expect(() => parse_svg_path(d)).not.toThrow();
    }
  });
});

describe('z snapping like Inkscape', () => {
  it('closes a nearly closed relative subpath exactly', () => {
    const d = 'm 0 0 l 10 0 l 0 10 l -10 -0.0000001 z';
    const expected = geom.readPath(d, 1e-6).d;
    expect(write_svg_path(parse_svg_path(d, { zSnapThreshold: 1e-6 }))).toBe(expected);
  });
});

describe('affine factories', () => {
  it('compose in the order of lib2geom: a.multiply(b) applies a first', () => {
    const d = 'M 1 2 L 3 4 L 5 -6 z';
    const m = Translate(5, 1).multiply(Rotate.from_degrees(30)).multiply(Scale(2, 3));
    const t = m.c0 === 0 ? m : m;
    const expected = geom.transformPath(d, [t.c0, t.c1, t.c2, t.c3, t.c4, t.c5]);
    expect(write_svg_path(PathVector.transformed(parse_svg_path(d), m))).toBe(expected);
  });
});
