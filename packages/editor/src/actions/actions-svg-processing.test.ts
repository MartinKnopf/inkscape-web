// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-svg-processing.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop, useWasmBackend } from '../ui/tools/tool-test-utils.ts';

await useWasmBackend();

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

describe('doc processing actions for strokes, transforms, markers and polyfills', () => {
  const SVG2 =
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
    '<defs>' +
    '<marker id="m" orient="auto-start-reverse" refX="2" refY="3"><path d="M 0 0 L 4 3 L 0 6 z"/></marker>' +
    '<marker id="c"><path d="M 0 0 L 4 3 L 0 6 z" style="fill:context-stroke"/></marker>' +
    '<hatch id="h"/>' +
    '</defs>' +
    '<g id="g" transform="translate(10,20)">' +
    '<path id="p" d="M 0 0 L 10 0" transform="scale(2)" style="stroke:#000000;stroke-width:1;marker-start:url(#m);marker-end:url(#c)"/>' +
    '</g></svg>';
  function setup2() {
    const s = setupDesktop(SVG2, 'Select');
    InkscapeApplication.instance().set_active_desktop(s.dt);
    return { ...s, run: (a: string) => expect(InkscapeApplication.instance().activate_action(a)).toBe(true) };
  }

  it('doc.add-strokes-to-paths replaces a path with fill and stroke by a group of two filled paths', () => {
    const { item, run } = setup2();
    run('doc.add-strokes-to-paths');
    const group = item('p');
    expect(group.getRepr().name()).toBe('svg:g');
    const [fill, stroke] = group.childList();
    // Neither has a stroke any more (none is the default, so it is not written).
    expect(fill?.getAttribute('style')).not.toContain('stroke:#');
    expect(stroke?.getAttribute('style')).toContain('fill:#000000');
    expect(stroke?.getAttribute('style')).not.toContain('stroke:#');
  });

  it('doc.remove-all-transforms applies the transforms to the path', () => {
    const { item, run } = setup2();
    run('doc.remove-all-transforms');
    expect(item('g').getAttribute('transform')).toBeNull();
    expect(item('p').getAttribute('transform')).toBeNull();
    // scale(2) then translate(10,20): the line from (10,20) to (30,20).
    expect(item('p').getAttribute('d')).toBe('M 10,20 H 30');
  });

  it('doc.reverse-auto-start-markers adds a reversed marker for marker-start', () => {
    const { doc, item, run } = setup2();
    run('doc.reverse-auto-start-markers');
    expect(item('p').getAttribute('style')).toContain('marker-start:url(#m_reversed)');
    const reversed = doc.getObjectById('m_reversed')?.getRepr();
    expect(reversed?.attribute('orient')).toBe('auto');
    expect(reversed?.firstChild()?.attribute('transform')).toBe('rotate(180,2,3)');
  });

  it('doc.remove-marker-context-paint copies the marker with the stroke of the path', () => {
    const { doc, item, run } = setup2();
    run('doc.remove-marker-context-paint');
    const style = item('p').getAttribute('style') ?? '';
    expect(style).toContain('marker-end:url(#c_');
    const id = /marker-end:url\(#([^)]+)\)/.exec(style)?.[1] ?? '';
    expect(doc.getObjectById(id)?.getRepr().firstChild()?.attribute('style')).toContain('fill:#000000');
  });

  it('doc.insert-hatch-polyfill adds the script once, doc.insert-mesh-polyfill nothing without a mesh', () => {
    const { doc, run } = setup2();
    run('doc.insert-hatch-polyfill');
    run('doc.insert-hatch-polyfill');
    run('doc.insert-mesh-polyfill');
    const scripts = [...doc.getReprRoot().children()].filter((c) => c.name() === 'svg:script');
    expect(scripts.map((c) => c.attribute('id'))).toEqual(['hatch_polyfill']);
  });

  it('doc.insert-path-data adds the path of a rectangle', () => {
    const { item, run } = setup();
    run('doc.insert-path-data');
    expect(item('r').getAttribute('inkscape:d')).toBe('M 1,2 H 4 V 6 H 1 Z');
  });
});
