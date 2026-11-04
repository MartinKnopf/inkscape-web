// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-object.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';
import { output_signal } from './actions-helper.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect id="r" width="10" height="10" style="fill:#f00;stroke:#000" data-x="1"/></svg>';

function setup() {
  const s = setupDesktop(SVG, 'Select');
  const app = InkscapeApplication.instance();
  app.set_active_desktop(s.dt);
  s.dt.getSelection().set(s.item('r'));
  const run = (a: string) => {
    const lines: string[] = [];
    const off = output_signal.connect((l) => lines.push(l));
    expect(app.activate_action(a)).toBe(true);
    off();
    return lines;
  };
  return { ...s, run };
}

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('object attribute and property actions', () => {
  it('set and get attributes, with the value after the first comma', () => {
    const { item, run, undoSteps } = setup();
    run('app.object-set-attribute("title, a,b")');
    expect(item('r').getAttribute('title')).toBe(' a,b');
    run('app.object-set-attribute("fill-rule,evenodd")');
    expect(run('app.object-get-attribute("fill-rule")')).toEqual(['evenodd']);
    expect(undoSteps()).toEqual(['ActionObjectSetAttribute', 'ActionObjectSetAttribute']);
    run('app.object-remove-attribute("data-x")');
    expect(item('r').getAttribute('data-x')).toBeNull();
  });

  it('set, get and remove style properties', () => {
    const { item, run } = setup();
    run('app.object-set-property("stroke-width,3")');
    expect(run('app.object-get-property("stroke-width")')).toEqual(['3']);
    run('app.object-remove-property("fill")');
    expect(item('r').getAttribute('style')).not.toContain('fill:');
    expect(item('r').getAttribute('style')).toContain('stroke-width:3');
  });

  it('warns about wrong arguments and an empty selection', () => {
    const { dt, run } = setup();
    expect(run('app.object-set-attribute("nocomma")')[0]).toContain('requires');
    dt.getSelection().clear();
    expect(run('app.object-get-attribute("id")')[0]).toContain('selection empty');
  });
});
