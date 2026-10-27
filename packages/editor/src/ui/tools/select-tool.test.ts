// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/select-tool.cpp, src/seltrans.cpp, src/rubberband.cpp
// @vitest-environment happy-dom
import { DocumentUndo, SPDocument, SPItem } from '@inkscape-web/core';
import { Rect } from '@inkscape-web/geom';
import { afterEach, describe, expect, it } from 'vitest';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';

// Window = world = desktop = document coordinates: zoom 1, no scroll, no viewBox.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect id="a" x="10" y="10" width="20" height="20"/>' +
  '<g id="g"><rect id="b" x="100" y="10" width="20" height="20"/><rect id="c" x="130" y="10" width="20" height="20"/></g>' +
  '</svg>';

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  doc.ensureUpToDate();
  const item = (id: string) => doc.getObjectById(id) as SPItem;
  const ids = () =>
    dt
      .getSelection()
      .items()
      .map((i) => i.getId());
  return { doc, dt, item, ids, svg: dt.getCanvas().svg };
}

/**
 * Let elementsFromPoint (no layout in happy-dom) return the drawing elements
 * of the items whose document bounds contain the point, topmost first.
 */
function mockHitTest(doc: SPDocument, dt: SPDesktop) {
  const elementsFromPoint = (x: number, y: number) => {
    const hits: Element[] = [];
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

type Mods = { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean };

function pointer(target: Element, type: string, x: number, y: number, mods: Mods = {}) {
  const init = {
    bubbles: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: x,
    clientY: y,
    ...mods,
  };
  target.dispatchEvent(new PointerEvent(type, init));
}

/** Press at (x0, y0), move to (x1, y1) and release. */
function drag(target: Element, x0: number, y0: number, x1: number, y1: number, mods: Mods = {}) {
  pointer(target, 'pointerdown', x0, y0, mods);
  pointer(target, 'pointermove', (x0 + x1) / 2, (y0 + y1) / 2, mods);
  pointer(target, 'pointermove', x1, y1, mods);
  pointer(target, 'pointerup', x1, y1, mods);
}

const click = (target: Element, x: number, y: number, mods: Mods = {}) => drag(target, x, y, x, y, mods);

function key(target: Element, k: string, mods: Mods = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...mods }));
}

afterEach(() => {
  Reflect.deleteProperty(document, 'elementsFromPoint');
});

describe('SelectTool clicks', () => {
  it('selects the top-level object, Ctrl selects in groups, Shift toggles, empty click clears', () => {
    const { doc, dt, ids, svg } = setup();
    mockHitTest(doc, dt);
    click(svg, 105, 15);
    expect(ids()).toEqual(['g']);
    click(svg, 105, 15, { ctrlKey: true });
    expect(ids()).toEqual(['b']);
    click(svg, 15, 15, { shiftKey: true });
    expect(ids()).toEqual(['b', 'a']);
    click(svg, 15, 15, { shiftKey: true });
    expect(ids()).toEqual(['b']);
    click(svg, 300, 200);
    expect(ids()).toEqual([]);
  });

  it('double click enters a group, then clicks select inside it', () => {
    const { doc, dt, ids, svg, item } = setup();
    mockHitTest(doc, dt);
    click(svg, 105, 15);
    svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 105, clientY: 15 }));
    expect(dt.layerManager().currentLayer()).toBe(item('g'));
    click(svg, 135, 15);
    expect(ids()).toEqual(['c']);
    key(svg, 'Escape');
    key(svg, 'Escape');
    expect(dt.layerManager().currentLayer()).toBe(doc.getRoot());
    expect(ids()).toEqual(['g']);
  });
});

