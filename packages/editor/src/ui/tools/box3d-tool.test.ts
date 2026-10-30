// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/box3d-tool.cpp, src/vanishing-point.cpp
// @vitest-environment happy-dom
import { Box3DSide, getCurrentPersp3D, Proj, SPBox3D, SPDocument } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { beforeEach, describe, expect, it } from 'vitest';
import { tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import { Box3dTool } from './box3d-tool.ts';

let doc: SPDocument;
let dt: SPDesktop;

beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
  const d = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"/>',
  );
  if (!d) throw new Error('parse failed');
  doc = d;
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  dt = new SPDesktop(new Canvas(host), doc);
  dt.zoom_absolute(new Point(0, 0), 1, false);
  dt.scroll_absolute(new Point(0, 0));
  tool_switch('3DBox', dt);
});

function pointer(type: string, x: number, y: number, mods: { shiftKey?: boolean } = {}) {
  dt.getCanvas().svg.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: y,
      ...mods,
    }),
  );
}

function drawBox(extrude = false) {
  pointer('pointerdown', 150, 150);
  pointer('pointermove', 200, 180);
  pointer('pointermove', 250, 200);
  if (extrude) pointer('pointermove', 280, 190, { shiftKey: true });
  pointer('pointerup', 280, 190);
  return dt.getSelection().singleItem() as SPBox3D;
}

describe('Box3dTool', () => {
  it('draws a box with six sides in a new default perspective', () => {
    expect(dt.getTool()).toBeInstanceOf(Box3dTool);
    const box = drawBox();
    expect(box).toBeInstanceOf(SPBox3D);
    const sides = box.children.filter((c) => c instanceof Box3DSide) as Box3DSide[];
    expect(sides.length).toBe(6);
    // The sides have the tool styles of their faces.
    const front = sides.find((s) => s.axes_string() === 'XYfront');
    expect(front?.getRepr().attribute('style')).toContain('fill:#8686bf');
    expect(box.get_perspective()).toBe(getCurrentPersp3D(doc));
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Create 3D box');
  });

  it('extrudes the box along the Z axis with Shift', () => {
    const flat = drawBox();
    const z = (b: SPBox3D) => Math.abs(b.orig_corner7.normalized().at(2) - b.orig_corner0.normalized().at(2));
    const z_flat = z(flat);
    dt.getSelection().clear();
    const deep = drawBox(true);
    expect(z(deep)).not.toBeCloseTo(z_flat, 3);
  });

  it('shows knots for the finite vanishing points and the corners of the selected box', () => {
    drawBox();
    const tool = dt.getTool() as Box3dTool;
    // The default perspective has finite VPs in X and Z, an infinite one in Y.
    expect(tool._vpdrag.draggers.length).toBe(2);
    expect(tool._vpdrag.item_curves.length).toBeGreaterThan(0);
  });

  it('toggles a vanishing point with Shift+X and rotates an infinite one with ( )', () => {
    drawBox();
    const persp = getCurrentPersp3D(doc)!;
    dt.getCanvas().svg.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'X', shiftKey: true, bubbles: true }),
    );
    expect(persp.get_VP(Proj.Axis.X).is_finite()).toBe(false);
    const before = persp.get_infinite_angle(Proj.Axis.Y);
    dt.getCanvas().svg.dispatchEvent(new KeyboardEvent('keydown', { key: ')', bubbles: true }));
    expect(persp.get_infinite_angle(Proj.Axis.Y)).toBeCloseTo(before + 15, 6);
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Change perspective (angle of PLs)');
  });
});
