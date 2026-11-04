// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-selection-window.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect id="r1" width="10" height="10" style="fill:#ff0000;stroke:#000000;stroke-width:2"/>' +
  '<rect id="r2" x="20" width="10" height="10" style="fill:#ff0000;stroke:#0000ff;stroke-width:2"/>' +
  '<rect id="r3" x="40" width="10" height="10" style="fill:#00ff00;stroke:#000000;stroke-width:4"/>' +
  '<circle id="c1" cx="70" cy="5" r="5" style="fill:#ff0000;stroke:#000000;stroke-width:2"/></svg>';

function setup(id: string) {
  const s = setupDesktop(SVG, 'Select');
  const app = InkscapeApplication.instance();
  app.set_active_desktop(s.dt);
  s.dt.getSelection().set(s.item(id));
  const ids = () =>
    s.dt
      .getSelection()
      .items()
      .map((i) => i.getId())
      .sort();
  return { ids, run: (a: string) => expect(app.activate_action(a)).toBe(true) };
}

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('select same', () => {
  it('fill color', () => {
    const { ids, run } = setup('r1');
    run('win.select-same-fill');
    expect(ids()).toEqual(['c1', 'r1', 'r2']);
  });

  it('stroke color, and fill and stroke', () => {
    const { ids, run } = setup('r1');
    run('win.select-same-stroke-color');
    expect(ids()).toEqual(['c1', 'r1', 'r3']);
    const both = setup('r1');
    both.run('win.select-same-fill-and-stroke');
    expect(both.ids()).toEqual(['c1', 'r1']);
  });

  it('stroke style (the width)', () => {
    const { ids, run } = setup('r3');
    run('win.select-same-stroke-style');
    expect(ids()).toEqual(['r3']);
    const other = setup('r2');
    other.run('win.select-same-stroke-style');
    expect(other.ids()).toEqual(['c1', 'r1', 'r2']);
  });

  it('object type', () => {
    const { ids, run } = setup('r1');
    run('win.select-same-object-type');
    expect(ids()).toEqual(['r1', 'r2', 'r3']);
  });
});
