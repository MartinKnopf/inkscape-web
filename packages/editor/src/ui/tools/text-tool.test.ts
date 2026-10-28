// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/text-tool.cpp
// @vitest-environment happy-dom
import { DocumentUndo, type Node, SPDocument, SPText } from '@inkscape-web/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import { TextTool } from './text-tool.ts';

// Window = desktop = document coordinates (zoom 1, no viewBox); the layer is moved by (10, 20).
// The core's fixed-width measurer: 40px text (the tool style) → 20px per character.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="layer1" inkscape:groupmode="layer" transform="translate(10,20)"/></svg>';

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  tool_switch('Text', dt);
  const tool = dt.getTool();
  if (!(tool instanceof TextTool)) throw new Error('no text tool');
  const svg = dt.getCanvas().svg;
  const layer = doc.getObjectById('layer1')!;
  const text = () => {
    const t = layer.children.find((c) => c instanceof SPText);
    if (!(t instanceof SPText)) throw new Error('no text');
    return t;
  };
  /** The lines of the text: the content of its tspans. */
  const lines = () => [...text().getRepr().children()].map((c) => content(c));
  const undoSteps = () => doc.undoStack.undo.map((e) => e.description);
  return { doc, dt, tool, svg, text, lines, undoSteps };
}

function content(node: Node): string {
  return node.type() === 'text' ? (node.content() ?? '') : [...node.children()].map(content).join('');
}

function click(target: Element, x: number, y: number) {
  for (const type of ['pointerdown', 'pointerup']) {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    );
  }
}

/** Type text as the browser does: the input receives it. */
function type(tool: TextTool, data: string) {
  tool.imc.value = data;
  tool.imc.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data }));
}

function key(tool: TextTool, key: string, mods: { shiftKey?: boolean; ctrlKey?: boolean } = {}) {
  tool.imc.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
}

// No layout in happy-dom: nothing is under the pointer.
beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(document, 'elementsFromPoint');
});

describe('TextTool', () => {
  it('creates text at the click with the tool style and merges typing into one undo step', () => {
    const { tool, svg, text, lines, undoSteps } = setup();
    click(svg, 50, 60);
    expect(tool.nascent_object).toBe(true);
    type(tool, 'Hel');
    type(tool, 'lo');
    const t = text();
    expect(t.getAttribute('x')).toBe('40');
    expect(t.getAttribute('y')).toBe('40');
    expect(t.getAttribute('xml:space')).toBe('preserve');
    expect(t.getAttribute('style')).toContain('font-size:40px');
    const tspan = t.getRepr().firstChild()!;
    expect(tspan.attribute('sodipodi:role')).toBe('line');
    expect(lines()).toEqual(['Hello']);
    expect(undoSteps()).toEqual(['Create text', 'Type text']);
    expect(tool.text_sel_end.charIndex()).toBe(5);
  });

  it('starts a new line with Enter and joins it again with Backspace', () => {
    const { tool, svg, lines, undoSteps, text } = setup();
    click(svg, 50, 60);
    type(tool, 'ab');
    key(tool, 'Enter');
    type(tool, 'c');
    expect(lines()).toEqual(['ab', 'c']);
    // The second line is 1.25 * 40px below the first.
    const second = text().getRepr().lastChild()!;
    expect(second.attribute('y')).toBe('90');
    key(tool, 'Backspace');
    expect(lines()).toEqual(['ab', '']);
    key(tool, 'Backspace');
    expect(lines()).toEqual(['ab']);
    expect(undoSteps()).toEqual([
      'Create text',
      'Type text',
      'New line',
      'Type text',
      'Backspace',
      'Backspace',
    ]);
  });

  it('moves the cursor with the arrow keys, selects with Shift and replaces the selection', () => {
    const { tool, svg, lines } = setup();
    click(svg, 50, 60);
    type(tool, 'abcd');
    key(tool, 'Home');
    expect(tool.text_sel_end.charIndex()).toBe(0);
    key(tool, 'ArrowRight');
    key(tool, 'ArrowRight', { shiftKey: true });
    key(tool, 'ArrowRight', { shiftKey: true });
    expect([tool.text_sel_start.charIndex(), tool.text_sel_end.charIndex()]).toEqual([1, 3]);
    type(tool, 'X');
    expect(lines()).toEqual(['aXd']);
    key(tool, 'a', { ctrlKey: true });
    key(tool, 'Delete');
    expect(lines()).toEqual(['']);
  });

  it('places the cursor in an existing text at the click', () => {
    const { tool, dt, svg, text } = setup();
    click(svg, 50, 60);
    type(tool, 'abcd');
    key(tool, 'Escape');
    expect(tool.textItem()).toBeNull();
    // The text is under the pointer; its characters start at x=50 (window), 20px each.
    const t = text();
    dt.getItemAtPoint = () => t;
    click(svg, 92, 50);
    expect(tool.textItem()).toBe(t);
    expect(tool.text_sel_end.charIndex()).toBe(2);
  });

  it('is undone and redone in steps', () => {
    const { doc, tool, svg, lines } = setup();
    click(svg, 50, 60);
    type(tool, 'ab');
    key(tool, 'Enter');
    DocumentUndo.undo(doc);
    expect(lines()).toEqual(['ab']);
    DocumentUndo.redo(doc);
    expect(lines()).toEqual(['ab', '']);
  });
});
