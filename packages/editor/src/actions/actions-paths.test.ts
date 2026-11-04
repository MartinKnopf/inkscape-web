// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-paths.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop, useWasmBackend } from '../ui/tools/tool-test-utils.ts';

await useWasmBackend();

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('win.path-reverse', () => {
  it('reverses the path and its node types, with one undo step', () => {
    const { dt, item, undoSteps } = setupDesktop(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="400" height="300">' +
        '<path id="p" d="M 0,0 L 10,0 L 10,10" sodipodi:nodetypes="ccs"/></svg>',
      'Select',
    );
    const app = InkscapeApplication.instance();
    app.set_active_desktop(dt);
    dt.getSelection().set(item('p'));
    expect(app.activate_action('win.path-reverse')).toBe(true);
    expect(item('p').getAttribute('d')).toBe('M 10,10 V 0 H 0');
    expect(item('p').getAttribute('sodipodi:nodetypes')).toBe('scc');
    expect(undoSteps()).toEqual(['Reverse path']);
  });
});

describe('offset actions', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
    '<rect id="r" x="10" y="10" width="40" height="40" style="fill:red;stroke:none"/></svg>';
  const bounds = (item: { documentVisualBounds(): { left(): number; right(): number } | null }) => {
    const b = item.documentVisualBounds();
    return b ? [Math.round(b.left()), Math.round(b.right())] : null;
  };

  it('app.path-offset grows by the default offset width, win.path-inset-screen divides by the zoom', () => {
    const { dt, item, undoSteps } = setupDesktop(svg, 'Select');
    const app = InkscapeApplication.instance();
    app.set_active_desktop(dt);
    dt.getSelection().set(item('r'));
    expect(app.activate_action('app.path-offset')).toBe(true);
    const grown = dt.getSelection().singleItem();
    expect(bounds(grown as never)).toEqual([8, 52]);
    expect(app.activate_action('win.path-inset-screen(8)')).toBe(true);
    const zoom = dt.current_zoom();
    expect(bounds(dt.getSelection().singleItem() as never)).toEqual([
      Math.round(8 + 8 / zoom),
      Math.round(52 - 8 / zoom),
    ]);
    expect(undoSteps()).toEqual(['Outset path', 'Inset path']);
  });

  it('win.path-offset-dynamic makes an offset object and switches to the node tool', () => {
    const { dt, item } = setupDesktop(svg, 'Select');
    const app = InkscapeApplication.instance();
    app.set_active_desktop(dt);
    dt.getSelection().set(item('r'));
    expect(app.activate_action('win.path-offset-dynamic')).toBe(true);
    expect(dt.getSelection().singleItem()?.getAttribute('sodipodi:type')).toBe('inkscape:offset');
    expect(dt.getTool()?.constructor.name).toBe('NodeTool');
  });
});

describe('app.object-stroke-to-path', () => {
  it('converts the stroke', () => {
    const { dt, item } = setupDesktop(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
        '<path id="p" d="M 10 50 L 90 50" style="fill:none;stroke:#000000;stroke-width:10"/></svg>',
      'Select',
    );
    const app = InkscapeApplication.instance();
    app.set_active_desktop(dt);
    dt.getSelection().set(item('p'));
    expect(app.activate_action('app.object-stroke-to-path')).toBe(true);
    expect(dt.getSelection().singleItem()?.getAttribute('style')).toContain('fill:#000000');
  });
});
