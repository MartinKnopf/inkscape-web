// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/calligraphic-tool.cpp, src/ui/tools/dynamic-base.cpp
// @vitest-environment happy-dom
import { resolve } from 'node:path';
import { Preferences, SPDocument, type SPItem, setPathBoolopBackend } from '@inkscape-web/core';
import { Path, Point } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import { add_cap } from './calligraphic-tool.ts';

// happy-dom: the module would read the wasm file from an http URL.
const wasm = resolve(import.meta.dirname, '../../../../wasm/dist/geom-module.wasm');
setPathBoolopBackend(await loadGeom({ locateFile: () => wasm }));

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="layer1" inkscape:groupmode="layer"><rect id="r" x="100" y="80" width="40" height="40"/></g></svg>';

/** Fixed horizontal nib of 10 px, no mass, no thinning: a horizontal stroke is 10 px high. */
const PREFS: Record<string, number> = {
  '/tools/calligraphic/width': 10,
  '/tools/calligraphic/mass': 0,
  '/tools/calligraphic/thinning': 0,
  '/tools/calligraphic/flatness': 100,
  '/tools/calligraphic/angle': 90,
};

function setup() {
  for (const [p, v] of Object.entries(PREFS)) Preferences.get().setDouble(p, v);
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  tool_switch('Calligraphic', dt);
  const svg = dt.getCanvas().svg;
  const layer = () => [...(doc.getObjectById('layer1')?.getRepr().children() ?? [])];
  const undoSteps = () => doc.undoStack.undo.map((e) => e.description);
  return { doc, dt, svg, layer, undoSteps };
}

type Mods = { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean };

function pointer(target: Element, type: string, x: number, y: number, buttons: number, mods: Mods = {}) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: 0, buttons, clientX: x, clientY: y, ...mods }),
  );
}

/** A horizontal stroke from x0 to x1 at y in 5 px steps. */
function stroke(target: Element, x0: number, x1: number, y: number, mods: Mods = {}) {
  pointer(target, 'pointerdown', x0, y, 1, mods);
  for (let x = x0 + 5; x <= x1; x += 5) pointer(target, 'pointermove', x, y, 1, mods);
  pointer(target, 'pointerup', x1, y, 0, mods);
}

beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(document, 'elementsFromPoint');
  for (const p of [...Object.keys(PREFS), '/tools/calligraphic/cap_rounding']) Preferences.get().remove(p);
});

describe('CalligraphicTool', () => {
  it('a drag draws a filled outline as wide as the nib, selected, in one undo step', () => {
    const { doc, dt, svg, layer, undoSteps } = setup();
    stroke(svg, 20, 200, 200);
    expect(layer()).toHaveLength(2);
    const path = doc.getObjectByRepr(layer()[1] ?? null) as SPItem;
    expect(path.getRepr().attribute('style')).toContain('fill:black');
    expect(dt.getSelection().items()).toEqual([path]);
    expect(undoSteps()).toEqual(['Draw calligraphic stroke']);
    const bbox = path.documentGeometricBounds();
    expect(bbox?.height()).toBeCloseTo(10, 1);
    expect(bbox?.midpoint().y).toBeCloseTo(200, 1);
    // The pen lags behind the pointer (drag), so the stroke ends short of x1.
    expect(bbox?.left()).toBeGreaterThanOrEqual(20);
    expect(bbox?.right()).toBeLessThanOrEqual(200);
    expect(bbox?.width()).toBeGreaterThan(150);
  });

  it('with Shift the stroke is added to the selection, with Alt it is subtracted', () => {
    const { doc, dt, svg, layer } = setup();
    const rect = doc.getObjectById('r') as SPItem;

    dt.getSelection().set(rect);
    stroke(svg, 20, 200, 100, { shiftKey: true });
    expect(layer()).toHaveLength(1);
    const union = dt.getSelection().singleItem();
    expect(union?.documentGeometricBounds()?.top()).toBeCloseTo(80, 3);
    expect(union?.documentGeometricBounds()?.width()).toBeGreaterThan(150);

    stroke(svg, 20, 200, 100, { altKey: true });
    expect(layer()).toHaveLength(1);
    // The rect is cut in two by the stroke.
    expect(layer()[0]?.attribute('d')?.match(/[Mm]/g)).toHaveLength(2);
  });

  it('a click makes a dot with the fill of the tool style', () => {
    const { svg, layer, undoSteps } = setup();
    pointer(svg, 'pointerdown', 30, 40, 1);
    pointer(svg, 'pointerup', 30, 40, 0);
    // As upstream, the arc is written as a circle.
    expect(layer()[1]?.name()).toBe('svg:circle');
    expect(layer()[1]?.attribute('style')).toBe('fill:black;stroke:none');
    expect(undoSteps()).toEqual(['Create single dot']);
  });

  it('the arrow keys change the angle; Escape cancels the stroke', () => {
    const { svg, undoSteps } = setup();
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(Preferences.get().getDouble('/tools/calligraphic/angle')).toBe(85);

    pointer(svg, 'pointerdown', 20, 50, 1);
    pointer(svg, 'pointermove', 60, 50, 1);
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // As upstream, the release after the cancel is a click: it makes a dot.
    pointer(svg, 'pointerup', 60, 50, 0);
    expect(undoSteps()).toEqual(['Create single dot']);
  });
});

describe('add_cap', () => {
  it('bulges by rounding times half the edge distance', () => {
    const curve = new Path(new Point(0, 0));
    add_cap(curve, new Point(0, 0), new Point(0, 10), 1);
    // Rounding 1: handles of length 10 / sqrt(2); the cubic reaches 3/4 of them.
    expect(curve.boundsExact()?.left()).toBeCloseTo((-0.75 * 10) / Math.SQRT2, 6);
    expect(curve.finalPoint()).toEqual(new Point(0, 10));
  });
});
