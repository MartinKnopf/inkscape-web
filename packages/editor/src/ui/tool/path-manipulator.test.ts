// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/path-manipulator.cpp, src/ui/tool/multi-path-manipulator.cpp, src/ui/tool/node.cpp
// @vitest-environment happy-dom
import { DocumentUndo, SPDocument, type SPPath } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import type { NodeTool } from '../tools/node-tool.ts';
import { Canvas } from '../widget/canvas.ts';
import type { Node } from './node.ts';
import { NodeType, SegmentType } from './node-types.ts';
import { NodeDeleteMode } from './path-manipulator.ts';

/** Circle of radius 50 around (100, 100) with 8 nodes (kappa for 45° arcs). */
function circle8(): string {
  const n = 8;
  const k = (4 / 3) * Math.tan(Math.PI / (2 * n));
  const pt = (a: number) => [100 + 50 * Math.cos(a), 100 + 50 * Math.sin(a)];
  let d = `M ${pt(0).join(',')}`;
  for (let i = 0; i < n; i++) {
    const a0 = (i * 2 * Math.PI) / n;
    const a1 = ((i + 1) * 2 * Math.PI) / n;
    const [x0, y0] = pt(a0) as [number, number];
    const [x1, y1] = pt(a1) as [number, number];
    const c1 = [x0 - 50 * k * Math.sin(a0), y0 + 50 * k * Math.cos(a0)];
    const c2 = [x1 + 50 * k * Math.sin(a1), y1 - 50 * k * Math.cos(a1)];
    // The last segment ends exactly at the start: the closing segment is degenerate.
    d += ` C ${c1.join(',')} ${c2.join(',')} ${pt(i === n - 1 ? 0 : a1).join(',')}`;
  }
  return `${d} Z`;
}

// Window = desktop = document coordinates (zoom 1, no viewBox).
function setup(d: string, nodetypes?: string) {
  const types = nodetypes ? ` sodipodi:nodetypes="${nodetypes}"` : '';
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="400" height="300">' +
      `<path id="p" d="${d}"${types}/></svg>`,
  );
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  const path = doc.getObjectById('p') as SPPath;
  dt.getSelection().set(path);
  tool_switch('Node', dt);
  const tool = dt.getTool() as NodeTool;
  const mpm = tool._multipath;
  const sel = tool._selected_nodes;
  const nodes = () => [...(mpm.manipulators()[0]?.subpathList() ?? [])].flatMap((sp) => [...sp]);
  const select = (...indices: number[]) => {
    sel.clear();
    for (const i of indices) sel.insert(nodes()[i] as Node);
  };
  const attr = (name: string) => doc.getObjectById('p')?.getAttribute(name) ?? null;
  const undoSteps = () => doc.undoStack.undo.map((e) => e.description);
  return { doc, dt, tool, mpm, sel, nodes, select, attr, undoSteps, path };
}

beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(document, 'elementsFromPoint');
});

const xy = (n: Node | undefined) => [n?.position().x, n?.position().y];

