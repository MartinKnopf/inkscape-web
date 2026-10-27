// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/spaces-linear-rgb-test.cpp
import { describe, expect, it } from 'vitest';
import { SpaceType as T } from './enum.ts';
import { LinearRGB } from './linear-rgb.ts';
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

describe('LinearRGB', () => {
  fromStringTests([
    ['color(srgb-linear 0.1 1 0.5)', [0.1, 1.0, 0.5], 0x59ffbcff],
    ['color(srgb-linear 0.03 0 0.12)', [0.03, 0.0, 0.12], 0x300061ff],
    // upstream expects 0x01 for the red channel (lcms rounding), exact math gives 0
    ['color(srgb-linear 0 1 0.5 / 0.8)', [0.0, 1.0, 0.5, 0.8], 0x00ffbccc],
  ]);

  badColorStringTests(['color(srgb-linear', 'color(srgb-linear 360']);

  toStringTests([
    [T.linearRGB, [0.3, 0.2, 0.8], 'color(srgb-linear 0.3 0.2 0.8)'],
    [T.linearRGB, [0.3, 0.8, 0.258], 'color(srgb-linear 0.3 0.8 0.258)'],
    [T.linearRGB, [1.0, 0.5, 0.004], 'color(srgb-linear 1 0.5 0.004)'],
    [T.linearRGB, [0, 1, 0.2, 0.8], 'color(srgb-linear 0 1 0.2 / 80%)', true],
    [T.linearRGB, [0, 1, 0.2, 0.8], 'color(srgb-linear 0 1 0.2)', false],
  ]);

  convertTests([
    // Example from w3c css-color-4 documentation
    [T.linearRGB, [0.435, 0.017, 0.055], T.RGB, [0.691, 0.139, 0.259]],
    // No conversion
    [T.linearRGB, [1.0, 0.4, 0.2], T.linearRGB, [1.0, 0.4, 0.2]],
  ]);

  normalizeTests([[T.linearRGB, [1.2, -0.2, 0.5, 1.2], [1.0, 0.0, 0.5, 1.0]]]);

  it('converts random colors back and forth', () => {
    // Using the functions directly
    randomPassFunc(LinearRGB.fromRGB, LinearRGB.toRGB, 1000);
    // Using the color conversion stack
    randomPassthrough(T.linearRGB, T.RGB, 1000);
  });

  it('has components', () => expect(componentIds(T.linearRGB)).toEqual(['r', 'g', 'b']));
});
