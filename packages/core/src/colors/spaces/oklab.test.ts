// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/spaces-oklab-test.cpp, testfiles/src/colors/spaces-oklch-test.cpp,
// testfiles/src/colors/spaces-okhsl-test.cpp, testfiles/src/colors/spaces-okhsv-test.cpp
import { describe, expect, it } from 'vitest';
import { SpaceType as T } from './enum.ts';
import { OkLab } from './oklab.ts';
import { OkLch, render_hue_scale, render_lightness_scale, render_saturation_scale } from './oklch.ts';
import {
  badColorStringTests,
  componentIds,
  convertTests,
  fromStringTests,
  normalizeTests,
  randomPassFunc,
  randomPassthrough,
  toStringTests,
} from './testbase.ts';

describe('OkLab', () => {
  fromStringTests([
    ['oklab(50% -0.4 -0.4)', [0.5, 0.0, 0.0], 0x0045ffff],
    ['oklab(1 0.4 0.4)', [1.0, 1.0, 1.0], 0xff0000ff],
    ['oklab(0 0 0)', [0.0, 0.5, 0.5], 0x000000ff],
    ['oklab(20% 0.2 0.2 / 20%)', [0.2, 0.75, 0.75, 0.2], 0x62000033],
  ]);

  badColorStringTests(['oklab', 'oklab(', 'oklab(100']);

  toStringTests([
    [T.OKLAB, [0.0, 0.667, 0.945], 'oklab(0 0.134 0.356)'],
    [T.OKLAB, [0.3, 0.8, 0.258], 'oklab(0.3 0.24 -0.194)'],
    [T.OKLAB, [1.0, 0.5, 0.004], 'oklab(1 0 -0.397)'],
    [T.OKLAB, [0, 1, 0.2, 0.8], 'oklab(0 0.4 -0.24 / 80%)', true],
    [T.OKLAB, [0, 1, 0.2, 0.8], 'oklab(0 0.4 -0.24)', false],
  ]);

  convertTests([[T.OKLAB, [1.0, 0.4, 0.2], T.OKLAB, [1.0, 0.4, 0.2]]]);

  normalizeTests([
    [T.OKLAB, [1.2, 1.2, 1.2, 1.2], [1.0, 1.0, 1.0, 1.0]],
    [T.OKLAB, [-0.2, -0.2, -0.2, -0.2], [0.0, 0.0, 0.0, 0.0]],
  ]);

  it('converts with the functions back and forth', () =>
    randomPassFunc(OkLab.profileToSpace, OkLab.spaceToProfile, 1000));

  it('has components', () => expect(componentIds(T.OKLAB)).toEqual(['l', 'a', 'b']));
});

describe('OkLch', () => {
  convertTests([[T.OKLCH, [1.0, 0.4, 0.2], T.OKLCH, [1.0, 0.4, 0.2]]]);

  normalizeTests([
    [T.OKLCH, [1.2, 1.2, 1.2, 1.2], [1.0, 1.0, 0.2, 1.0]],
    [T.OKLCH, [-0.2, -0.2, -0.2, -0.2], [0.0, 0.0, 0.8, 0.0]],
  ]);

  it('has components', () => expect(componentIds(T.OKLCH)).toEqual(['l', 'c', 'h']));

  it('finds the maximum chroma', () => {
    expect(OkLch.max_chroma(0, 100)).toBe(0);
    expect(OkLch.max_chroma(1, 100)).toBe(0);
    // The chroma of pure red is the maximum at its hue (about 29 degrees, lightness 0.628)
    expect(OkLch.max_chroma(0.628, 29.2)).toBeCloseTo(0.2577, 3);
  });

  it('renders color scales', () => {
    const map = new Uint8ClampedArray(4 * 1024);
    render_saturation_scale(0.1, 0.0, map);
    expect([...map.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    render_hue_scale(0.5, 0.7, map);
    expect(map[3]).toBe(255);
    render_lightness_scale(0.1, 0.5, map);
    expect([...map.slice(4 * 1023, 4 * 1024)].slice(0, 3)).not.toEqual([0, 0, 0]);
  });
});

describe('OkHsl', () => {
  convertTests([
    [T.OKHSL, [1.0, 0.4, 0.2], T.OKHSL, [1.0, 0.4, 0.2]],
    // Test conversion from RGB to OkHsl when total chrominance is low.
    [T.RGB, [1.0, 1.0, 1.0], T.OKHSL, [0.0, 0.0, 1.0]],
  ]);

  normalizeTests([
    [T.OKHSL, [1.2, 1.2, 1.2, 1.2], [0.2, 1.0, 1.0, 1.0]],
    [T.OKHSL, [-0.2, -0.2, -0.2, -0.2], [0.8, 0.0, 0.0, 0.0]],
  ]);

  it('converts random colors back and forth', () => randomPassthrough(T.OKHSL, T.RGB, 1000, true));

  it('has components', () => expect(componentIds(T.OKHSL)).toEqual(['h', 's', 'l']));
});

describe('OkHsv', () => {
  convertTests([[T.OKHSV, [1.0, 0.4, 0.2], T.OKHSV, [1.0, 0.4, 0.2]]]);

  normalizeTests([
    [T.OKHSV, [1.2, 1.2, 1.2, 1.2], [0.2, 1.0, 1.0, 1.0]],
    [T.OKHSV, [-0.2, -0.2, -0.2, -0.2], [0.8, 0.0, 0.0, 0.0]],
  ]);

  it('converts random colors back and forth', () => randomPassthrough(T.OKHSV, T.RGB, 1000, true));

  it('has components', () => expect(componentIds(T.OKHSV)).toEqual(['h', 's', 'v']));
});
