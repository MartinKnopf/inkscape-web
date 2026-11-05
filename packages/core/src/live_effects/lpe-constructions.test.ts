// SPDX-License-Identifier: GPL-2.0-or-later
// Tests of the construction and measuring effects: the output follows from the upstream math
// (lpe-angle_bisector.cpp, lpe-parallel.cpp, ...).
import {
  type Path,
  type PathVector,
  type Point,
  PathVector as PV,
  pathv_nearest_time,
  pathv_point_at,
} from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import type { SPShape } from '../object/sp-shape.ts';
import { SPText } from '../object/sp-text.ts';
import { setPathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import type { LPEPathLength } from './lpe-path_length.ts';
import type { LPETextLabel } from './lpe-text_label.ts';

setPathBoolopBackend(await loadGeom());
SPDocument.scheduleIdle = () => {};

const NS = 'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';

/** A document with a path "p" (and the root attributes), the effect key applied with params; returns the shape. */
function applied(
  d: string,
  key: string,
  params: Record<string, string> = {},
  root = '',
  beforeParams: (lpe: Effect | null) => void = () => {},
): SPShape {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" ${NS} ${root}><defs/><path id="p" d="${d}"/></svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const shape = doc.getObjectById('p') as SPShape;
  Effect.createAndApply(key, doc, shape);
  const repr = shape.getCurrentLPE()?.getRepr();
  beforeParams(shape.getCurrentLPE());
  for (const [k, v] of Object.entries(params)) repr?.setAttribute(k, v);
  doc.ensureUpToDate();
  return shape;
}

const curve = (s: SPShape): PathVector => s.curve() ?? [];
const bounds = (pv: PathVector) => {
  const r = PV.boundsExact(pv);
  return r && [r.left(), r.top(), r.right(), r.bottom()];
};
const near = (a: Point, b: [number, number], digits = 6) => {
  expect(a.x).toBeCloseTo(b[0], digits);
  expect(a.y).toBeCloseTo(b[1], digits);
};
const expectBounds = (pv: PathVector, e: number[], digits = 3) => {
  const b = bounds(pv);
  expect(b).not.toBeNull();
  for (const [i, v] of (b ?? []).entries()) expect(v).toBeCloseTo(e[i] as number, digits);
};
/** The nodes of the first path: its initial point and the end of each curve. */
const nodes = (s: SPShape): Point[] => {
  const p = curve(s)[0] as Path;
  return [p.initialPoint(), ...p.curves().map((c) => c.finalPoint())];
};

describe('Angle bisector', () => {
  it('halves the angle at the second node, from "length left" to "length right"', () => {
    const s = applied('M 0,0 L 10,0 L 10,10', 'angle_bisector');
    const [a, b] = nodes(s);
    // The corner is at (10,0); the bisector points to the upper left, 250 long to the right end.
    near(a as Point, [10, 0]);
    near(b as Point, [10 - 250 * Math.SQRT1_2, 250 * Math.SQRT1_2]);
  });

  it('extends the left end the other way', () => {
    const s = applied('M 0,0 L 10,0 L 10,10', 'angle_bisector', {
      'length-left': '10',
      'length-right': '20',
    });
    const [a, b] = nodes(s);
    near(a as Point, [10 + 10 * Math.SQRT1_2, -10 * Math.SQRT1_2]);
    near(b as Point, [10 - 20 * Math.SQRT1_2, 20 * Math.SQRT1_2]);
  });
});

describe('Circle by 3 points', () => {
  it('draws the circle through the first three nodes', () => {
    const s = applied('M 0,0 L 10,0 L 10,10', 'circle_3pts');
    const r = 5 * Math.SQRT2;
    expectBounds(curve(s), [5 - r, 5 - r, 5 + r, 5 + r]);
    expect(curve(s)[0]?.closed()).toBe(true);
  });
});

describe('Circle', () => {
  it('draws the circle around the first node through the last node', () => {
    const s = applied('M 10,10 L 13,14', 'circle_with_radius');
    expectBounds(curve(s), [5, 5, 15, 15]);
  });
});

describe('Ellipse by 5 points', () => {
  it('draws the ellipse that passes the first 5 nodes', () => {
    // An ellipse around (50,40) with the half axes 30 and 20, rotated by 20°.
    const rot = (20 * Math.PI) / 180;
    const pts = [0, 1, 2, 3, 4].map((i) => {
      const t = 0.5 + i * 1.1;
      const x = 30 * Math.cos(t);
      const y = 20 * Math.sin(t);
      return [50 + x * Math.cos(rot) - y * Math.sin(rot), 40 + x * Math.sin(rot) + y * Math.cos(rot)];
    });
    const s = applied(`M ${pts.map((p) => p.join(',')).join(' L ')}`, 'ellipse_5pts');
    const pv = curve(s);
    expect(pv).toHaveLength(1);
    // The bounding box of the rotated ellipse.
    const hw = Math.hypot(30 * Math.cos(rot), 20 * Math.sin(rot));
    const hh = Math.hypot(30 * Math.sin(rot), 20 * Math.cos(rot));
    expectBounds(pv, [50 - hw, 40 - hh, 50 + hw, 40 + hh]);
  });

  it('keeps the path when there are less than 5 nodes', () => {
    const s = applied('M 0,0 L 10,0 L 10,10 L 0,10', 'ellipse_5pts');
    expect(nodes(s).map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });
});

describe('Line segment', () => {
  const page = 'width="100" height="100"';

  it('cuts the line through the first and last node at the page', () => {
    const s = applied('M 10,20 L 30,40', 'line_segment', {}, page);
    const [a, b] = nodes(s);
    // The line y = x + 10 enters the page at (0,10) and leaves it at (90,100).
    near(a as Point, [0, 10]);
    near(b as Point, [90, 100]);
  });

  it('keeps the end that is closed', () => {
    const s = applied('M 10,20 L 30,40', 'line_segment', { end_type: 'open_start' }, page);
    const [a, b] = nodes(s);
    near(a as Point, [0, 10]);
    near(b as Point, [30, 40]);
  });

  it('handles a vertical line', () => {
    const s = applied('M 50,20 L 50,40', 'line_segment', {}, page);
    const [a, b] = nodes(s);
    near(a as Point, [50, 0]);
    near(b as Point, [50, 100]);
  });
});

describe('Parallel', () => {
  it('starts 100 away from the middle of the path, in the normal direction', () => {
    const s = applied('M 0,0 L 10,0', 'parallel');
    expect(s.getCurrentLPE()?.getRepr()?.attribute('offset_pt')).toBe('5,-100');
    const [a, b] = nodes(s);
    // From offset - dir * 150 to offset + dir * 150, both moved by dir (upstream: output + dir).
    near(a as Point, [-144, -100]);
    near(b as Point, [156, -100]);
  });

  it('follows the length and the offset parameters', () => {
    const s = applied('M 0,0 L 0,10', 'parallel', {
      offset_pt: '20,5',
      'length-left': '1',
      'length-right': '2',
    });
    const [a, b] = nodes(s);
    // dir = (0,1)
    near(a as Point, [20, 5]);
    near(b as Point, [20, 8]);
  });
});

describe('Perpendicular bisector', () => {
  it('draws the line through the middle that is perpendicular to the path', () => {
    const s = applied('M 0,0 L 10,0', 'perp_bisector');
    const [a, b] = nodes(s);
    near(a as Point, [5, -200]);
    near(b as Point, [5, 200]);
  });

  it('uses start and end of a path with more nodes', () => {
    const s = applied('M 0,0 L 5,7 L 0,10', 'perp_bisector', { 'length-left': '3', 'length-right': '1' });
    const [a, b] = nodes(s);
    // From (0,0) to (0,10): the middle is (0,5), perp_dir = (1,0)... away from the left: ccw((0,10)) = (10,0)
    near(a as Point, [3, 5]);
    near(b as Point, [-1, 5]);
  });
});

describe('Tangent to curve', () => {
  const corner = 'M 0,0 L 10,0 L 10,10';

  it('touches the curve at the location, along its direction', () => {
    // t = 1.5 is in the middle of the second segment, which goes down.
    const s = applied(corner, 'tangent_to_curve', { t_attach: '1.5' });
    const [a, b] = nodes(s);
    near(a as Point, [10, 5 - 150]);
    near(b as Point, [10, 5 + 150]);
  });

  it('turns by the angle (clockwise for positive angles)', () => {
    const s = applied(corner, 'tangent_to_curve', { t_attach: '1.5', angle: '90', 'length-left': '10' });
    const [a, b] = nodes(s);
    near(a as Point, [0, 5]);
    near(b as Point, [160, 5]);
  });
});

describe('Transform by 2 points', () => {
  it('starts with the points of the first and last node and changes nothing', () => {
    const s = applied('M 0,0 L 10,0 L 10,10', 'transform_2pts');
    const lpe = s.getCurrentLPE();
    expect(lpe?.getRepr()?.attribute('start')).toBe('0,0');
    expect(lpe?.getRepr()?.attribute('end')).toBe('10,10');
    expect(lpe?.getRepr()?.attribute('last_knot')).toBe('3');
    const [a, b, c] = nodes(s);
    near(a as Point, [0, 0]);
    near(b as Point, [10, 0]);
    near(c as Point, [10, 10]);
  });

  it('scales and rotates the path so that the nodes get to the points', () => {
    // The end point moves from (10,10) to (20,0): scaled by sqrt(2), rotated by -45°.
    const s = applied('M 0,0 L 10,0 L 10,10', 'transform_2pts', { end: '20,0' });
    const [a, b, c] = nodes(s);
    near(a as Point, [0, 0]);
    near(b as Point, [10, -10]);
    near(c as Point, [20, 0]);
  });

  it('moves the path with the start point and flips it', () => {
    const s = applied('M 0,0 L 10,0 L 10,10', 'transform_2pts', {
      start: '5,5',
      end: '15,15',
      flip_horizontal: 'true',
    });
    // Flipped along the line through both points: the first node goes to the end point.
    const [a, b, c] = nodes(s);
    near(a as Point, [15, 15]);
    near(b as Point, [15, 5]);
    near(c as Point, [5, 5]);
  });
});

describe('Ellipse from points', () => {
  it('fits a circle to 3 nodes', () => {
    const s = applied('M 0,0 L 10,0 L 10,10', 'pts2ellipse');
    const r = 5 * Math.SQRT2;
    expectBounds(curve(s), [5 - r, 5 - r, 5 + r, 5 + r], 1); // Bezier curves approximate the circle
  });

  it('fits an ellipse to 5 nodes', () => {
    const pts = [0, 1, 2, 3, 4].map((i) => {
      const t = 0.3 + i * 1.2;
      return [50 + 30 * Math.cos(t), 40 + 20 * Math.sin(t)];
    });
    const s = applied(`M ${pts.map((p) => p.join(',')).join(' L ')}`, 'pts2ellipse');
    expectBounds(curve(s), [20, 20, 80, 60], 1);
  });

  it('draws an arc from the first to the last node', () => {
    // A quarter of the circle around (0,0) with radius 10, as the nodes go counter clockwise on the screen.
    const s = applied('M 10,0 L 7.0710678,-7.0710678 L 0,-10', 'pts2ellipse', { gen_arc: 'true' });
    const pv = curve(s);
    expect(pv).toHaveLength(1);
    expect(pv[0]?.closed()).toBe(false);
    expectBounds(pv, [0, -10, 10, 0], 1);
    const ends = [pv[0]?.initialPoint(), pv[0]?.finalPoint()] as Point[];
    const sorted = [...ends].sort((p, q) => q.x - p.x);
    near(sorted[0] as Point, [10, 0], 5);
    near(sorted[1] as Point, [0, -10], 5);
  });

  it('draws the Steiner inellipse through the middle of the sides of the triangle', () => {
    const s = applied('M 0,0 L 6,0 L 0,6', 'pts2ellipse', { method: 'steiner_inellipse' });
    const pv = curve(s);
    for (const m of [
      [3, 0],
      [3, 3],
      [0, 3],
    ] as const) {
      const point = { x: m[0], y: m[1] } as Point;
      const t = pathv_nearest_time(pv, point);
      const q = pathv_point_at(pv, t as NonNullable<typeof t>);
      expect(Math.hypot(q.x - point.x, q.y - point.y)).toBeLessThan(5e-3);
    }
  });

  it('adds the source path', () => {
    const s = applied('M 0,0 L 10,0 L 10,10', 'pts2ellipse', { draw_ori_path: 'true' });
    expect(curve(s)).toHaveLength(2);
  });
});

describe('Path length', () => {
  it('shows the length with the unit and does not change the path', () => {
    const s = applied('M 0,0 L 30,40', 'path_length');
    const lpe = s.getCurrentLPE() as LPEPathLength;
    expect(lpe.info_text.get_value()).toBe('50.00 px');
    expect(nodes(s).map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [30, 40],
    ]);
    // Above the middle of the path, 10 away from it, facing it.
    const text = lpe.info_text.canvasText();
    near(text?.pos as Point, [15 + 10 * 0.8, 20 - 10 * 0.6], 1);
  });

  it('scales the length and converts it to the unit', () => {
    const s = applied('M 0,0 L 30,40', 'path_length', { scale: '2', unit: 'in' });
    const lpe = s.getCurrentLPE() as LPEPathLength;
    expect(lpe.info_text.get_value()).toBe('1.04 in');
  });
});

describe('Text label', () => {
  it('puts the label 30 from the middle of the path', () => {
    const s = applied('M 0,0 L 40,0', 'text_label');
    const lpe = s.getCurrentLPE() as LPETextLabel;
    const text = lpe.label.canvasText();
    expect(text?.text).toBe('This is a label');
    near(text?.pos as Point, [20, -30]);
    near(text?.anchor as Point, [0, -1]);
    expect(nodes(s).map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [40, 0],
    ]);
  });
});

