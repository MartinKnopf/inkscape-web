// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-layer.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="l1" inkscape:groupmode="layer" inkscape:label="One"><rect id="a" width="10" height="10"/></g>' +
  '<g id="l2" inkscape:groupmode="layer" inkscape:label="Two"/>' +
  '<g id="l3" inkscape:groupmode="layer" inkscape:label="Three"/></svg>';

function setup() {
  const s = setupDesktop(SVG, 'Select');
  const app = InkscapeApplication.instance();
  app.set_active_desktop(s.dt);
  const current = () => s.dt.layerManager().currentLayer()?.getId();
  // The layers of the root in document order (the root also has a namedview and defs).
  const order = () =>
    [...s.doc.getRoot().children]
      .filter((c) => c.getAttribute('inkscape:groupmode') === 'layer')
      .map((c) => c.getId());
  return { ...s, current, order, run: (a: string) => expect(app.activate_action(a)).toBe(true) };
}

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('layer actions', () => {
  it('switches to the layer above (next in the document) and below', () => {
    const { dt, item, current, run } = setup();
    dt.layerManager().setCurrentLayer(item('l2'));
    run('win.layer-previous');
    expect(current()).toBe('l3');
    run('win.layer-next');
    run('win.layer-next');
    expect(current()).toBe('l1');
    run('win.layer-next'); // nothing before the first layer
    expect(current()).toBe('l1');
  });

  it('adds a layer above the current one and deletes it, with the previous layer as survivor', () => {
    const { dt, item, current, order, run, undoSteps } = setup();
    dt.layerManager().setCurrentLayer(item('l1'));
    run('win.layer-new-above');
    expect(order()).toHaveLength(4);
    expect(order()[1]).toBe(current());
    expect(undoSteps()).toEqual(['Add layer']);
    run('win.layer-delete');
    expect(order()).toEqual(['l1', 'l2', 'l3']);
    expect(current()).toBe('l1');
  });

  it('raises and lowers the current layer among its siblings', () => {
    const { dt, item, order, run } = setup();
    dt.layerManager().setCurrentLayer(item('l2'));
    run('win.layer-top');
    expect(order()).toEqual(['l1', 'l3', 'l2']);
    run('win.layer-bottom');
    expect(order()).toEqual(['l2', 'l1', 'l3']);
    run('win.layer-raise');
    expect(order()).toEqual(['l1', 'l2', 'l3']);
    run('win.layer-lower');
    expect(order()).toEqual(['l2', 'l1', 'l3']);
  });

  it('toggles hidden and locked, and converts between layer and group', () => {
    const { dt, item, run } = setup();
    dt.layerManager().setCurrentLayer(item('l1'));
    run('win.layer-hide-toggle');
    run('win.layer-lock-toggle');
    expect([item('l1').isHidden(), item('l1').isLocked()]).toEqual([true, true]);
    run('win.layer-to-group');
    expect(item('l1').getAttribute('inkscape:groupmode')).toBeNull();
    expect(dt.getSelection().singleItem()?.getId()).toBe('l1');
    run('win.layer-from-group');
    expect(item('l1').getAttribute('inkscape:groupmode')).toBe('layer');
  });
});
