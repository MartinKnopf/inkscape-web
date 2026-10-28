// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/color-notebook.cpp
import { describe, expect, it } from 'vitest';
import {
  colorFromHsva,
  colorFromRgba8,
  colorToHex,
  colorToHsva,
  colorToRgba8,
  parseHexColor,
  sliderBackground,
} from './color-notebook.ts';

describe('hex entry', () => {
  it('parses 3, 4, 6 and 8 digits, with or without #', () => {
    expect(colorToHex(parseHexColor('#f80') ?? colorFromRgba8([0, 0, 0, 0]))).toBe('ff8800ff');
    expect(colorToHex(parseHexColor('ff880080') ?? colorFromRgba8([0, 0, 0, 0]))).toBe('ff880080');
    expect(colorToHex(parseHexColor(' #F808 ') ?? colorFromRgba8([0, 0, 0, 0]))).toBe('ff880088');
    expect(colorToHex(parseHexColor('00ff00') ?? colorFromRgba8([0, 0, 0, 0]))).toBe('00ff00ff');
  });

  it('rejects other text', () => {
    for (const text of ['', 'red', '#12', '12345', 'gg0000', '#1234567']) {
      expect(parseHexColor(text)).toBeUndefined();
    }
  });
});

describe('conversions', () => {
  it('round-trips RGBA through HSVA', () => {
    const rgba: [number, number, number, number] = [200, 100, 50, 128];
    expect(colorToRgba8(colorFromHsva(colorToHsva(colorFromRgba8(rgba))))).toEqual(rgba);
  });

  it('gives value and no saturation for grays', () => {
    const hsva = colorToHsva(colorFromRgba8([128, 128, 128, 255]));
    expect(hsva.s).toBe(0);
    expect(hsva.v).toBeCloseTo(128 / 255, 3);
  });

  it('draws a slider from the color with the channel at 0 to the channel at 255', () => {
    const color = colorFromRgba8([10, 20, 30, 255]);
    expect(sliderBackground('r', color)).toBe('linear-gradient(to right, #00141e, #ff141e)');
  });
});
