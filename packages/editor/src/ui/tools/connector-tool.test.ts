// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/connector-tool.cpp
// @vitest-environment happy-dom
import { join } from 'node:path';
import { SPDocument, type SPItem, SPPath, setPathBoolopBackend } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import type { SvgDrawingItem } from '../../display/drawing-item.ts';
import { Canvas } from '../widget/canvas.ts';
import { ConnectorTool, cc_item_is_connector, cc_selection_set_avoid } from './connector-tool.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<rect id="a" x="20" y="20" width="40" height="40"/><rect id="b" x="220" y="20" width="40" height="40"/>' +
  '<rect id="o" x="130" y="0" width="20" height="100"/></svg>';

let doc: SPDocument;
let dt: SPDesktop;

beforeAll(async () => {
  // Under happy-dom the module's own URL is http://: give it the file path.
  const wasm = join(process.cwd(), 'packages/wasm/dist/geom-module.wasm');
  setPathBoolopBackend(await loadGeom({ locateFile: () => wasm }));
});

beforeEach(() => {
  const d = SPDocument.createNewDocFromMem(SVG);
  if (!d) throw new Error('parse failed');
  doc = d;
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  dt = new SPDesktop(new Canvas(host), doc);
  dt.zoom_absolute(new Point(0, 0), 1, false);
  dt.scroll_absolute(new Point(0, 0));
  // The browser's hit testing: the drawing elements of the items under the point.
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: (x: number, y: number) =>
      ['a', 'b', 'o']
        .map((id) => doc.getObjectById(id) as SPItem)
        .filter((item) => item.desktopVisualBounds()?.contains(new Point(x, y)))
        .flatMap((item) => item.views.map((v) => (v.drawingitem as SvgDrawingItem).element)),
  });
  tool_switch('Connector', dt);
});

function pointer(type: string, x: number, y: number) {
  dt.getCanvas().svg.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: y,
    }),
  );
}

/** Hover the shape at (x, y), then enter its connection point (the browser's pointerenter). */
function hoverPoint(tool: ConnectorTool, x: number, y: number) {
  pointer('pointermove', x, y);
  tool.knots[0]?.ctrl.element.dispatchEvent(new PointerEvent('pointerenter'));
}

describe('ConnectorTool', () => {
  it('draws a connector between the connection points of two shapes', () => {
    const tool = dt.getTool() as ConnectorTool;
    expect(tool).toBeInstanceOf(ConnectorTool);
    hoverPoint(tool, 40, 40);
    pointer('pointerdown', 40, 40);
    hoverPoint(tool, 240, 40);
    pointer('pointermove', 240, 40);
    pointer('pointerup', 240, 40);

    const path = dt.getSelection().singleItem();
    expect(path).toBeInstanceOf(SPPath);
    const repr = path!.getRepr();
    expect(repr.attribute('inkscape:connection-start')).toBe('#a');
    expect(repr.attribute('inkscape:connection-end')).toBe('#b');
    expect(repr.attribute('inkscape:connector-type')).toBe('polyline');
    expect(cc_item_is_connector(path!)).toBe(true);
    // The path is cut at the outlines of the shapes.
    const p = (path as SPPath).curve()![0]!;
    expect(Math.round(p.initialPoint().x)).toBe(60);
    expect(Math.round(p.finalPoint().x)).toBe(220);
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Create connector');
  });

  it('makes the selected shapes obstacles that connectors avoid', () => {
    const tool = dt.getTool() as ConnectorTool;
    hoverPoint(tool, 40, 40);
    pointer('pointerdown', 40, 40);
    hoverPoint(tool, 240, 40);
    pointer('pointermove', 240, 40);
    pointer('pointerup', 240, 40);
    const path = dt.getSelection().singleItem() as SPPath;
    expect(path.curve()![0]!.size()).toBe(1);

    dt.getSelection().set(doc.getObjectById('o')!);
    expect(cc_selection_set_avoid(dt, true)).toBe(true);
    expect(doc.getObjectById('o')!.getAttribute('inkscape:connector-avoid')).toBe('true');
    doc.ensureUpToDate();
    // The connector now bends around the obstacle.
    expect(path.curve()![0]!.size()).toBeGreaterThan(1);
  });
});