describe('Construct grid', () => {
  it('makes the grid from the three nodes, the second is the origin', () => {
    const s = applied('M 10,0 L 0,0 L 0,10', 'construct_grid', { nr_x: '2', nr_y: '3' });
    const pv = curve(s);
    // 1 + 2 lines in the first direction, 1 + 3 in the second.
    expect(pv).toHaveLength(7);
    const ends = pv.map((p) => [p.initialPoint(), p.finalPoint()].map((q) => [q.x, q.y]));
    expect(ends).toEqual([
      [
        [0, 0],
        [30, 0],
      ],
      [
        [0, 10],
        [30, 10],
      ],
      [
        [0, 20],
        [30, 20],
      ],
      [
        [0, 0],
        [0, 20],
      ],
      [
        [10, 0],
        [10, 20],
      ],
      [
        [20, 0],
        [20, 20],
      ],
      [
        [30, 0],
        [30, 20],
      ],
    ]);
  });
});

describe('Interpolate points', () => {
  it('keeps the nodes with the linear interpolator', () => {
    const s = applied('M 0,0 L 10,10 L 20,0', 'interpolate_points', { interpolator_type: 'Linear' });
    expect(nodes(s).map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [10, 10],
      [20, 0],
    ]);
    expect(
      curve(s)[0]
        ?.curves()
        .every((c) => c.isLineSegment()),
    ).toBe(true);
  });

  it('runs a smooth curve through the nodes with Catmull-Rom', () => {
    const s = applied('M 0,0 L 10,10 L 20,0', 'interpolate_points');
    const p = curve(s)[0] as Path;
    expect(p.size()).toBe(2);
    expect(p.curves().every((c) => !c.isLineSegment())).toBe(true);
    near(p.curves()[0]?.finalPoint() as Point, [10, 10]);
    near(p.finalPoint(), [20, 0]);
  });
});

