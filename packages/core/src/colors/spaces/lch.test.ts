// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/spaces-lch-test.cpp
import { describe, expect, it } from 'vitest';
import { SpaceType as T } from './enum.ts';
import { Lch } from './lch.ts';
import {
  badColorStringTests,
  componentIds,
  convertTests,
  fromStringTests,
  normalizeTests,
  randomPassFunc,
  toStringTests,
} from './testbase.ts';

describe('Lch', () => {
  fromStringTests([
    ['lch(50% 20 180)', [0.5, 0.133, 0.5], 0x4d8176ff],
    // this color is outside sRGB gamut, it will be naively clipped to fit
    ['lch(100 150 360)', [1.0, 1.0, 1.0], 0xff00ffff],
    ['lch(0 0 0)', [0.0, 0.0, 0.0], 0x000000ff],
    ['lch(20% 20 72 / 20%)', [0.2, 0.133, 0.2, 0.2], 0x3f2d1433],
  ]);

  badColorStringTests(['lch', 'lch(', 'lch(100']);

  toStringTests([
    [T.LCH, [0.0, 0.667, 0.945], 'lch(0 100.05 340.2)'],
    [T.LCH, [0.3, 0.8, 0.258], 'lch(30 120 92.88)'],
    [T.LCH, [1.0, 0.5, 0.004], 'lch(100 75 1.44)'],
    [T.LCH, [0, 1, 0.2, 0.8], 'lch(0 150 72 / 80%)', true],
    [T.LCH, [0, 1, 0.2, 0.8], 'lch(0 150 72)', false],
  ]);

  convertTests([
    [T.LCH, [0.181, 0.399, 0.81], T.RGB, [0.0, 0.14, 0.5]],
    [T.LCH, [0.907, 0.352, 0.546], T.RGB, [0.0, 1.0, 1.0]],
    [T.LCH, [0.546, 0.623, 0.0817], T.RGB, [1.0, 0.0, 0.23]],
    [T.LCH, [0.945, 0.052, 0.035], T.RGB, [1.0, 0.918, 0.926]],
    [T.LCH, [0.526, 0.5, 0.373], T.RGB, [0.0, 0.574, 0.0]],
    [T.LCH, [0.567, 0.3, 0.4617], T.RGB, [0.0, 0.609, 0.453]],
    // No conversion
    [T.LCH, [1.0, 0.4, 0.2], T.LCH, [1.0, 0.4, 0.2]],
  ]);

  normalizeTests([
    [T.LCH, [1.2, 1.2, 1.2, 1.2], [1.0, 1.0, 0.2, 1.0]],
    [T.LCH, [-0.2, -0.2, -0.2, -0.2], [0.0, 0.0, 0.8, 0.0]],
  ]);

  it('converts with the functions back and forth', () =>
    randomPassFunc(Lch.profileToSpace, Lch.spaceToProfile, 1000));

  it('has components', () => expect(componentIds(T.LCH)).toEqual(['l', 'c', 'h']));
});
