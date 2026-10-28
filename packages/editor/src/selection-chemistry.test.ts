// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/selection-chemistry.cpp, src/actions/actions-selection-window.cpp, src/actions/actions-object.cpp, src/actions/actions-edit.cpp
// @vitest-environment happy-dom
import { DocumentUndo, SPDocument, type SPItem } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { get_active_tool } from './actions/actions-tools.ts';
import { SPDesktop } from './desktop.ts';
import { InkscapeApplication } from './inkscape-application.ts';
import { Canvas } from './ui/widget/canvas.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="l1" inkscape:groupmode="layer"><rect id="a" x="10" y="10" width="20" height="20"/>' +
  '<rect id="b" x="40" y="10" width="20" height="20"/><rect id="h" x="0" y="0" width="5" height="5" style="display:none"/></g>' +
  '<g id="l2" inkscape:groupmode="layer"><rect id="c" x="100" y="10" width="20" height="20"/></g>' +
  '</svg>';

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  doc.ensureUpToDate();
  const app = new InkscapeApplication();
  app.set_active_desktop(dt);
  const item = (id: string) => doc.getObjectById(id) as SPItem;
  const ids = () =>
    dt
      .getSelection()
      .items()
      .map((i) => i.getId())
      .sort();
  dt.layerManager().setCurrentLayer(item('l1'));
  return { doc, dt, app, item, ids, run: (a: string) => expect(app.activate_action(a)).toBe(true) };
}

describe('selection actions', () => {
  it('selects all visible items of the current layer, of all layers, inverts and deselects', () => {
    const { dt, ids, item, run } = setup();
    run('win.select-all');
    expect(ids()).toEqual(['a', 'b']);
    run('win.select-all-layers');
    expect(ids()).toEqual(['a', 'b', 'c']);
    dt.getSelection().set(item('a'));
    run('win.select-invert');
    expect(ids()).toEqual(['b']);
    dt.getSelection().set(item('a'));
    run('win.select-invert-all');
    expect(ids()).toEqual(['b', 'c']);
    run('win.select-none');
    expect(ids()).toEqual([]);
    // With nothing selected, Escape switches to the selector.
    run("win.tool-switch('Rect')");
    run('win.select-none');
    expect(get_active_tool(dt)).toBe('Select');
  });

  it('flips around the selection center with an undo step, and deletes', () => {
    const { doc, dt, item, run } = setup();
    dt.getSelection().setList([item('a'), item('b')]);
    run('app.object-flip-horizontal');
    doc.ensureUpToDate();
    expect(item('a').documentVisualBounds()?.left()).toBeCloseTo(40);
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Flip horizontally');
    run('app.delete');
    expect(doc.getObjectById('a')).toBeNull();
    DocumentUndo.undo(doc);
    expect(doc.getObjectById('a')).not.toBeNull();
  });

  it('enables doc.undo and doc.redo with the undo stack', () => {
    const { app, dt, item, run } = setup();
    expect(app.actions.is_enabled('doc.undo')).toBe(false);
    dt.getSelection().set(item('a'));
    run('app.duplicate');
    expect(app.actions.is_enabled('doc.undo')).toBe(true);
    run('doc.undo');
    expect(app.actions.is_enabled('doc.redo')).toBe(true);
  });
});
