// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-base.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';
import { output_signal } from './actions-helper.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect id="a" x="10" y="20" width="30" height="40" style="stroke:none"/><rect id="b" x="1" y="2" width="3" height="4" style="stroke:none"/></svg>';

/** The lines that the action prints. */
function output(action: string): string[] {
  const lines: string[] = [];
  const off = output_signal.connect((line) => lines.push(line));
  expect(InkscapeApplication.instance().activate_action(action)).toBe(true);
  off();
  return lines;
}

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('query actions', () => {
  it('print x, y, width and height of the selected objects, comma separated', () => {
    const s = setupDesktop(SVG, 'Select');
    InkscapeApplication.instance().set_active_desktop(s.dt);
    s.dt.getSelection().setList([s.item('a'), s.item('b')]);
    expect(output('app.query-x')).toEqual(['10,1']);
    expect(output('app.query-height')).toEqual(['40,4']);
    expect(output('app.query-all')).toEqual(['svg1,1,2,39,58', 'a,10,20,30,40', 'b,1,2,3,4']); // the root first
    expect(output('app.query-pages')).toEqual(['0']);
  });

  it('prints the version', () => {
    expect(output('app.inkscape-version')[0]).toMatch(/^Inkscape 1\./);
  });
});
