// SPDX-License-Identifier: GPL-2.0-or-later
// Tests of the ported effects: the output geometry follows from the upstream math.
import { type PathVector, type Point, PathVector as PV } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { count_pathvector_nodes } from '../helper/geom.ts';
import type { SPShape } from '../object/sp-shape.ts';
import { setPathBoolopBackend } from '../path/path-boolop.ts';
import { Effect } from './effect.ts';

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
const bounds = (pv: PathVector) => {
  const r = PV.boundsExact(pv);
  return r && [r.left(), r.top(), r.right(), r.bottom()].map((v) => Math.round(v * 1000) / 1000);
};
const near = (a: Point, b: [number, number], eps = 1e-6) => {
  expect(a.x).toBeCloseTo(b[0], -Math.log10(eps));
  expect(a.y).toBeCloseTo(b[1], -Math.log10(eps));
};

describe('Mirror symmetry', () => {
  it('adds the mirror image across the line through start and end point', () => {
    const s = applied('M 0,0 L 10,0 L 10,10', 'mirror_symmetry', { start_point: '20,-5', end_point: '20,5' });
    const [orig, mirror] = curve(s);
    near(orig?.initialPoint() as Point, [0, 0]);
    // x' = 40 - x for the vertical line x = 20
    near(mirror?.initialPoint() as Point, [40, 0]);
    near(mirror?.finalPoint() as Point, [30, 10]);
  });

  it('places the default line on the right edge of the bounding box', () => {
    const s = applied('M 0,0 L 10,0 L 10,10', 'mirror_symmetry');
    const lpe = s.getCurrentLPE();
    expect(lpe?.getRepr()?.attribute('start_point')).toBe('10,0');
    expect(lpe?.getRepr()?.attribute('end_point')).toBe('10,10');
  });

  it('fuses the part on one side with its mirror image into one closed path', () => {
    // A square crossed by the vertical line x = 5: the left half and its mirror.
    const s = applied('M 0,0 H 10 V 10 H 0 Z', 'mirror_symmetry', {
      start_point: '5,0',
      end_point: '5,10',
      fuse_paths: 'true',
    });
    expect(curve(s)).toHaveLength(1);
    expect(bounds(curve(s))).toEqual([0, 0, 10, 10]);
    expect(curve(s)[0]?.closed()).toBe(true);
  });

  it('keeps only the mirror with discard_orig_path', () => {
    const s = applied('M 0,0 L 10,0', 'mirror_symmetry', {
      start_point: '0,5',
      end_point: '10,5',
      discard_orig_path: 'true',
    });
    expect(curve(s)).toHaveLength(1);
    expect(bounds(curve(s))).toEqual([0, 10, 10, 10]);
  });
});

describe('Rotate copies', () => {
  it('makes num_copies copies, 360°/n apart around the origin', () => {
    const s = applied('M 10,0 L 20,0', 'copy_rotate', {
      origin: '0,0',
      num_copies: '4',
      starting_angle: '0',
      copies_to_360: 'true',
    });
    const pv = curve(s);
    expect(pv).toHaveLength(4);
    // The start points lie on the circle of radius 10, 90° apart (SVG y axis points down).
    const starts = pv.map((p) => p.initialPoint());
    for (const p of starts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 6);
    near(starts[0] as Point, [10, 0]);
    near(starts[1] as Point, [0, -10]);
    near(starts[2] as Point, [-10, 0]);
    near(starts[3] as Point, [0, 10]);
  });

  it('uses rotation_angle when copies_to_360 is off', () => {
    const s = applied('M 10,0 L 20,0', 'copy_rotate', {
      origin: '0,0',
      num_copies: '3',
      rotation_angle: '30',
      copies_to_360: 'false',
    });
    const angles = curve(s).map((p) => (Math.atan2(-p.initialPoint().y, p.initialPoint().x) * 180) / Math.PI);
    expect(angles.map((a) => Math.round(a) + 0)).toEqual([0, 30, 60]);
  });
});

describe('Simplify', () => {
  it('reduces the nodes of a densely sampled curve', () => {
    const pts = Array.from({ length: 101 }, (_, i) => `${i},${(10 * Math.sin(i / 10)).toFixed(4)}`);
    const d = `M ${pts.join(' L ')}`;
    const s = applied(d, 'simplify', { threshold: '5', steps: '1' });
    const nodes = count_pathvector_nodes(curve(s));
    expect(nodes).toBeGreaterThan(1);
    expect(nodes).toBeLessThan(20);
    // The ends stay in place.
    near(curve(s)[0]?.initialPoint() as Point, [0, 0], 1e-3);
    near(curve(s)[0]?.finalPoint() as Point, [100, 10 * Math.sin(10)], 1e-3);
  });
});

describe('Roughen', () => {
  it('splits each segment by the number of segments and keeps displacements within bounds', () => {
    const s = applied('M 0,0 L 100,0', 'roughen', {
      method: 'segments',
      segments: '5',
      displace_x: '2;1',
      displace_y: '2;1',
      global_randomize: '1;1',
      handles: 'retract',
    });
    const pv = curve(s);
    expect(count_pathvector_nodes(pv)).toBe(6);
    for (const c of pv[0]?.curves() ?? []) expect(Math.abs(c.finalPoint().y)).toBeLessThanOrEqual(2);
  });

  it('gives the same result for the same seed', () => {
    const params = { method: 'segments', segments: '3', displace_x: '5;7', displace_y: '5;7' };
    const a = applied('M 0,0 L 30,0', 'roughen', params);
    const b = applied('M 0,0 L 30,0', 'roughen', params);
    expect(a.getAttribute('d')).toBe(b.getAttribute('d'));
  });
});

describe('Offset', () => {
  // The offset is in the unit parameter: millimeters by default (1 mm = 3.779 px).
  it('grows a square by the offset in all directions', () => {
    const s = applied('M 0,0 H 20 V 20 H 0 Z', 'offset', { offset: '1', linejoin_type: 'miter' });
    for (const [v, e] of (bounds(curve(s)) ?? []).map((v, i) => [v, [-3.78, -3.78, 23.78, 23.78][i] ?? 0])) {
      expect(v).toBeCloseTo(e as number, 2);
    }
  });

  it('shrinks it with a negative offset', () => {
    const s = applied('M 0,0 H 20 V 20 H 0 Z', 'offset', { offset: '-2', linejoin_type: 'miter' });
    // do_offset() approximates the inset (here within 0.01 px).
    for (const [v, e] of (bounds(curve(s)) ?? []).map((v, i) => [
      v,
      [7.559, 7.559, 12.441, 12.441][i] ?? 0,
    ])) {
      expect(v).toBeCloseTo(e as number, 1);
    }
  });
});

describe('Bend', () => {
  it('maps the path onto the bend path: x along its length, y along its normal', () => {
    // A 10 px wide, 2 px high box bent along a 20 px vertical line: it is stretched to the
    // length of the line and turned by 90°.
    const s = applied('M 0,-1 H 10 V 1 H 0 Z', 'bend_path', { bendpath: 'M 0,0 V 20', prop_scale: '1' });
    expect(bounds(curve(s))).toEqual([-1, 0, 1, 20]);
  });

  it('starts with a straight bend path through the middle of the bounding box', () => {
    const s = applied('M 0,0 H 10 V 4 H 0 Z', 'bend_path');
    expect(s.getCurrentLPE()?.getRepr()?.attribute('bendpath')).toBe('M 0,2 H 10');
    expect(bounds(curve(s))).toEqual([0, 0, 10, 4]);
  });
});
