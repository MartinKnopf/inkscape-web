// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/pages-tool.cpp, src/actions/actions-pages.cpp
// @vitest-environment happy-dom
import { DocumentUndo, Preferences, SPDocument, type SPRect } from '@inkscape-web/core';
import { Point, type Rect } from '@inkscape-web/geom';
import { beforeEach, describe, expect, it } from 'vitest';
import { page_backward, page_forward, page_new } from '../../actions/actions-pages.ts';
import { tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import { PagesTool } from './pages-tool.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="r" x="10" y="10" width="20" height="10"/></svg>';

function setup(svg = SVG) {
  const doc = SPDocument.createNewDocFromMem(svg);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  // Window = desktop at zoom 1.
  dt.zoom_absolute(new Point(0, 0), 1, false);
  dt.scroll_absolute(new Point(0, 0));
  tool_switch('Pages', dt);
  return { dt, doc, svg: dt.getCanvas().svg, pm: doc.getPageManager() };
}

function drag(target: Element, from: [number, number], to: [number, number]) {
  const ev = (type: string, [x, y]: [number, number], buttons: number) =>
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, buttons, clientX: x, clientY: y }),
    );
  ev('pointerdown', from, 1);
  ev('pointermove', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], 1);
  ev('pointermove', to, 1);
  ev('pointerup', to, 0);
}

const xywh = (r: Rect | null | undefined) => (r ? [r.left(), r.top(), r.width(), r.height()] : null);

beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
  Preferences.get().setBool('/tools/pages/move_objects', true);
});

describe('PagesTool', () => {
  it('is created by the tool switch and clears the selection', () => {
    const doc = SPDocument.createNewDocFromMem(SVG);
    if (!doc) throw new Error('parse failed');
    const host = document.createElement('div');
    const dt = new SPDesktop(new Canvas(host), doc);
    dt.getSelection().set(doc.getObjectById('r') as SPRect);
    tool_switch('Pages', dt);
    expect(dt.getTool()).toBeInstanceOf(PagesTool);
    expect(dt.getSelection().isEmpty()).toBe(true);
    tool_switch('Select', dt);
    expect(
      dt
        .getSelection()
        .items()
        .map((i) => i.getId()),
    ).toEqual(['r']);
  });

  it('a drag outside the page draws a new page; the viewport becomes the first page', () => {
    const { svg, pm, doc } = setup();
    drag(svg, [200, 20], [260, 100]);
    expect(pm.getPageCount()).toBe(2);
    expect(xywh(pm.getFirstPage()?.getRect())).toEqual([0, 0, 100, 100]);
    expect(xywh(pm.getSelected()?.getRect())).toEqual([200, 20, 60, 80]);
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Create new drawn page');
    DocumentUndo.undo(doc);
    expect(pm.getPageCount()).toBe(0);
  });

  it('dragging a page moves it with the objects on it', () => {
    const { svg, pm, doc } = setup(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs><view viewBox="0 0 100 100"/><view viewBox="200 0 100 100"/></defs><rect id="r" x="210" y="10" width="20" height="10"/></svg>',
    );
    drag(svg, [250, 50], [250, 150]);
    expect(xywh(pm.getSelected()?.getRect())).toEqual([200, 100, 100, 100]);
    doc.ensureUpToDate();
    expect(xywh((doc.getObjectById('r') as SPRect).desktopGeometricBounds())).toEqual([210, 110, 20, 10]);
  });

  it('Delete removes the selected page and goes back to a single page', () => {
    const { svg, pm } = setup();
    drag(svg, [200, 20], [260, 100]);
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(pm.hasPages()).toBe(false);
  });

  it('shows the resize knots at the corners of the selected page', () => {
    const { dt, svg } = setup();
    drag(svg, [200, 20], [260, 100]);
    const tool = dt.getTool() as PagesTool;
    expect(tool.resize_knots.map((k) => [k.position().x, k.position().y])).toEqual([
      [200, 20],
      [260, 20],
      [260, 100],
      [200, 100],
    ]);
  });
});

describe('page actions', () => {
  it('page_new adds a page of the selected size; page_forward and page_backward reorder it', () => {
    const { pm, doc } = setup();
    page_new(doc);
    page_new(doc);
    expect(pm.getPages().map((p) => p.getRect().left())).toEqual([0, 110, 220]);
    const last = pm.getSelected();
    page_backward(doc);
    expect(pm.getPageIndex(last)).toBe(1);
    // The page positions are swapped with the order.
    expect(last?.getRect().left()).toBe(110);
    page_forward(doc);
    expect(pm.getPageIndex(last)).toBe(2);
  });
});
