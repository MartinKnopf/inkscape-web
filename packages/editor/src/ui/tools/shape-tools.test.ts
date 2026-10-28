// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/rect-tool.cpp, src/ui/tools/arc-tool.cpp, src/ui/tools/star-tool.cpp, src/ui/tools/spiral-tool.cpp, src/actions/actions-tools.cpp
// @vitest-environment happy-dom
import { DocumentUndo, SPDocument } from '@inkscape-web/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get_active_tool, tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import { RectTool } from './rect-tool.ts';
import { SelectTool } from './select-tool.ts';

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
  /** The element name and attributes of the only object in the layer. */
  const created = () => {
    const children = [...(doc.getObjectById('layer1')?.getRepr().children() ?? [])];
    expect(children).toHaveLength(1);
    return { name: children[0]?.name(), ...Object.fromEntries(children[0]?.attributeList() ?? []) };
  };
  return { doc, dt, svg, created };
}

type Mods = { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean };

function pointer(target: Element, type: string, x: number, y: number, mods: Mods = {}) {
  const buttons = type === 'pointerup' ? 0 : 1;
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: 0, buttons, clientX: x, clientY: y, ...mods }),
  );
}

function drag(target: Element, x0: number, y0: number, x1: number, y1: number, mods: Mods = {}) {
  pointer(target, 'pointerdown', x0, y0, mods);
  pointer(target, 'pointermove', (x0 + x1) / 2, (y0 + y1) / 2, mods);
  pointer(target, 'pointermove', x1, y1, mods);
  pointer(target, 'pointerup', x1, y1, mods);
}

// No layout in happy-dom: nothing is under the pointer.
beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(document, 'elementsFromPoint');
});

const undoSteps = (doc: SPDocument) => doc.undoStack.undo.map((e) => e.description);

describe('tool switching', () => {
  it('win.tool-switch sets the active tool by name, Space toggles the selector', () => {
    const { dt, svg } = setup('Rect');
    const changes: string[] = [];
    dt.connectEventContextChanged((d) => changes.push(get_active_tool(d)));
    expect(dt.getTool()).toBeInstanceOf(RectTool);
    expect(get_active_tool(dt)).toBe('Rect');
    svg.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    expect(dt.getTool()).toBeInstanceOf(SelectTool);
    svg.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    expect(get_active_tool(dt)).toBe('Rect');
    expect(changes).toEqual(['Select', 'Rect']);
  });
});

describe('RectTool', () => {
  it('drags a rectangle in the current layer with the tool style, selected, one undo step', () => {
    const { doc, dt, svg, created } = setup('Rect');
    drag(svg, 50, 60, 90, 80);
    expect(created()).toMatchObject({
      x: '40',
      y: '40',
      width: '40',
      height: '20',
      // As upstream, fill-rule is removed from tool styles (sp_css_attr_unset_blacklist).
      style: 'fill:blue',
    });
    expect(dt.getSelection().items()).toHaveLength(1);
    expect(undoSteps(doc)).toEqual(['Create rectangle']);
    DocumentUndo.undo(doc);
    expect([...(doc.getObjectById('layer1')?.getRepr().children() ?? [])]).toHaveLength(0);
  });

  it('Ctrl makes a square, Shift draws around the start point', () => {
    const a = setup('Rect');
    drag(a.svg, 50, 60, 90, 95, { ctrlKey: true });
    expect(a.created()).toMatchObject({ width: '35', height: '35' });
    const b = setup('Rect');
    drag(b.svg, 50, 60, 70, 70, { shiftKey: true });
    expect(b.created()).toMatchObject({ x: '20', y: '30', width: '40', height: '20' });
  });

  it('a click without drag creates nothing and clears the selection', () => {
    const { doc, dt, svg } = setup('Rect');
    drag(svg, 50, 60, 90, 80);
    drag(svg, 200, 200, 200, 200);
    expect(dt.getSelection().isEmpty()).toBe(true);
    expect(undoSteps(doc)).toEqual(['Create rectangle']);
  });
});

describe('ArcTool', () => {
  it('drags an ellipse in the box, Ctrl makes a circle', () => {
    const { doc, svg, created } = setup('Arc');
    drag(svg, 50, 60, 90, 80);
    // A whole ellipse is written as svg:ellipse, a circle as svg:circle.
    expect(created()).toMatchObject({
      name: 'svg:ellipse',
      cx: '60',
      cy: '50',
      rx: '20',
      ry: '10',
      style: 'fill:red',
    });
    expect(undoSteps(doc)).toEqual(['Create ellipse']);
    const b = setup('Arc');
    drag(b.svg, 50, 60, 90, 95, { ctrlKey: true });
    expect(b.created()).toMatchObject({ name: 'svg:circle', r: '17.5' });
  });
});

describe('StarTool', () => {
  it('drags a star from the center with the tool preferences', () => {
    const { doc, dt, svg, created } = setup('Star');
    drag(svg, 50, 60, 80, 60);
    expect(created()).toMatchObject({
      'sodipodi:type': 'star',
      'sodipodi:sides': '5',
      'sodipodi:cx': '40',
      'sodipodi:cy': '40',
      'sodipodi:r1': '30',
      'sodipodi:r2': '15',
      'sodipodi:arg1': '0',
      'inkscape:flatsided': 'false',
      style: 'fill:yellow',
    });
    expect(undoSteps(doc)).toEqual(['Create star']);
    expect(dt.getSelection().items()).toHaveLength(1);
  });
});

describe('SpiralTool', () => {
  it('drags a spiral from the center', () => {
    const { doc, svg, created } = setup('Spiral');
    drag(svg, 50, 60, 50, 100);
    expect(created()).toMatchObject({
      'sodipodi:type': 'spiral',
      'sodipodi:cx': '40',
      'sodipodi:cy': '40',
      'sodipodi:radius': '40',
      'sodipodi:revolution': '3',
      'sodipodi:expansion': '1',
      style: 'fill:none;stroke:black',
    });
    expect(undoSteps(doc)).toEqual(['Create spiral']);
  });
});
