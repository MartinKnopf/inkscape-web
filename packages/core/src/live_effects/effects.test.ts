// SPDX-License-Identifier: GPL-2.0-or-later
// Tests of the ported effects: the output geometry follows from the upstream math.
import { EllipticalArc, type Path, type PathVector, type Point, PathVector as PV } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { count_pathvector_nodes } from '../helper/geom.ts';
import { type NodeSatelliteType, nodeSatelliteTypeFromKey } from '../helper/geom-nodesatellite.ts';
import type { SPShape } from '../object/sp-shape.ts';
import { setPathBoolopBackend } from '../path/path-boolop.ts';
import { Effect } from './effect.ts';
import type { LPEFilletChamfer } from './lpe-fillet-chamfer.ts';
import type { LPEPowerStroke } from './lpe-powerstroke.ts';
import type { LPETaperStroke } from './lpe-taperstroke.ts';

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

describe('Corners', () => {
  const square = 'M 0,0 H 10 V 10 H 0 Z';
  const withRadius = (mode: string) => {
    const s = applied(square, 'fillet_chamfer');
    const lpe = s.getCurrentLPE() as LPEFilletChamfer;
    lpe.radius.param_set_from_widget(2);
    s.document.ensureUpToDate();
    if (mode !== 'F') {
      lpe.updateNodeSatelliteType(nodeSatelliteTypeFromKey(mode) as NodeSatelliteType);
      s.document.ensureUpToDate();
    }
    return s;
  };

  it('rounds each corner with an arc that starts at the knot distance', () => {
    const s = withRadius('F');
    const p = curve(s)[0];
    expect(p?.closed()).toBe(true);
    const arcs = p?.curves().filter((c) => c instanceof EllipticalArc) ?? [];
    expect(arcs).toHaveLength(4);
    // The fillet at (10,0) runs from (8,0) to (10,2) with radius 2.
    const arc = arcs.find((c) => c.initialPoint().x > 7 && c.initialPoint().y < 1) as EllipticalArc;
    near(arc.initialPoint(), [8, 0]);
    near(arc.finalPoint(), [10, 2]);
    near(arc.pointAt(0.5), [8 + 2 * Math.SQRT1_2, 2 - 2 * Math.SQRT1_2]);
    expect(bounds(curve(s))).toEqual([0, 0, 10, 10]);
  });

  it('cuts the corners with a chamfer line', () => {
    const s = withRadius('C');
    const p = curve(s)[0];
    expect(p?.curves().every((c) => c.isLineSegment())).toBe(true);
    expect(p?.size()).toBe(8);
    expect(s.getCurrentLPE()?.getRepr()?.attribute('nodesatellites_param')).toBe(
      'C,0,0,1,0,2,100,1 @ C,0,0,1,0,2,100,1 @ C,0,0,1,0,2,100,1 @ C,0,0,1,0,2,100,1',
    );
  });
});

describe('Taper stroke', () => {
  it('draws the stroke as a filled outline that narrows to the ends', () => {
    const s = applied('M 0,0 H 100', 'taper_stroke', {}, 'fill:none;stroke:#ff0000;stroke-width:4');
    const pv = curve(s);
    expect(pv).toHaveLength(1);
    expect(pv[0]?.closed()).toBe(true);
    // Full width in the middle, tips at the ends.
    expect(bounds(pv)).toEqual([0, -2, 100, 2]);
    // The stroke became the fill.
    expect(s.getAttribute('style')).toContain('fill:#ff0000');
    expect(s.getAttribute('style')).toContain('stroke:none');
    expect(s.getCurrentLPE()?.getRepr()?.attribute('stroke_width')).toBe('4');
  });

  it('places the taper knots at the attach times', () => {
    const s = applied('M 0,0 H 100', 'taper_stroke', {}, 'stroke:#000;stroke-width:4');
    const lpe = s.getCurrentLPE() as LPETaperStroke;
    near(lpe.start_attach_point[0] as Point, [20, 0]);
    near(lpe.end_attach_point[0] as Point, [80, 0]);
  });
});

