// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/zoom-tool.cpp, src/desktop.cpp
// @vitest-environment happy-dom
import { SPDocument } from '@inkscape-web/core';
import { Point, type Rect } from '@inkscape-web/geom';
import { beforeEach, describe, expect, it } from 'vitest';
import { tool_switch } from '../../actions/actions-tools.ts';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import { click_zoom_factor, ZoomTool } from './zoom-tool.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect id="r" x="10" y="10" width="20" height="10"/></svg>';

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  dt.zoom_absolute(new Point(0, 0), 1, false);
  dt.scroll_absolute(new Point(0, 0));
  tool_switch('Zoom', dt);
  return { dt, svg: dt.getCanvas().svg };
}

type Mods = { shiftKey?: boolean };
function pointer(target: Element, type: string, x: number, y: number, button = 0, mods: Mods = {}) {
  const buttons = type === 'pointerup' ? 0 : 1 << button;
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button, buttons, clientX: x, clientY: y, ...mods }),
  );
}

beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
});

describe('click_zoom_factor', () => {
  it('zooms in with the left button and out with the right; Shift inverts', () => {
    expect(click_zoom_factor('left', false, 2)).toBe(2);
    expect(click_zoom_factor('right', false, 2)).toBe(0.5);
    expect(click_zoom_factor('left', true, 2)).toBe(0.5);
    expect(click_zoom_factor('right', true, 2)).toBe(2);
  });
});

describe('ZoomTool', () => {
  it('is created by the tool switch', () => {
    const { dt } = setup();
    expect(dt.getTool()).toBeInstanceOf(ZoomTool);
  });

  it('a click zooms in by the zoom increment around the pointer, Shift+click zooms out', () => {
    const { dt, svg } = setup();
    const before = dt.current_zoom();
    const at = dt.w2d(new Point(100, 100));
    pointer(svg, 'pointerdown', 100, 100);
    pointer(svg, 'pointerup', 100, 100);
    expect(dt.current_zoom() / before).toBeCloseTo(Math.SQRT2, 9);
    // The point under the pointer stays where it was.
    const window = dt.d2w(at).sub(dt.getCanvas().get_pos());
    expect(window.x).toBeCloseTo(100, 0);
    expect(window.y).toBeCloseTo(100, 0);

    pointer(svg, 'pointerdown', 100, 100, 0, { shiftKey: true });
    pointer(svg, 'pointerup', 100, 100, 0, { shiftKey: true });
    expect(dt.current_zoom()).toBeCloseTo(before, 9);
  });

  it('a drag zooms to the rubberband rectangle with a border of 10 px', () => {
    const { dt, svg } = setup();
    // Window = desktop at zoom 1: drag (100,100)-(300,200) on an 800 x 600 window.
    pointer(svg, 'pointerdown', 100, 100);
    pointer(svg, 'pointermove', 200, 150);
    pointer(svg, 'pointermove', 300, 200);
    pointer(svg, 'pointerup', 300, 200);
    // The width limits: (800 - 20) / 200 = 3.9
    expect(dt.current_zoom()).toBeCloseTo(3.9, 6);
    const area: Rect = dt.get_display_area();
    expect(area.midpoint().x).toBeCloseTo(200, 6);
    expect(area.midpoint().y).toBeCloseTo(150, 6);
    expect(area.width()).toBeCloseTo(800 / 3.9, 6);
  });
});
