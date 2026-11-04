// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-layer.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { LayerRelativePosition } from '../layer-manager.ts';
import { type LayerPropertiesRequest, setLayerPropertiesPresenter } from '../ui/dialog/layer-properties.ts';
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

describe('layer dialogs', () => {
  /** Run the action and return the request that it makes to the dialog. */
  function ask(run: (a: string) => void, action: string): LayerPropertiesRequest {
    let request: LayerPropertiesRequest | undefined;
    const off = setLayerPropertiesPresenter((r) => {
      request = r;
    });
    run(action);
    off();
    if (!request) throw new Error('no dialog');
    return request;
  }

  it('win.layer-new proposes the next free name and adds the layer at the chosen position', () => {
    const { dt, item, current, order, run, undoSteps } = setup();
    dt.layerManager().setCurrentLayer(item('l2'));
    const request = ask(run, 'win.layer-new');
    expect(request).toMatchObject({ type: 'create', name: 'Two 1', position_visible: true });
    if (request.type !== 'create') return;
    request.apply('Two', LayerRelativePosition.LPOS_BELOW);
    // The name is made unique, the new layer is below the current one and current.
    expect(item(current() ?? '').label()).toBe('Two 1');
    expect(order().indexOf(current() ?? '')).toBe(1);
    expect(undoSteps()).toEqual(['Add layer']);
  });

  it('win.layer-rename renames the current layer', () => {
    const { dt, item, run, undoSteps } = setup();
    dt.layerManager().setCurrentLayer(item('l3'));
    const request = ask(run, 'win.layer-rename');
    expect(request).toMatchObject({ type: 'rename', name: 'Three' });
    if (request.type !== 'rename') return;
    request.apply('Top');
    expect(item('l3').label()).toBe('Top');
    expect(undoSteps()).toEqual(['Rename layer']);
  });

  it('win.selection-move-to-layer lists the layers and moves the selection into the chosen one', () => {
    const { dt, item, current, run, undoSteps } = setup();
    dt.layerManager().setCurrentLayer(item('l1'));
    dt.getSelection().set(item('a'));
    const request = ask(run, 'win.selection-move-to-layer');
    expect(request).toMatchObject({ type: 'move' });
    if (request.type !== 'move') return;
    expect(request.layers.map((l) => l.label)).toEqual(['One', 'Two', 'Three']);
    request.apply(item('l3'));
    expect(item('a').parent).toBe(item('l3'));
    expect(current()).toBe('l3');
    expect(undoSteps()).toEqual(['Move selection to layer']);
  });

  it('win.selection-move-to-layer-above moves to the next layer, and stops at the last', () => {
    const { dt, item, current, run, undoSteps } = setup();
    dt.layerManager().setCurrentLayer(item('l1'));
    dt.getSelection().set(item('a'));
    run('win.selection-move-to-layer-above');
    expect(item('a').parent).toBe(item('l2'));
    expect(current()).toBe('l2');
    run('win.selection-move-to-layer-above');
    run('win.selection-move-to-layer-above'); // no more layers above
    expect(item('a').parent).toBe(item('l3'));
    expect(undoSteps()).toEqual(['Raise to next layer', 'Raise to next layer']);
    run('win.selection-move-to-layer-below');
    expect(item('a').parent).toBe(item('l2'));
  });

  it('win.layer-duplicate duplicates the selected layer', () => {
    const { dt, item, order, run, undoSteps } = setup();
    dt.layerManager().setCurrentLayer(item('l1'));
    dt.getSelection().set(item('l1'));
    run('win.layer-duplicate');
    expect(order()).toHaveLength(4);
    expect(undoSteps()).toEqual(['Duplicate layer']);
  });
});
