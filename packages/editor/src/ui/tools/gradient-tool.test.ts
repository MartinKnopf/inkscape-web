// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/gradient-tool.cpp, src/gradient-drag.cpp
// @vitest-environment happy-dom
import {
  DocumentUndo,
  GrPointType,
  getGradient,
  getGradientCoords,
  PaintTarget,
  Preferences,
  SPDocument,
  SPGradientType,
  type SPItem,
  type SPLinearGradient,
  SPRadialGradient,
} from '@inkscape-web/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import { GradientTool } from './gradient-tool.ts';

// Window = desktop = document coordinates (zoom 1, no viewBox).
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="layer1" inkscape:groupmode="layer"><rect id="r" width="200" height="100" style="fill:#ff0000"/></g></svg>';

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  const rect = doc.getObjectById('r') as SPItem;
  dt.getSelection().set(rect);
  tool_switch('Gradient', dt);
  const tool = dt.getTool() as GradientTool;
  const svg = dt.getCanvas().svg;
  const gradient = () => getGradient(rect, PaintTarget.FOR_FILL);
  const undoSteps = () => doc.undoStack.undo.map((e) => e.description);
  return { doc, dt, tool, svg, rect, gradient, undoSteps };
}

function pointer(target: Element, type: string, x: number, y: number) {
  const buttons = type === 'pointerup' ? 0 : 1;
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, buttons, clientX: x, clientY: y }));
}

function drag(target: Element, x0: number, y0: number, x1: number, y1: number) {
  pointer(target, 'pointerdown', x0, y0);
  pointer(target, 'pointermove', (x0 + x1) / 2, (y0 + y1) / 2);
  pointer(target, 'pointermove', x1, y1);
  pointer(target, 'pointerup', x1, y1);
}

const coords = (g: SPLinearGradient) => [g.x1.computed, g.y1.computed, g.x2.computed, g.y2.computed];

// No layout in happy-dom: nothing is under the pointer.
beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(document, 'elementsFromPoint');
  Preferences.get().remove('/tools/gradient/newgradient');
});

describe('GradientTool', () => {
  it('drags a linear gradient on the selected object, in one undo step', () => {
    const { doc, tool, svg, gradient, undoSteps } = setup();
    expect(tool).toBeInstanceOf(GradientTool);
    drag(svg, 20, 30, 120, 30);
    doc.ensureUpToDate();
    const g = gradient() as SPLinearGradient;
    expect(coords(g)).toEqual([20, 30, 120, 30]);
    expect(g.getRepr().attribute('gradientUnits')).toBe('userSpaceOnUse');
    // The vector takes the color of the object.
    expect(g.getGradientVector().stops.map((s) => s.color?.toString())).toEqual(['#ff0000ff', '#ff0000ff']);
    expect(undoSteps()).toEqual(['Move gradient handle']);
    // The draggers: start and end, the end selected.
    const drag_ = tool.get_drag();
    expect(drag_.draggers.map((d) => d.draggables[0]?.point_type)).toEqual([
      GrPointType.POINT_LG_BEGIN,
      GrPointType.POINT_LG_END,
    ]);
    expect([...drag_.selected][0]?.point.x).toBe(120);
    DocumentUndo.undo(doc);
    expect(gradient()).toBeNull();
  });

  it('creates a radial gradient with the toolbar preference', () => {
    const { doc, svg, rect, gradient } = setup();
    Preferences.get().setInt('/tools/gradient/newgradient', SPGradientType.SP_GRADIENT_TYPE_RADIAL);
    drag(svg, 100, 50, 150, 50);
    doc.ensureUpToDate();
    const g = gradient() as SPRadialGradient;
    expect(g).toBeInstanceOf(SPRadialGradient);
    // The radius handle sets the gradient transform (the radius is the one of the default gradient).
    const at = (type: GrPointType) => {
      const p = getGradientCoords(rect, type, 0, PaintTarget.FOR_FILL);
      return [p.x, p.y].map((v) => Math.round(v * 1000) / 1000);
    };
    expect(at(GrPointType.POINT_RG_CENTER)).toEqual([100, 50]);
    expect(at(GrPointType.POINT_RG_R1)).toEqual([150, 50]);
  });

  it('moves the end handle with its knot', () => {
    const { doc, tool, svg, gradient, undoSteps } = setup();
    drag(svg, 20, 30, 120, 30);
    const knot = tool.get_drag().draggers.find((d) => d.isA(GrPointType.POINT_LG_END))?.knot.ctrl
      .element as Element;
    drag(knot, 120, 30, 150, 60);
    doc.ensureUpToDate();
    expect(coords(gradient() as SPLinearGradient)).toEqual([20, 30, 150, 60]);
    expect(undoSteps()).toEqual(['Move gradient handle', 'Move gradient handle']);
  });

  it('adds a stop with a double click on the line and deletes it with Delete', async () => {
    const { doc, tool, svg, gradient, undoSteps } = setup();
    drag(svg, 20, 30, 120, 30);
    // Let the selection modified signal update the lines.
    doc.ensureUpToDate();
    await Promise.resolve();
    svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0, clientX: 70, clientY: 31 }));
    doc.ensureUpToDate();
    const vector = () => (gradient() as SPLinearGradient).getVector();
    expect(vector().getStopCount()).toBe(3);
    expect(vector().getFirstStop()?.getNextStop()?.offset).toBeCloseTo(0.5);
    expect(tool.get_drag().selected.size).toBe(1);
    expect(undoSteps().at(-1)).toBe('Add gradient stop');

    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(vector().getStopCount()).toBe(2);
    expect(undoSteps().at(-1)).toBe('Delete gradient stop(s)');
  });
});
