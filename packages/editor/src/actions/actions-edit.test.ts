// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-edit.cpp, src/actions/actions-object.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop, useWasmBackend } from '../ui/tools/tool-test-utils.ts';

await useWasmBackend();

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect id="r" x="10" y="20" width="30" height="40" style="fill:#ff0000;stroke:#0000ff"/>' +
  '<rect id="s" x="100" y="20" width="30" height="40" style="fill:#00ff00;stroke:none"/></svg>';

function setup(...ids: string[]) {
  const s = setupDesktop(SVG, 'Select');
  const app = InkscapeApplication.instance();
  app.set_active_desktop(s.dt);
  s.dt.getSelection().setList(ids.map(s.item));
  const run = (a: string) => expect(app.activate_action(a)).toBe(true);
  return { ...s, run };
}

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('app.swap-fill-and-stroke', () => {
  it('swaps the colors and keeps none as none, in one undo step', () => {
    const { item, run, undoSteps } = setup('r', 's');
    run('app.swap-fill-and-stroke');
    expect(item('r').style.fill.getColor().toString(false)).toBe('#0000ff');
    expect(item('r').style.stroke.getColor().toString(false)).toBe('#ff0000');
    expect(item('s').style.fill.isNone()).toBe(true);
    expect(item('s').style.stroke.getColor().toString(false)).toBe('#00ff00');
    expect(undoSteps()).toEqual(['Swap fill and stroke of an object']);
  });
});

describe('app.fit-canvas-to-selection', () => {
  it('resizes the page to the selection', () => {
    const { dt, run, undoSteps } = setup('r');
    run('app.fit-canvas-to-selection');
    expect(dt.getDocument().getDimensions().x).toBeGreaterThanOrEqual(30);
    expect(undoSteps()).toEqual(['Fit Page to Selection']);
  });
});

describe('app.object-to-guides and app.object-to-marker', () => {
  it('makes guides from the selection', () => {
    const { dt, run, undoSteps } = setup('s');
    run('app.object-to-guides');
    expect(dt.getDocument().getNamedView()?.guides).toHaveLength(4);
    expect(undoSteps()).toEqual(['Objects to guides']);
  });

  it('makes a marker from the selection', () => {
    const { dt, run, undoSteps } = setup('s');
    run('app.object-to-marker');
    expect(dt.getDocument().getDefs()?.getRepr().firstChild()?.name()).toBe('svg:marker');
    expect(undoSteps()).toEqual(['Objects to marker']);
  });
});

describe('app.selection-stack-up', () => {
  it('moves up in the stack order', () => {
    const { dt, run, undoSteps } = setup('r');
    run('app.selection-stack-up');
    const ids = [...dt.getDocument().getReprRoot().children()].map((c) => c.attribute('id'));
    expect(ids.slice(-2)).toEqual(['s', 'r']);
    expect(undoSteps()).toEqual(['stack up']);
  });
});

describe('app.object-set-inverse-mask', () => {
  it('sets a mask and adds the power mask effect', () => {
    const { dt, item, run, undoSteps } = setup('r', 's');
    run('app.object-set-mask');
    const masked = dt.getSelection().singleItem();
    expect(masked?.getAttribute('mask')).toMatch(/^url\(#mask/);
    dt.getSelection().set(item(masked?.getId() ?? ''));
    run('app.object-set-inverse-mask');
    expect(undoSteps().at(-1)).toBe('Set Inverse Mask (LPE)');
    expect(masked?.getAttribute('inkscape:path-effect')).toBeTruthy();
    expect(masked?.getAttribute('mask')).toMatch(/^url\(#mask-powermask-/);
  });
});

describe('app.object-add-corners-lpe', () => {
  it('adds the Corners effect, and removes it when called again', () => {
    const { dt, item, run } = setup('r');
    run('app.object-add-corners-lpe');
    expect(dt.getSelection().singleItem()?.getAttribute('inkscape:path-effect')).toBeTruthy();
    dt.getSelection().set(item('r'));
    run('app.object-add-corners-lpe');
    expect(dt.getSelection().singleItem()?.getAttribute('inkscape:path-effect')).toBeNull();
  });
});
