// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/spray-tool.cpp
// @vitest-environment happy-dom
import { Preferences, SPPath } from '@inkscape-web/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { random_position, SprayMode } from './spray-tool.ts';
import {
  key,
  line,
  mockHitTest,
  pointer,
  setupDesktop,
  stroke,
  unmockHitTest,
  useWasmBackend,
} from './tool-test-utils.ts';

await useWasmBackend();

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="layer1" inkscape:groupmode="layer"><rect id="r" x="10" y="10" width="10" height="10"/></g></svg>';

function setup(mode: SprayMode) {
  const prefs = Preferences.get();
  prefs.setInt('/tools/spray/mode', mode);
  prefs.setDouble('/tools/spray/population', 100);
  const d = setupDesktop(SVG, 'Select');
  // The tool sprays the objects selected when it is activated.
  d.dt.getSelection().set(d.item('r'));
  d.dt.setTool('/tools/spray');
  const layer = () => [...(d.doc.getObjectById('layer1')?.getRepr().children() ?? [])];
  return { ...d, layer };
}

beforeEach(() => mockHitTest());
afterEach(() => {
  unmockHitTest();
  for (const p of ['mode', 'population']) Preferences.get().remove(`/tools/spray/${p}`);
});

describe('SprayTool', () => {
  it('copy mode: a drag sprays copies around the pointer, marked with their origin', () => {
    const { svg, layer, undoSteps } = setup(SprayMode.SPRAY_MODE_COPY);
    stroke(svg, line(200, 150, 260, 150));
    const copies = layer().slice(1);
    expect(copies.length).toBeGreaterThan(3);
    for (const c of copies) {
      expect(c.name()).toBe('svg:rect');
      expect(c.attribute('inkscape:spray-origin')).toBe('#r');
    }
    expect(undoSteps()).toEqual(['Spray with copies']);
  });

  it('clone mode sprays clones of the original', () => {
    const { svg, layer, undoSteps } = setup(SprayMode.SPRAY_MODE_CLONE);
    stroke(svg, line(200, 150, 260, 150));
    expect(layer().length).toBeGreaterThan(3);
    expect(layer()[1]?.name()).toBe('svg:use');
    expect(layer()[1]?.attribute('xlink:href')).toBe('#r');
    expect(undoSteps()).toEqual(['Spray with clones']);
  });

  it('a click sprays one copy centered at the pointer', () => {
    const { doc, svg, layer } = setup(SprayMode.SPRAY_MODE_COPY);
    pointer(svg, 'pointermove', 100, 120, 0);
    pointer(svg, 'pointerdown', 100, 120, 1);
    pointer(svg, 'pointerup', 100, 120, 0);
    expect(layer()).toHaveLength(2);
    const copy = doc.getObjectByRepr(layer()[1] ?? null);
    const b = copy && 'documentVisualBounds' in copy ? (copy as SPPath).documentVisualBounds() : null;
    expect(b?.midpoint().x).toBeCloseTo(100, 6);
    expect(b?.midpoint().y).toBeCloseTo(120, 6);
  });

  it('single path mode unions the sprayed copies into one path', () => {
    const { doc, svg, layer, undoSteps } = setup(SprayMode.SPRAY_MODE_SINGLE_PATH);
    stroke(svg, line(200, 150, 260, 150));
    expect(layer()).toHaveLength(2);
    expect(doc.getObjectByRepr(layer()[1] ?? null)).toBeInstanceOf(SPPath);
    expect(layer()[1]?.attribute('inkscape:spray-origin')).toBe('#r');
    expect(undoSteps()).toEqual(['Spray in single path']);
  });

  it('eraser mode deletes sprayed copies under the brush, not the original', () => {
    const { svg, layer } = setup(SprayMode.SPRAY_MODE_COPY);
    stroke(svg, line(200, 150, 260, 150));
    key(svg, 'L', { shiftKey: true }); // single path
    expect(Preferences.get().getInt('/tools/spray/mode')).toBe(SprayMode.SPRAY_MODE_SINGLE_PATH);
    Preferences.get().setInt('/tools/spray/mode', SprayMode.SPRAY_MODE_ERASER);
    for (let i = 0; i < 5; i++) stroke(svg, line(180, 150, 280, 150));
    expect(layer().map((n) => n.attribute('id'))).toEqual(['r']);
  });
});

describe('random_position', () => {
  it('gives a radius in [0, 1] around the mean', () => {
    for (let i = 0; i < 100; i++) {
      const { radius, angle } = random_position(0.5, 0.2);
      expect(radius).toBeGreaterThanOrEqual(0);
      expect(radius).toBeLessThanOrEqual(1);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(2 * Math.PI);
    }
  });
});
