// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-hide-lock.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<g id="g"><rect id="a" width="10" height="10"/><rect id="b" x="20" width="10" height="10"/></g></svg>';

function setup() {
  const s = setupDesktop(SVG, 'Select');
  const app = InkscapeApplication.instance();
  app.set_active_desktop(s.dt);
  return { ...s, run: (a: string) => expect(app.activate_action(a)).toBe(true) };
}

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('hide and lock actions', () => {
  it('hides the selection, clears it, and unhides everything', () => {
    const { dt, item, run, undoSteps } = setup();
    dt.getSelection().set(item('a'));
    run('app.selection-hide');
    expect(item('a').isHidden()).toBe(true);
    expect(dt.getSelection().isEmpty()).toBe(true);
    expect(undoSteps()).toEqual(['Hid selected items.']);
    run('app.unhide-all');
    expect(item('a').isHidden()).toBe(false);
    expect(undoSteps().at(-1)).toBe('Unhid all objects in the current layer');
  });

  it('unlocks the descendents of a locked group, and does nothing without changes', () => {
    const { dt, item, run, undoSteps } = setup();
    item('a').setLocked(true);
    item('b').setLocked(true);
    dt.getSelection().set(item('g'));
    run('app.selection-unlock-below');
    expect([item('a').isLocked(), item('b').isLocked()]).toEqual([false, false]);
    const n = undoSteps().length;
    run('app.selection-unlock-below');
    expect(undoSteps()).toHaveLength(n);
  });
});
