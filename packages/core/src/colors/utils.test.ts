// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/utils-test.cpp
import { describe, expect, it } from 'vitest';
import { Color } from './color.ts';
import { SpaceType as T } from './spaces/enum.ts';
import { expectClose } from './spaces/testbase.ts';
import {
  color_to_id,
  desc_to_id,
  get_contrasting_color,
  get_perceptual_lightness,
  hex_to_rgba,
  make_contrasted_color,
  make_disabled_color,
  make_theme_color,
  premultiplied,
  rgba_to_hex,
  unpremultiplied,
} from './utils.ts';

const parse = (s: string): Color => Color.parse(s)!;

describe('color utils', () => {
  it('hex_to_rgba', () => {
    expect(hex_to_rgba('#ff00ffff')).toBe(0xff00ffff);
    expect(hex_to_rgba('')).toBe(0);
    expect(() => hex_to_rgba('#ff00ff')).toThrow();
  });

  it('rgba_to_hex', () => {
    expect(rgba_to_hex(0xff00ff00, false)).toBe('#ff00ff');
    expect(rgba_to_hex(0xff00ffff, true)).toBe('#ff00ffff');
    expect(rgba_to_hex(0x0000ffff, false, true)).toBe('#0000FF');
  });

  it('color_to_id', () => {
    expect(color_to_id(undefined)).toBe('none');
    expect(color_to_id(Color.parse('not-a-color'))).toBe('none');
    expect(color_to_id(parse('red'))).toBe('css-red');
    expect(color_to_id(parse('#0000ff'))).toBe('rgb-0000ff');
    const color = parse('hsl(0.5, 50, 100)');
    expect(color_to_id(color)).toBe('hsl-007fff');
    color.setName('Huey // Dewy_! Lewy');
    expect(color_to_id(color)).toBe('huey-dewy-lewy');
    color.convert(T.RGB);
    expect(color_to_id(color)).toBe('rgb-ffffff');
  });

  it('desc_to_id', () => {
    expect(desc_to_id('thing')).toBe('thing');
    expect(desc_to_id('Thing Two')).toBe('thing-two');
    expect(desc_to_id('  Thing   Three  ')).toBe('thing-three');
    expect(desc_to_id('   Wobble blink CAPLINK!')).toBe('wobble-blink-caplink');
    expect(desc_to_id('3 Blind mice')).toBe('blind-mice-3');
  });

  it('make_contrasted_color', () => {
    const rgba = (c: number, amount: number) => make_contrasted_color(new Color(c), amount).toRGBA();
    expect(rgba(0x000000ff, 0.2)).toBe(0x040404ff);
    expect(rgba(0x000000ff, 0.4)).toBe(0x080808ff);
    expect(rgba(0x000000ff, 0.6)).toBe(0x0c0c0cff);
    expect(rgba(0xffffffff, 0.2)).toBe(0xfbfbfbff);
    expect(rgba(0xffffffff, 0.4)).toBe(0xf7f7f7ff);
    expect(rgba(0xffffffff, 0.6)).toBe(0xf3f3f3ff);
    expect(rgba(0xa1a1a1ff, 0.2)).toBe(0x9d9d9dff);
    expect(rgba(0x1a1a1aff, 0.4)).toBe(0x121212ff);
    expect(rgba(0x808080ff, 0.6)).toBe(0x747474ff);
  });

  it('get_perceptual_lightness', () => {
    expectClose(get_perceptual_lightness(parse('red')), 0.78, 0.001);
    expectClose(get_perceptual_lightness(parse('black')), 0.0, 0.001);
    expectClose(get_perceptual_lightness(parse('white')), 1.0, 0.001);
    expectClose(get_perceptual_lightness(parse('device-cmyk(0.2 0.1 1.0 0.0)')), 0.945, 0.001);
  });

  it('get_contrasting_color', () => {
    const a = get_contrasting_color(0.1);
    expect(a[0]).toBe(1.0);
    expectClose(a[1], 0.688, 0.001);
    const b = get_contrasting_color(0.9);
    expect(b[0]).toBe(0.0);
    expectClose(b[1], 0.366, 0.001);
  });

  it('make_theme_color', () => {
    expect(make_theme_color(parse('red'), false).toRGBA()).toBe(0xffb3b3ff);
    expect(make_theme_color(parse('red'), true).toRGBA()).toBe(0x891c1cff);
    expect(make_theme_color(parse('white'), false).toRGBA()).toBe(0xffffffff);
    expect(make_theme_color(parse('black'), false).toRGBA()).toBe(0xc6c6c6ff);
    expect(make_theme_color(parse('black'), true).toRGBA()).toBe(0x000000ff);
  });

  it('make_disabled_color', () => {
    expect(make_disabled_color(parse('red'), false).toRGBA()).toBe(0xe9dcdcff);
    expect(make_disabled_color(parse('red'), true).toRGBA()).toBe(0x844b4bff);
    expect(make_disabled_color(parse('white'), false).toRGBA()).toBe(0xffffffff);
    expect(make_disabled_color(parse('black'), false).toRGBA()).toBe(0xabababff);
    expect(make_disabled_color(parse('black'), true).toRGBA()).toBe(0x303030ff);
  });

  it('premultiplies', () => {
    expect(premultiplied([1, 0.5, 0.5])).toEqual([0.5, 0.25, 0.5]);
    expect(unpremultiplied([0.5, 0.25, 0.5])).toEqual([1, 0.5, 0.5]);
    expect(unpremultiplied([0.5, 0.25, 0])).toEqual([0.5, 0.25, 0]);
  });
});
