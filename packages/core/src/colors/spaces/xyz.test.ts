// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/spaces-xyz-test.cpp
import { describe, expect, it } from 'vitest';
import { SpaceType as T } from './enum.ts';
import {
  badColorStringTests,
  componentIds,
  convertTests,
  fromStringTests,
  normalizeTests,
  toStringTests,
} from './testbase.ts';

describe('XYZ', () => {
  fromStringTests([
    // NOTE: RGB clipped to 0..1. Upstream expects 0x9c for blue (lcms rounding), exact math gives 0x9b
    ['color(xyz 0.1 1 0.5)', [0.1, 1, 0.5], 0x00ff9bff],
    // CSS Color Module 4 xyz-001-005.html
    ['color(xyz 0.07719 0.15438 0.02573)', [0.07719, 0.15438, 0.02573], 0x008000ff],
    ['color(xyz 0 0 0)', [0.0, 0.0, 0.0], 0x000000ff],
    ['color(xyz 1 1 1)', [1.0, 1.0, 1.0], 0xfff9f4ff],
    ['color(xyz 0 1 0)', [0.0, 1.0, 0.0], 0x00ff00ff],
    ['color(xyz 0.26567 0.69174 0.04511)', [0.26567, 0.69174, 0.04511], 0x00ff00ff],
    // CSS Color Module 4 xyz-d50-001-005.html
    ['color(xyz-d50 0.08312 0.154746 0.020961)', [0.08312, 0.154746, 0.020961], 0x008000ff],
    ['color(xyz-d50 0 0 0)', [0.0, 0.0, 0.0], 0x000000ff],
    ['color(xyz-d50 1 1 1)', [1.0, 1.0, 1.0], 0xfffcffff],
    ['color(xyz-d50 0.29194 0.692236 0.041884)', [0.29194, 0.692236, 0.041884], 0x00ff00ff],
    // CSS Color Module 4 xyz-d65-001-005.html
    ['color(xyz-d65 0.07719 0.15438 0.02573)', [0.07719, 0.15438, 0.02573], 0x008000ff],
    ['color(xyz-d65 1 1 1)', [1.0, 1.0, 1.0], 0xfff9f4ff],
  ]);

  badColorStringTests(['color(xyz', 'color(xyz-d50', 'color(xyz-d50 4', 'color(xyz 360']);

  toStringTests([
    [T.XYZ, [0.3, 0.2, 0.8], 'color(xyz 0.3 0.2 0.8)'],
    [T.XYZ, [1.0, 0.5, 0.004], 'color(xyz 1 0.5 0.004)'],
    [T.XYZ, [0, 1, 0.2, 0.8], 'color(xyz 0 1 0.2 / 80%)', true],
    [T.XYZ, [0, 1, 0.2, 0.8], 'color(xyz 0 1 0.2)', false],
    [T.XYZ50, [0.3, 0.2, 0.8], 'color(xyz-d50 0.3 0.2 0.8)'],
    [T.XYZ50, [0, 1, 0.2, 0.8], 'color(xyz-d50 0 1 0.2 / 80%)', true],
  ]);

  convertTests([
    // Example from w3c css-color-4 documentation
    [T.XYZ, [0.217, 0.146, 0.594], T.RGB, [0.463, 0.329, 0.804]],
    // No conversion
    [T.XYZ, [1.0, 0.4, 0.2], T.XYZ, [1.0, 0.4, 0.2]],
    [T.XYZ50, [1.0, 0.4, 0.2], T.XYZ50, [1.0, 0.4, 0.2]],
    // The D65 and D50 white points
    [T.XYZ, [0.9505, 1.0, 1.089], T.XYZ50, [0.9643, 1.0, 0.8251]],
  ]);

  normalizeTests([[T.XYZ, [1.2, -0.2, 0.5, 1.2], [1.0, 0.0, 0.5, 1.0]]]);

  it('has components', () => {
    expect(componentIds(T.XYZ)).toEqual(['x', 'y', 'z']);
    expect(componentIds(T.XYZ50)).toEqual(['x', 'y', 'z']);
  });
});