describe('Ruler', () => {
  it('draws a major mark every 5 steps, a minor mark in between and a mark at the end', () => {
    const s = applied('M 0,0 L 100,0', 'ruler');
    const pv = curve(s);
    // The path and 6 marks: at 0, 20, 40, 60, 80 and the end.
    expect(pv).toHaveLength(7);
    const marks = pv.slice(1).map((p) => [p.initialPoint(), p.finalPoint()].map((q) => [q.x, q.y]));
    expect(marks[0]).toEqual([
      [0, 0],
      [0, -14],
    ]);
    for (const [i, m] of marks.slice(1, 5).entries()) {
      expect(m?.[0]?.[0]).toBeCloseTo(20 * (i + 1), 3);
      expect(m?.[1]).toEqual([m?.[0]?.[0], -7]);
    }
    expect(marks[5]).toEqual([
      [100, 0],
      [100, -14],
    ]);
  });

  it('marks to the right, with a distance, an offset and without marks at the border', () => {
    const s = applied('M 0,0 L 100,0', 'ruler', {
      mark_dir: 'right',
      mark_distance: '25',
      offset: '10',
      border_marks: 'none',
      major_mark_steps: '2',
    });
    const marks = curve(s)
      .slice(1)
      .map((p) => [p.initialPoint().x, p.finalPoint().y]);
    // 10, 35, 60, 85: the first is major
    expect(marks).toEqual([
      [10, 14],
      [35, 7],
      [60, 14],
      [85, 7],
    ]);
  });
});