describe('Envelope Deformation', () => {
  it('starts with the sides of the bounding box, which keep the path', () => {
    const s = applied('M 0,0 H 10 V 10 H 0 Z', 'envelope');
    expect(s.getCurrentLPE()?.getRepr()?.attribute('bendpath1')).toBe('M 0,0 H 10');
    expect(bounds(curve(s))).toEqual([0, 0, 10, 10]);
  });

  it('follows a moved side', () => {
    const s = applied('M 0,0 H 10 V 10 H 0 Z', 'envelope', { xx: 'false', bendpath1: 'M 0,-5 H 10' });
    // Only the top and bottom paths: the top edge moves up by 5.
    expect(bounds(curve(s))).toEqual([0, -5, 10, 10]);
  });
});

describe('Pattern Along Path', () => {
  const pattern = 'M 0,-1 H 10 V 1 H 0 Z';

  it('stretches a single copy of the pattern along the path', () => {
    const s = applied('M 0,0 H 100', 'skeletal', { pattern });
    expect(curve(s)).toHaveLength(1);
    expect(bounds(curve(s))).toEqual([0, -1, 100, 1]);
  });

  it('repeats the pattern as many times as it fits', () => {
    const s = applied('M 0,0 H 100', 'skeletal', { pattern, copytype: 'repeated' });
    expect(curve(s)).toHaveLength(10);
  });

  it('uses a linked path as pattern and follows its changes', () => {
    const doc = SPDocument.createNewDocFromMem(
      `<svg xmlns="http://www.w3.org/2000/svg" ${NS}><defs/><path id="pat" d="${pattern}"/><path id="p" d="M 0,0 H 100"/></svg>`,
    ) as SPDocument;
    doc.ensureUpToDate();
    const s = doc.getObjectById('p') as SPShape;
    Effect.createAndApply('skeletal', doc, s);
    s.getCurrentLPE()?.getRepr()?.setAttribute('pattern', '#pat');
    doc.ensureUpToDate();
    expect(bounds(curve(s))).toEqual([0, -1, 100, 1]);
    doc.getObjectById('pat')?.setAttribute('d', 'M 0,-3 H 10 V 3 H 0 Z');
    doc.ensureUpToDate();
    expect(bounds(curve(s))).toEqual([0, -3, 100, 3]);
  });
});

describe('Perspective/Envelope', () => {
  for (const deform_type of ['perspective', 'envelope_deformation']) {
    it(`maps the corners of the bounding box to the handles (${deform_type})`, () => {
      const s = applied('M 0,0 H 10 V 10 H 0 Z', 'perspective-envelope', {
        deform_type,
        up_left_point: '0,0',
        up_right_point: '12,-2',
        down_left_point: '0,10',
        down_right_point: '10,10',
      });
      const p = curve(s)[0] as Path;
      const nodes = p.curves().map((c) => c.initialPoint());
      near(nodes[0] as Point, [0, 0], 1e-6);
      near(nodes[1] as Point, [12, -2], 1e-6);
      near(nodes[2] as Point, [10, 10], 1e-6);
      near(nodes[3] as Point, [0, 10], 1e-6);
    });
  }
});

describe('Spiro spline', () => {
  it('runs a spline through the nodes of the path', () => {
    const s = applied('M 0,0 C 0,5 5,10 10,10 C 15,10 20,5 20,0', 'spiro');
    const pv = curve(s);
    expect(pv).toHaveLength(1);
    near(pv[0]?.initialPoint() as Point, [0, 0]);
    near(pv[0]?.finalPoint() as Point, [20, 0]);
    // The spline is symmetric and has its top at the smooth node.
    expect(bounds(pv)).toEqual([0, 0, 20, 10]);
  });

  it('keeps corners: a polygon stays the same', () => {
    const s = applied('M 0,0 H 10 V 10 H 0 Z', 'spiro');
    expect(bounds(curve(s))).toEqual([0, 0, 10, 10]);
    expect(curve(s)[0]?.closed()).toBe(true);
  });
});

