// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/box3d.cpp, src/object/persp3d.cpp, src/transf_mat_3x4.cpp
import { Point, Translate } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { Box3D, Proj } from '../axis-manip.ts';
import { SPDocument } from '../document.ts';
import { Pt2, Pt3 } from '../proj_pt.ts';
import { TransfMat3x4 } from '../transf_mat_3x4.ts';
import { SPBox3D } from './box3d.ts';
import { Box3DSide } from './box3d-side.ts';
import { ObjectSet } from './object-set.ts';
import { Persp3D } from './persp3d.ts';
import type { SPItem } from './sp-item.ts';

SPDocument.scheduleIdle = () => {};

const NS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"';

/** A document with the default perspective and a box made like the 3D box tool does. */
function setup() {
  const doc = SPDocument.createNewDocFromMem(`<svg ${NS} width="400" height="300"><g id="layer"/></svg>`);
  if (!doc) throw new Error('parse failed');
  const persp = Persp3D.create_xml_element(doc);
  const box = SPBox3D.createBox3D(doc.getObjectById('layer') as SPItem);
  for (let i = 0; i < 6; ++i) {
    const side = Box3DSide.createBox3DSide(box);
    let [plane, front_or_rear] = Box3D.int_to_face(i);
    plane = Box3D.is_plane(plane) ? plane : Box3D.orth_plane_or_axis(plane);
    side.dir1 = Box3D.extract_first_axis_direction(plane);
    side.dir2 = Box3D.extract_second_axis_direction(plane);
    side.front_or_rear = front_or_rear;
    side.updateRepr();
  }
  const tmat = persp.perspective_impl.tmat;
  box.orig_corner0 = tmat.preimage(new Point(150, 150), 0, Proj.Axis.Z);
  const c7 = tmat.preimage(new Point(250, 200), 0, Proj.Axis.Z);
  c7.normalize();
  c7.pt[2] = 0.25;
  box.orig_corner7 = c7;
  box.updateRepr();
  box.relabel_corners();
  box.updateRepr();
  box.set_z_orders();
  doc.ensureUpToDate();
  return { doc, persp, box };
}

describe('TransfMat3x4', () => {
  it('maps a preimage back to the point', () => {
    const m = new TransfMat3x4(
      new Pt2(0, 150, 1),
      new Pt2(0, 1000, 0),
      new Pt2(400, 150, 1),
      new Pt2(200, 100, 1),
    );
    const pre = m.preimage(new Point(120, 80), 0, Proj.Axis.Z);
    expect(pre.normalized().at(2)).toBeCloseTo(0, 9);
    const p = m.image(pre).affine();
    expect(p.x).toBeCloseTo(120, 9);
    expect(p.y).toBeCloseTo(80, 9);
  });

  it('toggles a vanishing point between finite and infinite', () => {
    const m = new TransfMat3x4(
      new Pt2(0, 150, 1),
      new Pt2(0, 1000, 0),
      new Pt2(400, 150, 1),
      new Pt2(200, 100, 1),
    );
    m.toggle_finite(Proj.Axis.X);
    expect(m.has_finite_image(Proj.Axis.X)).toBe(false);
    expect(m.get_infinite_angle(Proj.Axis.X)).toBeCloseTo((Math.atan2(50, -200) * 180) / Math.PI, 9);
    m.toggle_finite(Proj.Axis.X);
    expect(m.column(Proj.Axis.X).affine().equals(new Point(0, 150))).toBe(true);
  });
});

describe('Persp3D', () => {
  it('writes the vanishing points with the y axis pointing up and reads them back', () => {
    const { persp } = setup();
    const repr = persp.getRepr();
    // The default perspective: VP x at the left, middle; stored relative to the bottom.
    expect(repr.attribute('inkscape:vp_x')).toBe('0 : 150 : 1');
    expect(repr.attribute('inkscape:vp_y')).toBe('0 : 1000 : 0');
    expect(persp.get_VP(Proj.Axis.X).affine().equals(new Point(0, 150))).toBe(true);
    expect(persp.get_VP(Proj.Axis.W).affine().equals(new Point(200, 200))).toBe(true);
    const read = SPDocument.createNewDocFromMem(
      `<svg ${NS} width="400" height="300"><defs><inkscape:perspective id="p" sodipodi:type="inkscape:persp3d" inkscape:vp_x="0 : 100 : 1" inkscape:vp_y="0 : 1000 : 0" inkscape:vp_z="400 : 100 : 1" inkscape:persp3d-origin="200 : 50 : 1"/></defs></svg>`,
    );
    const p = read?.getObjectById('p') as Persp3D;
    expect(p.get_VP(Proj.Axis.X).affine().equals(new Point(0, 200))).toBe(true);
    // An infinite VP is a direction: only its y is flipped.
    expect(p.get_VP(Proj.Axis.Y).pt).toEqual([0, -1000, 0]);
  });
});

describe('SPBox3D', () => {
  it('draws six sides from its corners and writes them as attributes', () => {
    const { box } = setup();
    const sides = box.children.filter((c) => c instanceof Box3DSide) as Box3DSide[];
    expect(sides.map((s) => s.axes_string()).sort()).toEqual(
      ['XYfront', 'XYrear', 'XZbottom', 'XZtop', 'YZleft', 'YZright'].sort(),
    );
    for (const side of sides) expect(side.curve()?.[0]?.size()).toBe(4);
    expect(box.getRepr().attribute('inkscape:perspectiveID')).toMatch(/^#/);
    expect(box.getRepr().attribute('inkscape:corner0')).toMatch(/^[-\d.e]+ : [-\d.e]+ : [-\d.e]+ : 1$/);
    // corner 0 is on the canvas where the drag started (or its relabeled opposite)
    const corners = [0, 1, 2, 3].map((id) => box.get_corner_screen(id, false));
    expect(corners.some((p) => Math.abs(p.x - 150) < 1e-6 && Math.abs(p.y - 150) < 1e-6)).toBe(true);
  });

  it('moves with its perspective when it is transformed', () => {
    const { doc, persp, box } = setup();
    const before = box.get_corner_screen(0, false);
    const set = new ObjectSet(doc);
    set.add(box);
    set.applyAffine(Translate(10, 20));
    const after = box.get_corner_screen(0, false);
    expect(after.x - before.x).toBeCloseTo(10, 9);
    expect(after.y - before.y).toBeCloseTo(20, 9);
    expect(persp.get_VP(Proj.Axis.X).affine().equals(new Point(10, 170))).toBe(true);
  });

  it('gives a box its own perspective when it moves without the other boxes of the perspective', () => {
    const { doc, persp, box } = setup();
    const other = SPBox3D.createBox3D(doc.getObjectById('layer') as SPItem);
    other.orig_corner0 = new Pt3(0, 0, 0, 1);
    other.orig_corner7 = new Pt3(1, 1, 1, 1);
    other.updateRepr();
    expect(persp.num_boxes()).toBe(2);
    const set = new ObjectSet(doc);
    set.add(box);
    set.applyAffine(Translate(10, 0));
    expect(box.get_perspective()).not.toBe(persp);
    expect(persp.list_of_boxes()).toEqual([other]);
  });

  it('moves a corner in the XY plane', () => {
    const { box } = setup();
    box.save_corner0 = box.orig_corner0.normalized();
    box.save_corner7 = box.orig_corner7.normalized();
    box.set_corner(2, new Point(100, 250), Box3D.Axis.XY, false);
    box.position_set();
    const p = box.get_corner_screen(2, false);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(250, 6);
  });
});