describe('Stitch Sub-Paths', () => {
  it('draws lines between the subpaths, the stitch path stretched to the distance', () => {
    const s = applied('M 0,0 L 100,0 M 0,50 L 100,50', 'curvestitching');
    const pv = curve(s);
    expect(pv).toHaveLength(5);
    for (const [i, p] of pv.entries()) {
      near(p.initialPoint(), [25 * i, 0], 3);
      near(p.finalPoint(), [25 * i, 50], 3);
    }
  });

  it('scales the width of the stitch', () => {
    const s = applied('M 0,0 L 100,0 M 0,50 L 100,50', 'curvestitching', {
      strokepath: 'M 0,0 L 50,10',
      count: '2',
    });
    const pv = curve(s);
    expect(pv).toHaveLength(2);
    // The stitch path is 50 wide, as the distance of the subpaths: it is turned, not scaled.
    near(pv[0]?.initialPoint() as Point, [5, 0], 3);
    near(pv[0]?.finalPoint() as Point, [-5, 50], 3);
  });
});

describe('Measure Segments', () => {
  const measured = (params: Record<string, string> = {}, d = 'M 0,0 L 100,0') => {
    // The objects are made when the effect is applied; as the dialog does when it writes a
    // parameter, ask for new objects with the parameters.
    const s = applied(d, 'measure_segments', params, '', (lpe) => {
      lpe?.getSPDoc()?.ensureUpToDate();
      lpe?.onParamWidgetChanged(null as never);
    });
    const id = s.getCurrentLPE()?.getRepr()?.attribute('id');
    const object = (name: string, counter = 0) => s.document.getObjectById(`${name}${counter}-${id}`);
    const path = (name: string, counter = 0) => {
      const pv = sp_svg_read_pathv(object(name, counter)?.getAttribute('d'));
      return pv[0]?.curves().map((c) => [c.initialPoint(), c.finalPoint()].map((p) => [p.x, p.y]));
    };
    return { s, id, object, path };
  };

  it('draws help lines from the nodes to the dimension line, 5 away from the path', () => {
    const { path } = measured();
    // The help lines go 2 further than the dimension line (the elongation).
    expect(path('infoline-on-start-')).toEqual([
      [
        [0, 0],
        [0, -7],
      ],
    ]);
    expect(path('infoline-on-end-')).toEqual([
      [
        [100, 0],
        [100, -7],
      ],
    ]);
  });

  it('labels the length in the unit of the effect', () => {
    const { s, id, object } = measured();
    const text = object('text-on-');
    expect(text).toBeInstanceOf(SPText);
    expect(text?.getRepr().firstChild()?.firstChild()?.content()).toBe('26.46mm');
    // 5 below the dimension line, half the font size more (10 pt = 13.33 px): above it on the screen.
    expect(Number(text?.getAttribute('y'))).toBeCloseTo(-5 + 13.3333333 / 2.5, 3);
    // The objects are in the document, the path stays the same.
    expect(s.document.getObjectById(`infoline-0-${id}`)).not.toBeNull();
    expect(curve(s)[0]?.size()).toBe(1);
  });

  it('uses the format, precision, scale and index', () => {
    const { object } = measured({
      format: 'L={measure} {unit}',
      precision: '0',
      scale: '2',
      showindex: 'true',
      unit: 'px',
    });
    expect(object('text-on-')?.getRepr().firstChild()?.firstChild()?.content()).toBe('[0] L=200 px');
  });

  it('measures each segment and hides the blacklisted ones', () => {
    const { object } = measured({ blacklist: '1,' }, 'M 0,0 L 100,0 L 100,50');
    expect(object('text-on-', 0)?.getRepr().firstChild()?.firstChild()?.content()).toBe('26.46mm');
    expect(object('infoline-', 1)?.getAttribute('style') ?? '').toContain('display:none');
    expect(object('text-on-', 1)?.getAttribute('style') ?? '').toContain('display:none');
  });

  it('puts the dimension line of the horizontal orientation under the lower node', () => {
    const { path } = measured({ orientation: 'horizontal' }, 'M 0,0 L 100,50');
    // The segment is turned to go from right to left; the dimension line is 5 below the lower node,
    // the help lines are 2 longer.
    expect(path('infoline-on-start-')).toEqual([
      [
        [100, 50],
        [100, 57],
      ],
    ]);
    expect(path('infoline-on-end-')).toEqual([
      [
        [0, 0],
        [0, 57],
      ],
    ]);
  });

  it('removes its objects with the effect', () => {
    const { s, id } = measured();
    expect(s.document.getObjectById(`infoline-0-${id}`)).not.toBeNull();
    s.removeCurrentPathEffect(false);
    expect(s.document.getObjectById(`infoline-0-${id}`)).toBeNull();
    expect(s.document.getObjectById(`text-on-0-${id}`)).toBeNull();
  });
});
