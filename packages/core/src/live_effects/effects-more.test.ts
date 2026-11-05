// SPDX-License-Identifier: GPL-2.0-or-later
// Tests of more ported effects (Gears, Knot, Lattice, Extrude, ...); the upstream test files
// (lpe-files.test.ts) check most of them against Inkscape's output.
import { Affine, type PathVector, type Point, PathVector as PV } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import type { SPShape } from '../object/sp-shape.ts';
import { setPathBoolopBackend } from '../path/path-boolop.ts';
import { Effect } from './effect.ts';
import type { LPEExtrude } from './lpe-extrude.ts';
import type { LPEKnot } from './lpe-knot.ts';

setPathBoolopBackend(await loadGeom());
SPDocument.scheduleIdle = () => {};

const NS = 'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';

/** A document with one path "p", the effect key applied with params; returns the shape. */
function applied(d: string, key: string, params: Record<string, string> = {}, style = ''): SPShape {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" ${NS}><defs/><path id="p" d="${d}" style="${style}"/></svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const shape = doc.getObjectById('p') as SPShape;
  Effect.createAndApply(key, doc, shape);
  const repr = shape.getCurrentLPE()?.getRepr();
  for (const [k, v] of Object.entries(params)) repr?.setAttribute(k, v);
  doc.ensureUpToDate();
  return shape;
}

const curve = (s: SPShape): PathVector => s.curve() ?? [];
const bounds = (pv: PathVector, digits = 3) => {
  const r = PV.boundsExact(pv);
  const f = 10 ** digits;
  return r && [r.left(), r.top(), r.right(), r.bottom()].map((v) => Math.round(v * f) / f);
};

describe('Vector parameter', () => {
  it('reads and writes the origin and the vector', () => {
    const s = applied('M 0,0 H 10', 'extrude', { extrude_vector: '1,2 , 3,4' });
    const v = (s.getCurrentLPE() as LPEExtrude).extrude_vector;
    expect([v.getOrigin().x, v.getOrigin().y, v.getVector().x, v.getVector().y]).toEqual([1, 2, 3, 4]);
    v.param_transform_multiply(new Affine(2, 0, 0, 2, 5, 5), false);
    expect(v.param_getSVGValue()).toBe('7,9 , 6,8');
  });
});

describe('Extrude', () => {
  it('makes a closed face between the path and its moved copy', () => {
    const s = applied('M 0,0 H 10', 'extrude', { extrude_vector: '0,0 , 0,10' });
    expect(curve(s)).toHaveLength(1);
    expect(
      curve(s)[0]?.closed() ||
        curve(s)[0]
          ?.initialPoint()
          .equals(curve(s)[0]?.finalPoint() as Point),
    ).toBe(true);
    expect(bounds(curve(s))).toEqual([0, 0, 10, 10]);
  });

  it('starts with a vector from the size of the bounding box', () => {
    const s = applied('M 0,0 H 10 V 20', 'extrude');
    expect(s.getCurrentLPE()?.getRepr()?.attribute('extrude_vector')).toBe('5,10 , -1.5,6');
  });
});

describe('Gears', () => {
  it('draws a gear around the end of the first segment, sized by the second', () => {
    // centre (0,0), pitch radius 50: 10 teeth of module 2πR/10, addendum = pitch diameter / teeth = 10
    const s = applied('M 10,0 L 0,0 L 0,50', 'gears', { teeth: '10', phi: '20' });
    expect(curve(s)).toHaveLength(1);
    const [x0, y0, x1, y1] = bounds(curve(s), 0) as number[];
    expect(Math.max(-(x0 as number), x1 as number, -(y0 as number), y1 as number)).toBeCloseTo(60, 0);
  });

  it('adds a meshing gear for each further node', () => {
    const s = applied('M 10,0 L 0,0 L 0,50 L 0,150', 'gears', { teeth: '10' });
    expect(curve(s)).toHaveLength(2);
  });
});

