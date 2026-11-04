// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-svg-processing.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<path id="p" inkscape:label="x" d="m 10,10 l 20,0 v 10 z"/><rect id="r" x="1" y="2" width="3" height="4" style="stroke:none"/></svg>';

function setup() {
  const s = setupDesktop(SVG, 'Select');
  InkscapeApplication.instance().set_active_desktop(s.dt);
  return { ...s, run: (a: string) => expect(InkscapeApplication.instance().activate_action(a)).toBe(true) };
}

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('doc processing actions', () => {
  it('sets the SVG version and prunes Inkscape data', () => {
    const { doc, item, run } = setup();
    run('doc.set-svg-version-2');
    expect(doc.getReprRoot().attribute('version')).toBe('2.0');
    run('doc.prune-inkscape-namespaces');
    expect(item('p').getRepr().attribute('inkscape:label')).toBeNull();
    expect([...doc.getReprRoot().children()].some((c) => c.name().startsWith('sodipodi:'))).toBe(false);
  });

  it('normalizes path data to absolute commands', () => {
    const { item, run } = setup();
    run('doc.normalize-all-paths');
    expect(item('p').getRepr().attribute('d')).toBe('M 10,10 L 30,10 L 30,20 Z');
  });

  it('annotates bounding boxes', () => {
    const { item, run } = setup();
    run('doc.insert-bounding-boxes');
    expect(item('r').getRepr().attribute('inkscape:visualbox')).toBe('2 4 6 1'); // top right bottom left, like a CSS box
  });
});
