// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/tweak-tool.cpp
// @vitest-environment happy-dom
import { Colors, Preferences, SPPath } from '@inkscape-web/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  key,
  line,
  mockHitTest,
  setupDesktop,
  stroke,
  unmockHitTest,
  useWasmBackend,
} from './tool-test-utils.ts';
import { TweakMode, tweak_color, tweak_profile } from './tweak-tool.ts';

await useWasmBackend();

// The brush radius is 500 * width = 50 px at zoom 1.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="layer1" inkscape:groupmode="layer">' +
  '<rect id="r" x="100" y="80" width="40" height="40" style="fill:#0000ff"/>' +
  '<rect id="far" x="300" y="200" width="20" height="20" style="fill:#0000ff"/>' +
  '</g></svg>';

function setup(mode: TweakMode) {
  const prefs = Preferences.get();
  prefs.setInt('/tools/tweak/mode', mode);
  prefs.setDouble('/tools/tweak/width', 0.1);
  prefs.setDouble('/tools/tweak/force', 1);
  const d = setupDesktop(SVG, 'Tweak');
  d.dt.getSelection().setList([d.item('r'), d.item('far')]);
  return d;
}

beforeEach(() => mockHitTest());
afterEach(() => {
  unmockHitTest();
  for (const p of ['mode', 'width', 'force', 'doh', 'style']) Preferences.get().remove(`/tools/tweak/${p}`);
});

describe('TweakTool', () => {
  it('move mode moves the objects under the brush along the drag', () => {
    const { svg, item, undoSteps } = setup(TweakMode.TWEAK_MODE_MOVE);
    stroke(svg, line(120, 100, 150, 100));
    const b = item('r').documentVisualBounds();
    expect(b?.left()).toBeGreaterThan(100);
    expect(b?.top()).toBeCloseTo(80, 6);
    // Out of the brush radius: not moved.
    expect(item('far').documentVisualBounds()?.left()).toBe(300);
    expect(undoSteps()).toEqual(['Move tweak']);
  });

  it('scale mode shrinks, with Shift it enlarges', () => {
    const { svg, item } = setup(TweakMode.TWEAK_MODE_SCALE);
    stroke(svg, line(120, 100, 125, 100));
    expect(item('r').documentVisualBounds()?.width()).toBeLessThan(40);
    stroke(svg, line(120, 100, 125, 100, 1), { shiftKey: true });
    stroke(svg, line(120, 100, 125, 100, 1), { shiftKey: true });
    expect(item('r').documentVisualBounds()?.width()).toBeGreaterThan(40);
  });

  it('shrink mode makes the shape a smaller path, keeping its id and place', () => {
    const { doc, svg, item, undoSteps } = setup(TweakMode.TWEAK_MODE_SHRINK_GROW);
    stroke(svg, line(110, 90, 130, 110));
    const r = item('r');
    expect(r).toBeInstanceOf(SPPath);
    expect(r.getRepr().position()).toBe(0);
    const b = r.documentGeometricBounds();
    expect(b?.width()).toBeLessThan(40);
    expect(b?.height()).toBeLessThan(40);
    expect(doc.getObjectById('far')?.getRepr().name()).toBe('svg:rect');
    expect(undoSteps()).toEqual(['Shrink/grow path tweak']);
  });

  it('color paint mode moves the fill towards the tool color', () => {
    const { svg, item } = setup(TweakMode.TWEAK_MODE_COLORPAINT);
    Preferences.get().setString('/tools/tweak/style', 'fill:#ff0000;stroke:none');
    stroke(svg, line(120, 100, 140, 100));
    const hsl = item('r').style.fill.getColor().converted(Colors.SpaceType.HSL);
    // The hue (0..1) moved from blue (2/3) towards red (0); HSL averages it linearly.
    expect(hsl?.get(0)).toBeLessThan(2 / 3 - 0.01);
    expect(item('far').style.fill.getColor().toString()).toBe('#0000ff');
  });

  it('blur mode adds a blur filter', () => {
    const { svg, item } = setup(TweakMode.TWEAK_MODE_BLUR);
    stroke(svg, line(120, 100, 140, 100));
    expect(item('r').getRepr().attribute('style')).toMatch(/filter:url\(#/);
  });

  it('Shift+letter keys switch the mode', () => {
    const { svg } = setup(TweakMode.TWEAK_MODE_MOVE);
    key(svg, 'S', { shiftKey: true });
    expect(Preferences.get().getInt('/tools/tweak/mode')).toBe(TweakMode.TWEAK_MODE_SHRINK_GROW);
  });
});

describe('tweak_profile', () => {
  it('falls off from 1 at the center to 0 at the radius', () => {
    expect(tweak_profile(0, 10)).toBe(1);
    expect(tweak_profile(5, 10)).toBeCloseTo(0.5, 12);
    expect(tweak_profile(10, 10)).toBe(0);
  });
});

describe('tweak_color', () => {
  const blue = Colors.Color.parse('#0000ff') as Colors.Color;
  const red = Colors.Color.parse('#ff0000') as Colors.Color;
  it('paints with full force to the goal; channels that are off are kept', () => {
    expect(tweak_color(TweakMode.TWEAK_MODE_COLORPAINT, blue, red, 1, true, true, true).toRGBA()).toBe(
      0xff0000ff,
    );
    // Without hue the color stays blue.
    expect(tweak_color(TweakMode.TWEAK_MODE_COLORPAINT, blue, red, 1, false, true, true).toRGBA()).toBe(
      0x0000ffff,
    );
  });
});
