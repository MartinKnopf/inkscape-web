// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-selection.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<g id="g"><rect id="a" class="k" width="10" height="10"/><circle id="b" r="5"/></g>' +
  '<rect id="c" class="k" width="5" height="5"/></svg>';

function setup() {
  const s = setupDesktop(SVG, 'Select');
  const app = InkscapeApplication.instance();
  app.set_active_desktop(s.dt);
  const ids = () =>
    s.dt
      .getSelection()
      .items()
      .map((i) => i.getId());
  return { ...s, ids, run: (a: string) => expect(app.activate_action(a)).toBe(true) };
}

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('selection actions', () => {
  it('selects and deselects by id, class, element and selector', () => {
    const { ids, run } = setup();
    run('app.select-by-id("a, c")');
    expect(ids()).toEqual(['a', 'c']);
    run('app.unselect-by-id("a")');
    expect(ids()).toEqual(['c']);
    run('app.select-clear');
    run('app.select-by-class("k")');
    expect(ids().sort()).toEqual(['a', 'c']);
    run('app.select-clear');
    run('app.select-by-element("circle")');
    expect(ids()).toEqual(['b']);
    run('app.select-by-selector("g > rect")');
    expect(ids().sort()).toEqual(['a', 'b']);
  });

  it('selects all by condition and inverts', () => {
    const { ids, run } = setup();
    run('app.select-all("no-groups")');
    expect(ids().sort()).toEqual(['a', 'b', 'c']);
    run('app.select-all("groups")');
    expect(ids()).toEqual(['g']);
    // The children of a selected group are not selected too.
    run('app.select-all("all")');
    expect(ids().sort()).toEqual(['c', 'g']);
    run('app.select-all("bogus")'); // invalid: unchanged
    expect(ids().sort()).toEqual(['c', 'g']);
    run('app.select-all("no-layers")');
    expect(ids().sort()).toEqual(['c', 'g']);
    run('app.select-invert("no-layers")');
    expect(ids()).toEqual([]);
  });
});
