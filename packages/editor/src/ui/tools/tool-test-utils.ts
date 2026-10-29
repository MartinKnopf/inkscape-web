// SPDX-License-Identifier: GPL-2.0-or-later
// Helpers for the tests of the tools (happy-dom): a desktop on a document,
// pointer events, hit testing and the path boolop backend. Not used by the app.
import { SPDocument, SPItem, setPathBoolopBackend } from '@inkscape-web/core';
import { Rect } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';

/** Set the WASM path backend. In happy-dom the module would read the wasm file from an http URL. */
export async function useWasmBackend(): Promise<void> {
  const wasm = `${import.meta.dirname}/../../../../wasm/dist/geom-module.wasm`;
  setPathBoolopBackend(await loadGeom({ locateFile: () => wasm }));
}

/**
 * A desktop of 800 x 600 px on the document svg with the tool active.
 * Window = desktop = document coordinates (zoom 1) if the document has no viewBox.
 */
export function setupDesktop(svg: string, tool: string) {
  const doc = SPDocument.createNewDocFromMem(svg);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  doc.ensureUpToDate();
  tool_switch(tool, dt);
  const item = (id: string) => doc.getObjectById(id) as SPItem;
  const undoSteps = () => doc.undoStack.undo.map((e) => e.description);
  return { doc, dt, svg: dt.getCanvas().svg, item, undoSteps };
}

export type Mods = { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean };

/** Dispatch a pointer event; buttons is 1 while the left button is down. */
export function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  buttons: number,
  mods: Mods = {},
) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: 0, buttons, clientX: x, clientY: y, ...mods }),
  );
}

/** Press at the first point, move through the others and release at the last one. */
export function stroke(target: Element, points: readonly [number, number][], mods: Mods = {}) {
  const [first, ...rest] = points;
  if (!first) return;
  pointer(target, 'pointerdown', first[0], first[1], 1, mods);
  for (const [x, y] of rest) pointer(target, 'pointermove', x, y, 1, mods);
  const [x, y] = rest.at(-1) ?? first;
  pointer(target, 'pointerup', x, y, 0, mods);
}

/** The points from (x0, y0) to (x1, y1) every `step` px. */
export function line(x0: number, y0: number, x1: number, y1: number, step = 5): [number, number][] {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
}

export function key(target: Element, key: string, mods: Mods = {}, type = 'keydown') {
  target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...mods }));
}

/**
 * Let elementsFromPoint (no layout in happy-dom) return the drawing elements
 * of the items whose document bounds contain the point, topmost first.
 * Without a desktop, nothing is hit.
 */
export function mockHitTest(doc?: SPDocument, dt?: SPDesktop): void {
  const elementsFromPoint = (x: number, y: number) => {
    const hits: Element[] = [];
    if (!doc || !dt) return hits;
    const visit = (o: SPItem) => {
      for (const c of o.children) if (c instanceof SPItem) visit(c);
      const b = o.documentVisualBounds();
      const el = o.getArenaitem(dt.dkey);
      if (b?.contains(new Rect(x, y, x, y)) && el && 'element' in el) hits.push(el.element as Element);
    };
    visit(doc.getRoot());
    return hits.reverse();
  };
  Object.defineProperty(document, 'elementsFromPoint', { value: elementsFromPoint, configurable: true });
}

export function unmockHitTest(): void {
  Reflect.deleteProperty(document, 'elementsFromPoint');
}
