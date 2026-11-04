// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-canvas-mode.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { SplitMode } from '../desktop.ts';
import { RenderMode } from '../display/drawing.ts';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

function setup() {
  const s = setupDesktop(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="10" height="10"/></svg>',
    'Select',
  );
  InkscapeApplication.instance().set_active_desktop(s.dt);
  const run = (a: string) => expect(InkscapeApplication.instance().activate_action(a)).toBe(true);
  const attr = () => s.dt.getDrawing().root.element.getAttribute('data-render-mode');
  return { ...s, run, attr };
}

describe('display modes', () => {
  it('sets the render mode of the drawing', () => {
    const { dt, run, attr } = setup();
    expect(attr()).toBeNull();
    run('win.canvas-display-mode(1)');
    expect(dt.getRenderMode()).toBe(RenderMode.OUTLINE);
    expect(attr()).toBe('outline');
    run('win.canvas-display-mode(2)');
    expect(attr()).toBe('nofilters');
    run('win.canvas-display-mode(4)');
    expect(attr()).toBe('overlay');
    run('win.canvas-display-mode(0)');
    expect(attr()).toBeNull();
    // The style sheet is in the defs of the drawing.
    expect(dt.getDrawing().defs.querySelector('style')?.textContent).toContain('data-render-mode="outline"');
  });

  it('cycles through the modes and toggles between normal and the last other mode', () => {
    const { dt, run } = setup();
    const seen: RenderMode[] = [];
    for (let i = 0; i < 6; i++) {
      run('win.canvas-display-mode-cycle');
      seen.push(dt.getRenderMode());
    }
    expect(seen).toEqual([1, 2, 3, 4, 0, 1]);
    run('win.canvas-display-mode(2)');
    run('win.canvas-display-mode-toggle');
    expect(dt.getRenderMode()).toBe(RenderMode.NORMAL);
    run('win.canvas-display-mode-toggle');
    expect(dt.getRenderMode()).toBe(RenderMode.NO_FILTERS);
  });

  it('rejects a mode out of range', () => {
    const { dt } = setup();
    expect(InkscapeApplication.instance().activate_action('win.canvas-display-mode(9)')).toBe(true);
    expect(dt.getRenderMode()).toBe(RenderMode.NORMAL);
  });
});

describe('split mode', () => {
  it('shows a second, outline view of the document and removes it when turned off', () => {
    const { dt, run } = setup();
    const layer = dt.getCanvas().desktopLayer;
    const count = layer.children.length;
    run('win.canvas-split-mode(1)');
    expect(dt.getSplitMode()).toBe(SplitMode.SPLIT);
    expect(layer.querySelectorAll('[data-render-mode="outline"]')).toHaveLength(1);
    run('win.canvas-split-mode(2)');
    expect(dt.getSplitMode()).toBe(SplitMode.XRAY);
    // The same mode again turns it off.
    run('win.canvas-split-mode(2)');
    expect(dt.getSplitMode()).toBe(SplitMode.NORMAL);
    expect(layer.querySelectorAll('[data-render-mode="outline"]')).toHaveLength(0);
    expect(layer.children.length).toBe(count);
  });
});
