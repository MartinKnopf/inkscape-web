// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/mesh-tool.cpp, src/gradient-drag.cpp (meshes)
// @vitest-environment happy-dom
import {
  GrPointType,
  getGradient,
  getGradientCoords,
  MeshCornerOperation,
  PaintTarget,
  Preferences,
  SPMeshGradient,
} from '@inkscape-web/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MeshTool } from './mesh-tool.ts';
import { setupDesktop, stroke } from './tool-test-utils.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="layer1" inkscape:groupmode="layer"><rect id="r" width="200" height="100" style="fill:#ff0000"/></g></svg>';

function setup() {
  const env = setupDesktop(SVG, 'Mesh');
  const rect = env.item('r');
  env.dt.getSelection().set(rect);
  const tool = env.dt.getTool() as MeshTool;
  const mesh = () => getGradient(rect, PaintTarget.FOR_FILL) as SPMeshGradient;
  const dblclick = (x: number, y: number) =>
    env.svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0, clientX: x, clientY: y }));
  return { ...env, rect, tool, mesh, dblclick };
}

// No layout in happy-dom: nothing is under the pointer.
beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(document, 'elementsFromPoint');
  for (const p of ['mesh_rows', 'mesh_cols', 'edit_fill', 'edit_stroke', 'show_handles']) {
    Preferences.get().remove(`/tools/mesh/${p}`);
  }
});

describe('MeshTool', () => {
  it('creates a mesh on the selected object with a double click, with the toolbar rows and columns', async () => {
    Preferences.get().setInt('/tools/mesh/mesh_rows', 2);
    Preferences.get().setInt('/tools/mesh/mesh_cols', 2);
    const { doc, tool, mesh, dblclick, undoSteps } = setup();
    expect(tool).toBeInstanceOf(MeshTool);
    dblclick(300, 200);
    doc.ensureUpToDate();
    await Promise.resolve(); // the selection modified signal updates the draggers
    expect(mesh()).toBeInstanceOf(SPMeshGradient);
    expect([mesh().array.patch_rows(), mesh().array.patch_columns()]).toEqual([2, 2]);
    expect(undoSteps()).toEqual(['Create mesh']);
    // 9 corners, 24 handles, 16 tensors; the sides are drawn as curves
    const drag = tool.get_drag();
    const count = (t: GrPointType) => drag.draggers.filter((d) => d.isA(t)).length;
    expect([count(GrPointType.POINT_MG_CORNER), count(GrPointType.POINT_MG_HANDLE)]).toEqual([9, 24]);
    expect(drag.item_curves.length).toBe(12);
  });

  it('moves a corner knot and its handles, and splits a column with a double click on a side', async () => {
    const { doc, tool, rect, mesh, dblclick, undoSteps } = setup();
    dblclick(300, 200);
    doc.ensureUpToDate();
    await Promise.resolve(); // the selection modified signal updates the draggers
    const drag = tool.get_drag();
    const corner = drag.draggers.find((d) =>
      d.isA(rect, GrPointType.POINT_MG_CORNER, 0, PaintTarget.FOR_FILL),
    )!;
    const handle0 = getGradientCoords(rect, GrPointType.POINT_MG_HANDLE, 0, PaintTarget.FOR_FILL);
    stroke(corner.knot.ctrl.element as Element, [
      [0, 0],
      [5, 5],
      [10, 20],
    ]);
    doc.ensureUpToDate();
    const p = getGradientCoords(rect, GrPointType.POINT_MG_CORNER, 0, PaintTarget.FOR_FILL);
    expect([p.x, p.y]).toEqual([10, 20]);
    // the handle next to the corner moved with it
    const h = getGradientCoords(rect, GrPointType.POINT_MG_HANDLE, 0, PaintTarget.FOR_FILL);
    expect([h.x - handle0.x, h.y - handle0.y]).toEqual([10, 20]);
    expect(mesh().getRepr().firstChild()?.firstChild()?.firstChild()?.attribute('path')).toMatch(/^c /);
    expect(undoSteps().at(-1)).toBe('Move gradient handle');

    // the bottom side (y = 100) of the only patch: a new column
    await Promise.resolve();
    dblclick(150, 100);
    doc.ensureUpToDate();
    expect(mesh().array.patch_columns()).toBe(2);
    expect(undoSteps().at(-1)).toBe('Added patch row or column');
  });

  it('toggles the sides between selected corners', async () => {
    const { doc, tool, rect, mesh, dblclick } = setup();
    dblclick(300, 200);
    doc.ensureUpToDate();
    await Promise.resolve(); // the selection modified signal updates the draggers
    const drag = tool.get_drag();
    const corners = drag.draggers.filter((d) => d.isA(GrPointType.POINT_MG_CORNER)).slice(0, 2);
    for (const c of corners) drag.setSelected(c, true);
    tool.corner_operation(MeshCornerOperation.MG_CORNER_SIDE_TOGGLE);
    doc.ensureUpToDate();
    expect(mesh().array.node(0, 1).path_type).toBe('l');
    expect(rect.getRepr().attribute('style')).toContain('fill:url(#');
  });
});