describe('PathManipulator', () => {
  it('creates nodes and handles from the path data and the node types', () => {
    const { nodes, attr } = setup('M 0,0 C 10,-10 20,-10 30,0 L 60,0', 'csc');
    expect(nodes().map(xy)).toEqual([
      [0, 0],
      [30, 0],
      [60, 0],
    ]);
    expect(nodes().map((n) => n.type())).toEqual([
      NodeType.NODE_CUSP,
      NodeType.NODE_SMOOTH,
      NodeType.NODE_CUSP,
    ]);
    expect(nodes()[0]?.front().position()).toEqual(new Point(10, -10));
    expect(nodes()[1]?.back().position()).toEqual(new Point(20, -10));
    expect(nodes()[1]?.front().isDegenerate()).toBe(true);
    expect(attr('d')).toBe('M 0,0 C 10,-10 20,-10 30,0 L 60,0');
  });

  it('moves the selected nodes with their handles: one "Move nodes" step, undo restores the nodes', () => {
    const { doc, mpm, select, nodes, attr, undoSteps } = setup('M 0,0 C 10,-10 20,-10 30,0 L 60,0', 'ccc');
    select(1);
    mpm.move(new Point(5, 7));
    expect(attr('d')).toBe('M 0,0 C 10,-10 25,-3 35,7 L 60,0');
    expect(attr('sodipodi:nodetypes')).toBe('ccc');
    expect(undoSteps()).toEqual(['Move nodes']);

    DocumentUndo.undo(doc);
    expect(attr('d')).toBe('M 0,0 C 10,-10 20,-10 30,0 L 60,0');
    expect(xy(nodes()[1])).toEqual([30, 0]);
  });

  it('drags a node with the pointer (Ctrl confines to an axis)', () => {
    const { tool, nodes, attr, undoSteps } = setup('M 0,0 L 30,0 L 60,0');
    const el = (nodes()[1] as unknown as { _canvas_item_ctrl: { element: Element } })._canvas_item_ctrl
      .element;
    const ev = (type: string, x: number, y: number, ctrlKey = false) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y, ctrlKey }),
      );
    ev('pointerdown', 30, 0);
    ev('pointermove', 40, 3, true);
    ev('pointermove', 50, 4, true);
    ev('pointerup', 50, 4, true);
    expect(attr('d')).toBe('M 0,0 H 50 60');
    expect(undoSteps()).toEqual(['Move nodes']);
    expect(tool._selected_nodes.has(nodes()[1] as Node)).toBe(true);
  });

  it('changes node types: smooth, symmetric, cusp (retracts handles of cusp nodes), auto', () => {
    const { mpm, select, nodes, attr, undoSteps } = setup(
      'M 0,0 C 10,10 20,-10 30,0 C 40,30 50,10 60,0',
      'ccc',
    );
    const middle = () => nodes()[1] as Node;
    select(1);

    mpm.setNodeType(NodeType.NODE_SMOOTH);
    const b = middle().back().relativePos();
    const f = middle().front().relativePos();
    expect(b.x * f.y - b.y * f.x).toBeCloseTo(0); // collinear
    expect(b.x * f.x + b.y * f.y).toBeLessThan(0); // opposite
    expect(attr('sodipodi:nodetypes')).toBe('csc');

    mpm.setNodeType(NodeType.NODE_SYMMETRIC);
    expect(middle().back().length()).toBeCloseTo(middle().front().length());
    expect(attr('sodipodi:nodetypes')).toBe('czc');

    mpm.setNodeType(NodeType.NODE_CUSP);
    expect(middle().front().isDegenerate()).toBe(false);
    mpm.setNodeType(NodeType.NODE_CUSP); // all selected nodes are cusp: retract
    expect(middle().isDegenerate()).toBe(true);

    mpm.setNodeType(NodeType.NODE_AUTO);
    // 1/3 of the distance to the neighbors, perpendicular to the bisector
    expect(middle().front().length()).toBeCloseTo(10);
    expect(middle().back().length()).toBeCloseTo(10);
    expect(attr('sodipodi:nodetypes')).toBe('cac');
    expect(undoSteps()).toEqual([
      'Change node type',
      'Change node type',
      'Change node type',
      'Retract handles',
      'Change node type',
    ]);
  });

  it('inserts a node in the middle of selected segments, keeping the shape of curves', () => {
    const { mpm, select, nodes, attr, undoSteps } = setup('M 0,0 L 30,0 C 40,20 50,20 60,0');
    select(0, 1, 2);
    mpm.insertNodes();
    expect(nodes().map(xy)).toEqual([
      [0, 0],
      [15, 0],
      [30, 0],
      [45, 15],
      [60, 0],
    ]);
    expect(nodes()[3]?.type()).toBe(NodeType.NODE_SMOOTH);
    expect(attr('d')).toBe('m 0,0 h 15 15 c 5,10 10,15 15,15 5,0 10,-5 15,-15');
    expect(undoSteps()).toEqual(['Add nodes']);
  });

  it('deletes a node of a circle keeping the shape approximately', () => {
    const { mpm, select, nodes, path, undoSteps } = setup(circle8());
    select(2);
    mpm.deleteNodes(NodeDeleteMode.automatic);
    expect(nodes()).toHaveLength(7);
    expect(undoSteps()).toEqual(['Delete nodes']);
    const curve = path.curve()?.[0];
    for (const c of curve?.curves() ?? []) {
      for (let t = 0; t <= 1; t += 0.1) {
        const p = c.pointAt(t);
        expect(Math.hypot(p.x - 100, p.y - 100)).toBeCloseTo(50, -0.3); // within 1
      }
    }
  });

  it('deletes nodes with line_segment mode as a straight line', () => {
    const { mpm, select, attr } = setup('M 0,0 C 10,10 20,10 30,0 C 40,-10 50,-10 60,0');
    select(1);
    mpm.deleteNodes(NodeDeleteMode.line_segment);
    expect(attr('d')).toBe('M 0,0 H 60');
  });

  it('makes segments lines and curves', () => {
    const { mpm, select, attr, undoSteps } = setup('M 0,0 C 10,10 20,10 30,0');
    select(0, 1);
    mpm.setSegmentType(SegmentType.SEGMENT_STRAIGHT);
    expect(attr('d')).toBe('M 0,0 H 30');
    mpm.setSegmentType(SegmentType.SEGMENT_CUBIC_BEZIER);
    expect(attr('d')).toBe('M 0,0 C 10,0 20,0 30,0');
    expect(undoSteps()).toEqual(['Straighten segments', 'Make segments curves']);
  });

  it('breaks and joins nodes', () => {
    const { mpm, select, attr, undoSteps, nodes } = setup('M 0,0 L 30,0 L 60,0');
    select(1);
    mpm.breakNodes();
    expect(attr('d')).toBe('m 0,0 h 30 m 0,0 h 30');
    select(1, 2);
    mpm.joinNodes();
    expect(attr('d')).toBe('M 0,0 H 30 60');
    expect(nodes()).toHaveLength(3);
    expect(undoSteps()).toEqual(['Break nodes', 'Join nodes']);
  });

  it('deleting all nodes deletes the path', () => {
    const { doc, mpm, select } = setup('M 0,0 L 30,0');
    select(0, 1);
    mpm.deleteNodes(NodeDeleteMode.automatic);
    expect(doc.getObjectById('p')).toBeNull();
    expect(mpm.empty()).toBe(true);
  });
});