describe('BSpline', () => {
  it('moves each inner node to the middle of its handles', () => {
    const s = applied('M 0,0 C 4,0 6,0 10,0 C 10,4 10,6 10,10', 'bspline');
    const p = curve(s)[0] as Path;
    expect(p.size()).toBe(2);
    near(p.initialPoint(), [0, 0]);
    near(p.at(0).finalPoint(), [8, 2]);
    near(p.finalPoint(), [10, 10]);
  });
});

describe('Power stroke', () => {
  it('draws a filled outline with the width of the stroke', () => {
    const s = applied('M 0,0 H 100', 'powerstroke', {}, 'fill:none;stroke:#000000;stroke-width:10');
    const lpe = s.getCurrentLPE() as LPEPowerStroke;
    expect(lpe.offset_points.data().map((p) => [p.x, p.y])).toEqual([
      [0.2, 5],
      [0.5, 5],
      [0.8, 5],
    ]);
    const [x0, y0, x1, y1] = bounds(curve(s)) as number[];
    expect(x0).toBeCloseTo(0, 3);
    expect(x1).toBeCloseTo(100, 3);
    expect(y0).toBeCloseTo(-5, 0);
    expect(y1).toBeCloseTo(5, 0);
    expect(s.getRepr().attribute('style')).toContain('fill:#000000');
  });

  it('places the knots at the width points', () => {
    const s = applied('M 0,0 H 100', 'powerstroke', { offset_points: '0.5,8' });
    const lpe = s.getCurrentLPE() as LPEPowerStroke;
    near(lpe.offset_points.knot_get(0), [50, 8]);
  });
});

describe('Clone original', () => {
  /** A document with the original "o" and a path "q" that clones it with the given method. */
  function cloneOf(method: string, attributes = '', css_properties = '') {
    const doc = SPDocument.createNewDocFromMem(
      `<svg xmlns="http://www.w3.org/2000/svg" ${NS}><defs/>
       <rect id="o" x="10" y="20" width="30" height="40" style="fill:#ff0000;stroke:#0000ff"/>
       <path id="q" d="M 0,0 H 1" style="fill:#00ff00"/></svg>`,
    );
    if (!doc) throw new Error('parse failed');
    doc.ensureUpToDate();
    const q = doc.getObjectById('q') as SPShape;
    Effect.createAndApply('clone_original', doc, q);
    const repr = q.getCurrentLPE()?.getRepr();
    repr?.setAttribute('method', method);
    repr?.setAttribute('attributes', attributes);
    repr?.setAttribute('css_properties', css_properties);
    repr?.setAttribute('linkeditem', '#o');
    doc.ensureUpToDate();
    return { doc, q };
  }

  it('takes the shape of the linked item', () => {
    const { q } = cloneOf('d');
    expect(bounds(curve(q))).toEqual([10, 20, 40, 60]);
  });

  it('copies the style when it links, then the chosen style properties', () => {
    const { doc, q } = cloneOf('d', '', 'stroke');
    expect(q.getAttribute('style')).toBe('fill:#ff0000;stroke:#0000ff');
    const o = doc.getObjectById('o');
    o?.setAttribute('style', 'fill:#ffff00;stroke:#00ffff');
    doc.ensureUpToDate();
    expect(q.getAttribute('style')).toBe('fill:#ff0000;stroke:#00ffff');
  });

  it('keeps its own shape with "Transformation Only"', () => {
    const { q } = cloneOf('none');
    expect(bounds(curve(q))).toEqual([0, 0, 1, 0]);
  });
});

