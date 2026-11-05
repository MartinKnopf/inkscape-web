// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-canvas-mode.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SplitMode } from '../desktop.ts';
import { RenderMode } from '../display/drawing.ts';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';

afterEach(() => {
  vi.restoreAllMocks();
  InkscapeApplication.instance().activate_action('win.canvas-display-mode(0)');
  InkscapeApplication.instance().set_active_desktop(null);
});

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

  /** The hairlines mode with the path of the document, whose resolved stroke width and screen scale are given. */
  function hairlineSetup(computed: { strokeWidth: string; vectorEffect?: string }, scale: number) {
    const s = setup();
    s.run('win.canvas-display-mode(3)');
    const el = s.dt.getDrawing().root.element.querySelector('path, rect') as SVGGraphicsElement;
    // The attribute differs from the resolved style: the style is inherited or has a unit.
    el.setAttribute('stroke-width', '5');
    el.getScreenCTM = () => ({ a: scale, b: 0, c: 0, d: scale }) as DOMMatrix;
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (e) =>
        ({ vectorEffect: 'none', ...(e === el ? computed : { strokeWidth: '1px' }) }) as CSSStyleDeclaration,
    );
    return { ...s, el };
  }

  it('marks the strokes thinner than a pixel in the hairlines mode', () => {
    const { dt, run, attr, el } = hairlineSetup({ strokeWidth: '0.4px' }, 1);
    expect(attr()).toBe('hairlines');
    dt.getDrawing().updateHairlines();
    expect(el.hasAttribute('data-hairline')).toBe(true);
    // 1 px on the screen is 1 / scale in user units.
    expect(el.style.getPropertyValue('--hairline-width')).toBe('1');
    run('win.canvas-display-mode(0)');
    expect(el.hasAttribute('data-hairline')).toBe(false);
    expect(el.style.getPropertyValue('--hairline-width')).toBe('');
  });

  it('uses the resolved width (inherited, with units) times the scale of the element', () => {
    const { dt, el } = hairlineSetup({ strokeWidth: '0.4px' }, 4);
    dt.getDrawing().updateHairlines();
    // 0.4 * 4 = 1.6 px: wide enough, although the attribute says 5.
    expect(el.hasAttribute('data-hairline')).toBe(false);
    el.getScreenCTM = () => ({ a: 2, b: 0, c: 0, d: 2 }) as DOMMatrix;
    dt.getDrawing().updateHairlines();
    expect(el.hasAttribute('data-hairline')).toBe(true);
    expect(el.style.getPropertyValue('--hairline-width')).toBe('0.5');
  });

  it('compares the width of non-scaling strokes directly in screen px', () => {
    const { dt, el } = hairlineSetup({ strokeWidth: '2px', vectorEffect: 'non-scaling-stroke' }, 0.1);
    dt.getDrawing().updateHairlines();
    // 2 px on the screen, not 0.2 px.
    expect(el.hasAttribute('data-hairline')).toBe(false);
    vi.mocked(window.getComputedStyle).mockImplementation(
      () => ({ strokeWidth: '0.5px', vectorEffect: 'non-scaling-stroke' }) as CSSStyleDeclaration,
    );
    dt.getDrawing().updateHairlines();
    expect(el.hasAttribute('data-hairline')).toBe(true);
    expect(el.style.getPropertyValue('--hairline-width')).toBe('1');
  });

  it('only changes the width: the dashes keep scaling with the zoom', () => {
    const { dt, el } = hairlineSetup({ strokeWidth: '0.05px' }, 10);
    el.setAttribute('stroke-dasharray', '1 1');
    dt.getDrawing().updateHairlines();
    expect(el.hasAttribute('data-hairline')).toBe(true);
    expect(el.style.getPropertyValue('--hairline-width')).toBe('0.1');
    const css = dt.getDrawing().defs.querySelector('style')?.textContent ?? '';
    const rule = css.split('}').find((r) => r.includes('data-hairline')) ?? '';
    expect(rule).toContain('stroke-width:var(--hairline-width)');
    expect(rule).not.toContain('vector-effect');
    expect(el.style.getPropertyValue('vector-effect')).toBe('');
    expect(el.getAttribute('stroke-dasharray')).toBe('1 1');
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
