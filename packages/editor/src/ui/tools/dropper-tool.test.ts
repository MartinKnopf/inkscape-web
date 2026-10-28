// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/dropper-tool.cpp
import { Colors, Preferences } from '@inkscape-web/core';
import { afterEach, describe, expect, it } from 'vitest';
import { average_color, DropperTool } from './dropper-tool.ts';

/** RGBA bytes of pixels given as [r, g, b, a]. */
const pixels = (...p: [number, number, number, number][]) => Uint8ClampedArray.from(p.flat());

describe('average_color', () => {
  it('weights the channels by alpha and averages the alpha', () => {
    // An opaque red pixel and a transparent green one: the green does not change the color.
    const avg = average_color(pixels([255, 0, 0, 255], [0, 255, 0, 0]), 2, 1);
    expect(avg).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
    // Two opaque pixels: the plain mean.
    const mean = average_color(pixels([255, 0, 0, 255], [0, 0, 255, 255]), 2, 1);
    expect(mean?.r).toBeCloseTo(0.5, 12);
    expect(mean?.b).toBeCloseTo(0.5, 12);
    expect(mean?.a).toBe(1);
  });

  it('uses only the pixels inside the mask, and is null without pixels', () => {
    const data = pixels([255, 0, 0, 255], [0, 0, 255, 255]);
    expect(average_color(data, 2, 1, (x) => x === 1)).toEqual({ r: 0, g: 0, b: 1, a: 1 });
    expect(average_color(data, 2, 1, () => false)).toBeNull();
    expect(average_color(pixels([9, 9, 9, 0]), 1, 1)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});

describe('DropperTool.finish_color', () => {
  afterEach(() => {
    Preferences.get().remove('/tools/dropper/pick');
    Preferences.get().remove('/tools/dropper/setalpha');
  });
  const color = () => new Colors.Color(0xff8000_80);

  it('keeps the opacity when picking and assigning alpha, else drops it', () => {
    expect(DropperTool.finish_color(color(), false).getOpacity()).toBeCloseTo(0x80 / 255, 6);
    Preferences.get().setBool('/tools/dropper/setalpha', false);
    expect(DropperTool.finish_color(color(), false).getOpacity()).toBe(1);
    Preferences.get().setBool('/tools/dropper/setalpha', true);
    Preferences.get().setInt('/tools/dropper/pick', 0);
    expect(DropperTool.finish_color(color(), false).getOpacity()).toBe(1);
  });

  it('inverts the color channels but not the opacity (Alt)', () => {
    const inverted = DropperTool.finish_color(new Colors.Color(0xff8000_80), true);
    expect(inverted.toRGBA(0) >>> 8).toBe(0x007fff);
    expect(inverted.getOpacity()).toBeCloseTo(0x80 / 255, 6);
  });
});
