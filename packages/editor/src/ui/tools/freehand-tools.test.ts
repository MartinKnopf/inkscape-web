// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/pen-tool.cpp, src/ui/tools/pencil-tool.cpp, src/ui/tools/freehand-base.cpp
// @vitest-environment happy-dom
import { DocumentUndo, SPDocument, sp_svg_read_pathv } from '@inkscape-web/core';
import { PathVector } from '@inkscape-web/geom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';

// Window = desktop = document coordinates (zoom 1, no viewBox); the layer is moved by (10, 20).
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="layer1" inkscape:groupmode="layer" transform="translate(10,20)"/></svg>';

function setup(tool: string) {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  tool_switch(tool, dt);
  const svg = dt.getCanvas().svg;
  /** The reprs in the layer. */
  const children = () => [...(doc.getObjectById('layer1')?.getRepr().children() ?? [])];
  /** The d attribute of the only object in the layer. */
  const d = () => {
    expect(children()).toHaveLength(1);
    return children()[0]?.attribute('d');
  };
  const undoSteps = () => doc.undoStack.undo.map((e) => e.description);
  return { doc, dt, svg, children, d, undoSteps };
}

type Mods = { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean };

/** A pointer event; buttons is 1 while the left button is down. */
function pointer(target: Element, type: string, x: number, y: number, buttons: number, mods: Mods = {}) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: 0, buttons, clientX: x, clientY: y, ...mods }),
  );
}

/** Move without a button, press, drag to the end point, release. */
function drag(target: Element, x0: number, y0: number, x1 = x0, y1 = y0, mods: Mods = {}) {
  pointer(target, 'pointermove', x0, y0, 0, mods);
  pointer(target, 'pointerdown', x0, y0, 1, mods);
  if (x1 !== x0 || y1 !== y0) {
    pointer(target, 'pointermove', (x0 + x1) / 2, (y0 + y1) / 2, 1, mods);
    pointer(target, 'pointermove', x1, y1, 1, mods);
  }
  pointer(target, 'pointerup', x1, y1, 0, mods);
}

function key(target: Element, key: string, mods: Mods = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...mods }));
}

// No layout in happy-dom: nothing is under the pointer.
beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(document, 'elementsFromPoint');
});

describe('PenTool', () => {
  it('clicks make line nodes; Enter writes the path in the layer with the tool style, selected', () => {
    const { dt, svg, d, children, undoSteps } = setup('Pen');
    drag(svg, 50, 60);
    drag(svg, 90, 60);
    drag(svg, 90, 100);
    expect(children()).toHaveLength(0);
    key(svg, 'Enter');
    expect(d()).toBe('M 40,40 H 80 V 80');
    expect(children()[0]?.attribute('style')).toBe(
      'fill:none;stroke:black;stroke-width:1px;stroke-linecap:butt;stroke-linejoin:miter;stroke-opacity:1',
    );
    expect(dt.getSelection().items()).toHaveLength(1);
    expect(undoSteps()).toEqual(['Draw path']);
  });

  it('a drag makes a curve node with symmetric handles', () => {
    const { svg, d } = setup('Pen');
    drag(svg, 50, 60);
    // The handle is dragged to (100, 90): the incoming handle is mirrored to (100, 30).
    drag(svg, 100, 60, 100, 90);
    drag(svg, 150, 60);
    key(svg, 'Enter');
    expect(d()).toBe('m 40,40 c 0,0 50,-30 50,0 0,30 50,0 50,0');
  });

  it('Ctrl snaps the angle of the segment', () => {
    const { svg, d } = setup('Pen');
    drag(svg, 50, 60);
    drag(svg, 150, 63, 150, 63, { ctrlKey: true });
    key(svg, 'Enter');
    expect(d()).toBe('M 40,40 H 140');
  });

  it('a click on the start anchor closes the path', () => {
    const { svg, d } = setup('Pen');
    drag(svg, 50, 60);
    drag(svg, 90, 60);
    drag(svg, 90, 100);
    drag(svg, 52, 61);
    expect(d()).toBe('M 40,40 H 80 V 80 Z');
  });

  it('a double click finishes the path', () => {
    const { svg, d } = setup('Pen');
    drag(svg, 50, 60);
    drag(svg, 90, 60);
    drag(svg, 90, 60);
    expect(d()).toBe('M 40,40 H 80');
  });

  it('the right button finishes the path', () => {
    const { svg, d } = setup('Pen');
    drag(svg, 50, 60);
    drag(svg, 90, 60);
    svg.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 2, buttons: 2, clientX: 99, clientY: 99 }),
    );
    expect(d()).toBe('M 40,40 H 80');
  });

  it('Backspace removes the last node, Esc cancels', () => {
    const a = setup('Pen');
    drag(a.svg, 50, 60);
    drag(a.svg, 90, 60);
    drag(a.svg, 90, 100);
    key(a.svg, 'Backspace');
    key(a.svg, 'Enter');
    expect(a.d()).toBe('M 40,40 H 80');

    const b = setup('Pen');
    drag(b.svg, 50, 60);
    drag(b.svg, 90, 60);
    key(b.svg, 'Escape');
    key(b.svg, 'Enter');
    expect(b.children()).toHaveLength(0);
    expect(b.undoSteps()).toEqual([]);
  });

  it('continues the selected path from an end anchor', () => {
    const { svg, d, undoSteps } = setup('Pen');
    drag(svg, 50, 60);
    drag(svg, 90, 60);
    key(svg, 'Enter');
    // The new path is selected; start at its start node.
    drag(svg, 51, 59);
    drag(svg, 50, 100);
    key(svg, 'Enter');
    expect(d()).toBe('M 80,40 H 40 v 40');
    expect(undoSteps()).toEqual(['Draw path', 'Draw path']);
  });
});