describe('Fill between many', () => {
  it('joins the linked paths to a closed path', () => {
    const doc = SPDocument.createNewDocFromMem(
      `<svg xmlns="http://www.w3.org/2000/svg" ${NS}><defs/>
       <path id="a" d="M 0,0 H 10"/><path id="b" d="M 0,10 H 10"/><path id="f" d="M 0,0"/></svg>`,
    );
    if (!doc) throw new Error('parse failed');
    doc.ensureUpToDate();
    const f = doc.getObjectById('f') as SPShape;
    Effect.createAndApply('fill_between_many', doc, f);
    f.getCurrentLPE()?.getRepr()?.setAttribute('linkedpaths', '#a,0,1|#b,0,1');
    doc.ensureUpToDate();
    const p = curve(f)[0] as Path;
    expect(p.closed()).toBe(true);
    expect(bounds(curve(f))).toEqual([0, 0, 10, 10]);
    // a, the line to the end of b, b reversed; the closing segment goes back to the start
    expect(p.openCurves().map((c) => [c.finalPoint().x, c.finalPoint().y])).toEqual([
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });
});

describe('Interpolate Sub-Paths', () => {
  it('blends the first subpath into the second along the trajectory', () => {
    // resetDefaults() sets the trajectory from the middle of the first to the middle of the second subpath.
    const s = applied('M 0,0 H 10 M 0,20 H 20', 'interpolate', { steps: '3' });
    const pv = curve(s);
    expect(pv).toHaveLength(3);
    expect(bounds([pv[0] as Path])).toEqual([0, 0, 10, 0]);
    expect(bounds([pv[1] as Path])).toEqual([0, 10, 15, 10]);
    expect(bounds([pv[2] as Path])).toEqual([0, 20, 20, 20]);
  });
});

describe('Sketch', () => {
  it('draws strokes and construction lines, the same ones each time', () => {
    const s = applied('M 0,0 C 100,-100 200,100 300,0', 'sketch');
    const first = s.getAttribute('d');
    // 5 strokes along the path (each split into pieces) and 5 construction lines
    expect(curve(s).length).toBeGreaterThan(10);
    s.getCurrentLPE()?.getRepr()?.setAttribute('nbtangents', '5');
    s.document.ensureUpToDate();
    expect(s.getAttribute('d')).toBe(first);
  });
});

describe('Join type', () => {
  it('turns the stroke into a filled outline', () => {
    const s = applied('M 0,0 H 100', 'join_type', {}, 'fill:none;stroke:#000000;stroke-width:10');
    expect(bounds(curve(s))).toEqual([0, -5, 100, 5]);
    expect(s.getRepr().attribute('style')).toContain('fill:#000000');
  });
});

describe('Dashed Stroke', () => {
  it('cuts the path into dashes with half dashes at the ends', () => {
    const s = applied('M 0,0 H 100', 'dashed_stroke', { unifysegment: 'false' });
    expect(curve(s).map((p) => [p.initialPoint().x, p.finalPoint().x])).toEqual([
      [0, 12.5],
      [37.5, 62.5],
      [87.5, 100],
    ]);
    // The WASM code takes about 3.5 s here (it throws and catches an exception).
  }, 20000);
});

describe('Show handles', () => {
  it('draws the path, its nodes and its handles', () => {
    const s = applied('M 0,0 C 0,10 10,10 10,0', 'show_handles');
    // the path, 2 nodes, 2 handles with their lines
    expect(curve(s)).toHaveLength(7);
    expect(s.getAttribute('style')).toContain('stroke:black');
  });
});

describe('Bounding Box', () => {
  it('is the bounding box of the linked item', () => {
    const doc = SPDocument.createNewDocFromMem(
      `<svg xmlns="http://www.w3.org/2000/svg" ${NS}><defs/>
       <path id="o" d="M 10,20 C 20,0 30,40 40,20"/><path id="b" d="M 0,0 H 1"/></svg>`,
    );
    if (!doc) throw new Error('parse failed');
    doc.ensureUpToDate();
    const b = doc.getObjectById('b') as SPShape;
    Effect.createAndApply('bounding_box', doc, b);
    b.getCurrentLPE()?.getRepr()?.setAttribute('linkedpath', '#o');
    doc.ensureUpToDate();
    expect(bounds(curve(b))).toEqual([10, 14.226, 40, 25.774]);
    expect(curve(b)[0]?.closed()).toBe(true);
  });
});