describe('SelectTool rubberband', () => {
  it('selects the objects fully inside the rectangle', () => {
    const { doc, dt, ids, svg } = setup();
    mockHitTest(doc, dt);
    drag(svg, 5, 5, 125, 35);
    expect(ids()).toEqual(['a']);
    drag(svg, 5, 5, 155, 35);
    expect(ids()).toEqual(['a', 'g']);
    // Shift adds, Shift+Ctrl removes.
    drag(svg, 5, 5, 35, 35, { shiftKey: true, ctrlKey: true });
    expect(ids()).toEqual(['g']);
  });

  it('draws the rectangle in the controls layer while dragging', () => {
    const { doc, dt, svg } = setup();
    mockHitTest(doc, dt);
    pointer(svg, 'pointerdown', 5, 5);
    pointer(svg, 'pointermove', 50, 40);
    const rect = dt.getCanvas().controlsLayer.querySelector('.CanvasItemRect rect');
    expect([rect?.getAttribute('x'), rect?.getAttribute('width'), rect?.getAttribute('height')]).toEqual([
      '5',
      '45',
      '35',
    ]);
    pointer(svg, 'pointerup', 50, 40);
    expect(
      dt.getCanvas().controlsLayer.querySelector('.CanvasItemRect rect[stroke="rgba(39,127,255,1)"]'),
    ).toBeNull();
  });
});

describe('SelectTool moves', () => {
  it('drags an object with one undo step "Move"', () => {
    const { doc, dt, item, ids, svg } = setup();
    mockHitTest(doc, dt);
    pointer(svg, 'pointerdown', 15, 15);
    // As upstream, the drag starts at the first point beyond the drag tolerance (4 px).
    pointer(svg, 'pointermove', 20, 15);
    pointer(svg, 'pointermove', 50, 35);
    pointer(svg, 'pointerup', 50, 35);
    expect(ids()).toEqual(['a']);
    expect([item('a').getAttribute('x'), item('a').getAttribute('y')]).toEqual(['40', '30']);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Move']);
    DocumentUndo.undo(doc);
    expect(item('a').getAttribute('x')).toBe('10');
  });

  it('moves with the arrow keys by the nudge distance, merging steps', () => {
    const { doc, dt, item, svg } = setup();
    dt.getSelection().set(item('g'));
    key(svg, 'ArrowRight');
    key(svg, 'ArrowRight');
    key(svg, 'ArrowDown', { shiftKey: true });
    expect(item('g').getAttribute('transform')).toBe('translate(4,20)');
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Move horizontally', 'Move vertically']);
  });

  it('Escape deselects and Delete deletes with undo "Delete"', () => {
    const { doc, dt, item, ids, svg } = setup();
    dt.getSelection().set(item('a'));
    key(svg, 'Escape');
    expect(ids()).toEqual([]);
    dt.getSelection().set(item('a'));
    key(svg, 'Delete');
    expect(doc.getObjectById('a')).toBeNull();
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Delete');
  });
});

describe('SelTrans', () => {
  it('shows the dashed cue and scale handles, and scales with a corner handle', async () => {
    const { doc, dt, item } = setup();
    dt.getSelection().set(item('a'));
    const controls = dt.getCanvas().controlsLayer;
    expect(controls.querySelector('rect[stroke-dasharray="4 4"]')).not.toBeNull();
    const knots = [...controls.querySelectorAll('.CanvasItemCtrl:not([visibility])')];
    expect(knots).toHaveLength(8);

    // The bottom right scale handle: its arrow is right of and below the bbox.
    const position = (k: Element): [number, number] => {
      const m = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(
        k.querySelector('path')?.getAttribute('transform') ?? '',
      );
      return m ? [Number(m[1]), Number(m[2])] : [0, 0];
    };
    const knot = knots.find((k) => position(k)[0] > 30 && position(k)[1] > 30);
    if (!knot) throw new Error('no bottom right handle');
    drag(knot, 30, 30, 50, 40);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Scale']);
    doc.ensureUpToDate();
    expect(
      item('a')
        .desktopGeometricBounds()
        ?.equals(new Rect(10, 10, 50, 40)),
    ).toBe(true);
    // The handles follow the new bounds after the selection is modified.
    await Promise.resolve();
    const [x, y] = position(knot);
    expect(x > 50 && x < 70 && y > 40 && y < 60).toBe(true);
  });
});