describe('PencilTool', () => {
  it('fits a smooth freehand stroke with few segments', () => {
    const { svg, d, undoSteps } = setup('Pencil');
    // A half circle around (150, 100) with radius 50, from (100, 100) to (200, 100).
    const pts = Array.from({ length: 61 }, (_, i) => {
      const a = Math.PI + (i / 60) * Math.PI;
      return [150 + 50 * Math.cos(a), 100 + 50 * Math.sin(a)] as const;
    });
    pointer(svg, 'pointerdown', 100, 100, 1);
    for (const [x, y] of pts.slice(1)) pointer(svg, 'pointermove', x, y, 1);
    pointer(svg, 'pointerup', 200, 100, 0);

    const pv = sp_svg_read_pathv(d());
    expect(PathVector.curveCount(pv)).toBeLessThanOrEqual(2);
    expect(pv[0]?.initialPoint().x).toBeCloseTo(90);
    expect(pv[0]?.initialPoint().y).toBeCloseTo(80);
    expect(pv[0]?.finalPoint().x).toBeCloseTo(190);
    expect(pv[0]?.finalPoint().y).toBeCloseTo(80);
    // The top of the arc is near (140, 30) in layer coordinates.
    expect(pv[0]?.boundsExact()?.top()).toBeCloseTo(30, 0);
    expect(undoSteps()).toEqual(['Draw path']);
  });

  it('a click and a second click draw a straight line', () => {
    const { svg, d } = setup('Pencil');
    drag(svg, 50, 60);
    pointer(svg, 'pointermove', 90, 100, 0);
    drag(svg, 90, 100);
    expect(d()).toBe('M 40,40 80,80');
  });

  it('Esc cancels a freehand stroke, Ctrl+click makes a dot', () => {
    const { svg, children, doc } = setup('Pencil');
    pointer(svg, 'pointerdown', 100, 100, 1);
    pointer(svg, 'pointermove', 120, 110, 1);
    pointer(svg, 'pointermove', 140, 100, 1);
    key(svg, 'Escape');
    pointer(svg, 'pointerup', 140, 100, 0);
    expect(children()).toHaveLength(0);

    drag(svg, 50, 60, 50, 60, { ctrlKey: true });
    // As upstream, the arc is written as a circle.
    const dot = children()[0];
    expect({ name: dot?.name(), ...Object.fromEntries(dot?.attributeList() ?? []) }).toEqual({
      name: 'svg:circle',
      id: 'path1',
      cx: '40',
      cy: '40',
      r: '1.5',
      style: 'fill:black;stroke:none',
    });
    DocumentUndo.undo(doc);
    expect(children()).toHaveLength(0);
  });
});