describe('Knot', () => {
  const X = 'M 0,0 L 10,10 M 0,10 L 10,0';

  it('cuts a gap into the lower string at a crossing', () => {
    const s = applied(
      X,
      'knot',
      { interruption_width: '2', prop_to_stroke_width: 'false' },
      'stroke-width:1',
    );
    const lpe = s.getCurrentLPE() as LPEKnot;
    expect(lpe.crossing_points).toHaveLength(1);
    near(lpe.crossing_points[0]?.pt as Point, [5, 5]);
    // one string stays whole, the other is cut in two
    expect(curve(s)).toHaveLength(3);
  });

  it('keeps both strings whole at a flat crossing (sign 0)', () => {
    const s = applied(X, 'knot', { prop_to_stroke_width: 'false' });
    const v = s.getCurrentLPE()?.getRepr();
    const lpe = s.getCurrentLPE() as LPEKnot;
    const flat = [...lpe.crossing_points_vector.data()];
    flat[8] = 0;
    v?.setAttribute('crossing_points_vector', flat.join(' | '));
    s.document.ensureUpToDate();
    expect(curve(s)).toHaveLength(2);
  });
});

describe('Lattice Deformation Legacy', () => {
  it('keeps the path with the default grid and moves it with a control point', () => {
    const s = applied('M 0,0 H 30 V 30 H 0 Z', 'lattice');
    expect(bounds(curve(s))).toEqual([0, 0, 30, 30]);
    s.getCurrentLPE()?.getRepr()?.setAttribute('gridpoint3', '60,30');
    s.document.ensureUpToDate();
    expect(bounds(curve(s))?.[2]).toBeGreaterThan(30);
  });
});

describe('Recursive skeleton', () => {
  it('places a straight path along itself unchanged', () => {
    const s = applied('M 0,0 L 100,0', 'recursive_skeleton', { iterations: '1' });
    expect(bounds(curve(s))).toEqual([0, 0, 100, 0]);
  });
});

describe('Dynamic stroke', () => {
  it('draws a closed outline around the path that is thin at the ends', () => {
    const s = applied('M 0,0 H 100', 'dynastroke', { roundness: '1', width: '10' });
    const [x0, y0, x1, y1] = bounds(curve(s)) as number[];
    expect([x0, x1]).toEqual([0, 100]);
    expect(y1).toBeGreaterThan(0);
    expect(y0).toBeCloseTo(-(y1 as number), 3);
    expect(curve(s)[0]?.initialPoint().y).toBeCloseTo(0, 6);
  });
});

describe('Embroidery stitch', () => {
  it('divides the subpaths into stitches and connects them', () => {
    const s = applied('M 0,0 H 20 M 20,10 H 0', 'embrodery_stitch', { 'stitch-length': '10' });
    expect(curve(s)).toHaveLength(1);
    const nodes = curve(s)[0]
      ?.curves()
      .map((c) => [c.finalPoint().x, c.finalPoint().y]);
    expect(nodes).toEqual([
      [10, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [0, 10],
    ]);
  });

  it('leaves gaps between the stitches with show-stitches', () => {
    const s = applied('M 0,0 H 20 M 20,10 H 0', 'embrodery_stitch', {
      'stitch-length': '10',
      'show-stitches': 'true',
    });
    expect(curve(s)).toHaveLength(5);
  });
});

describe('doEffect stack test', () => {
  it('returns the path at step 0 and passes it through the pwd2 stage at step 2', () => {
    for (const step of ['0', '2']) {
      const s = applied('M 0,0 L 10,0 L 10,10', 'doeffectstacktest', { step });
      expect(bounds(curve(s))).toEqual([0, 0, 10, 10]);
    }
  });
});

describe('Hatches (rough)', () => {
  it('fills the shape with hatches inside its bounding box', () => {
    const s = applied('M 0,0 H 100 V 100 H 0 Z', 'rough_hatches');
    expect(curve(s).length).toBeGreaterThan(0);
    const [x0, , x1] = bounds(curve(s)) as number[];
    expect(x0).toBeGreaterThanOrEqual(-5);
    expect(x1).toBeLessThanOrEqual(105);
  });
});

function near(a: Point, b: [number, number], eps = 1e-6) {
  expect(a.x).toBeCloseTo(b[0], -Math.log10(eps));
  expect(a.y).toBeCloseTo(b[1], -Math.log10(eps));
}
