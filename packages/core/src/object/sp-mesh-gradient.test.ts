// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-mesh-gradient.cpp, src/object/sp-mesh-array.cpp
import { Point, Rect } from '@inkscape-web/geom';
import { afterEach, describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { Preferences } from '../preferences.ts';
import type { Node } from '../xml/node.ts';
import type { SPItem } from './sp-item.ts';
import { NodeType } from './sp-mesh-array.ts';
import { SPMeshGradient } from './sp-mesh-gradient.ts';

SPDocument.scheduleIdle = () => {};

const kids = (n: Node) => {
  const list: Node[] = [];
  for (let c = n.firstChild(); c; c = c.next()) list.push(c);
  return list;
};

const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="300">${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};

// One patch: a straight top, a curved right side, absolute and relative paths.
const MESH =
  '<defs><meshgradient id="m" x="10" y="20" gradientUnits="userSpaceOnUse"><meshrow><meshpatch>' +
  '<stop path="l 100,0" style="stop-color:#ff0000"/>' +
  '<stop path="c 10,30 10,70 0,100" style="stop-color:#00ff00"/>' +
  '<stop path="L 10,120" style="stop-color:#0000ff"/>' +
  '<stop path="l 0,-100" style="stop-color:#ffffff;stop-opacity:0.5"/>' +
  '</meshpatch></meshrow></meshgradient></defs>';

describe('SPMeshGradient', () => {
  afterEach(() => {
    Preferences.get().remove('/tools/mesh/mesh_rows');
    Preferences.get().remove('/tools/mesh/mesh_cols');
  });

  it('reads the patches into a node array with corners, handles and colors', () => {
    const doc = open(MESH);
    const mg = doc.getObjectById('m') as SPMeshGradient;
    expect(mg).toBeInstanceOf(SPMeshGradient);
    expect(mg.hasPatches()).toBe(true);
    mg.ensureArray();
    const a = mg.array;
    expect([a.patch_rows(), a.patch_columns()]).toEqual([1, 1]);
    expect(a.corners.map((n) => [n.p.x, n.p.y])).toEqual([
      [10, 20],
      [110, 20],
      [10, 120],
      [110, 120],
    ]);
    expect(a.corners.map((n) => n.color?.toString())).toEqual([
      '#ff0000ff',
      '#00ff00ff',
      '#ffffff80',
      '#0000ffff',
    ]);
    // the curved right side keeps its handles, the straight top has handles at 1/3 and 2/3
    expect(a.node(1, 3).p.equals(new Point(120, 50))).toBe(true);
    expect(a.node(0, 1).p.equals(new Point(10 + 100 / 3, 20))).toBe(true);
    expect(a.node(0, 1).set).toBe(false);
    expect(a.node(1, 1).node_type).toBe(NodeType.MG_NODE_TYPE_TENSOR);
  });

  it('creates a mesh on a rectangle and writes rows and patches that read back', () => {
    Preferences.get().setInt('/tools/mesh/mesh_rows', 2);
    Preferences.get().setInt('/tools/mesh/mesh_cols', 3);
    const doc = open(
      '<defs><meshgradient id="m"/></defs><rect id="r" x="0" y="0" width="90" height="40" fill="#ff0000"/>',
    );
    const mg = doc.getObjectById('m') as SPMeshGradient;
    mg.array.create(mg, doc.getObjectById('r') as SPItem, new Rect(0, 0, 90, 40));
    doc.ensureUpToDate();
    const rows = kids(mg.getRepr());
    expect(rows.map((r) => kids(r).length)).toEqual([3, 3]);
    // first patch has four stops, the others less (shared sides)
    expect(kids(rows[0]!).map((p) => kids(p).length)).toEqual([4, 3, 3]);
    expect(rows[0]!.firstChild()!.firstChild()!.attribute('path')).toBe('c 10,0  20,0  30,0');
    expect(rows[0]!.firstChild()!.firstChild()!.attribute('style')).toContain('stop-color:#ffffff');

    mg.invalidateArray();
    mg.ensureArray();
    expect([mg.array.patch_rows(), mg.array.patch_columns()]).toEqual([2, 3]);
    expect(mg.array.corners.length).toBe(12);
    expect(mg.array.corners[11]!.p.equals(new Point(90, 40))).toBe(true);
    // the default color comes from the fill
    expect(mg.array.corners[1]!.color?.toString(false)).toBe('#ff0000');
  });

  it('splits, toggles sides and moves the handles with a corner', () => {
    const doc = open(MESH);
    const mg = doc.getObjectById('m') as SPMeshGradient;
    mg.ensureArray();
    const a = mg.array;
    // insert between the two top corners: a new column
    expect(a.insert([0, 1])).toBe(1);
    a.update_node_vectors();
    expect([a.patch_rows(), a.patch_columns()]).toEqual([1, 2]);
    expect(a.node(0, 3).p.equals(new Point(60, 20))).toBe(true);
    expect(a.node(0, 3).color?.toString(false)).toBe('#808000');

    // the straight top side becomes a curve
    expect(a.side_toggle([0, 1])).toBe(1);
    expect(a.node(0, 1).path_type).toBe('c');
    // moving the top left corner moves its curve handle and its tensor along
    const old = a.node(0, 0).p;
    a.node(0, 0).p = old.add(new Point(5, 5));
    const handle = a.node(0, 1).p;
    a.update_handles(0, [0], old);
    expect(a.node(0, 1).p.equals(handle.add(new Point(5, 5)))).toBe(true);
  });
});
