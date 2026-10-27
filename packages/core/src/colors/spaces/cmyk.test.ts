// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/spaces-cmyk-test.cpp
import { describe, expect, it } from 'vitest';
import { Color } from '../color.ts';
import { SpaceType as T } from './enum.ts';
import {
  badColorStringTests,
  componentIds,
  convertTests,
  fromStringTests,
  normalizeTests,
  toStringTests,
} from './testbase.ts';

describe('DeviceCMYK', () => {
  fromStringTests([
    // Taken from the w3c device-cmyk example chart
    ['device-cmyk(0 0.2 0.2 0.2)', [0, 0.2, 0.2, 0.2], 0xcca3a3ff],
    ['device-cmyk(30% 0.2 0.2 0.0)', [0.3, 0.2, 0.2, 0], 0xb3ccccff],
    ['device-cmyk(0 0.6 60% 0.5)', [0, 0.6, 0.6, 0.5], 0x803333ff],
    ['   device-cmyk(90% 0.6 0.6 0)   ', [0.9, 0.6, 0.6, 0], 0x196666ff],
    ['device-cmyk(0 1.0 1.0 0.1 / 0.5)', [0.0, 1.0, 1.0, 0.1, 0.5], 0xe6000080],
  ]);

  badColorStringTests(['device-cmyk', 'device-cmyk(', 'device-cmyk(10%,', 'device-cmyk(1.0, 1.0, 1.0)']);

  toStringTests([
    [T.CMYK, [0.1, 0.2, 0.8, 0.1], 'device-cmyk(0.1 0.2 0.8 0.1)'],
    [T.CMYK, [0.3, 0.3, 0.0, 0.5], 'device-cmyk(0.3 0.3 0 0.5)'],
    [T.CMYK, [0.9, 0.0, 0.2, 0.6, 0.8], 'device-cmyk(0.9 0 0.2 0.6 / 80%)'],
    [T.CMYK, [0.9, 0.0, 0.2, 0.6, 0.8], 'device-cmyk(0.9 0 0.2 0.6)', false],
  ]);

  convertTests([
    [T.CMYK, [1, 0, 0, 0], T.RGB, [0, 1, 1]],
    [T.CMYK, [0, 1, 0, 0], T.RGB, [1, 0, 1]],
    [T.CMYK, [0, 0, 0, 1], T.RGB, [0, 0, 0]],
    [T.CMYK, [0, 1, 1, 0], T.RGB, [1, 0, 0]],
    // No conversion
    [T.CMYK, [1.0, 0.4, 0.2, 0.3], T.CMYK, [1.0, 0.4, 0.2, 0.3], false],
  ]);

  normalizeTests([
    [T.CMYK, [1.2, 1.2, 1.2, 1.2, 1.2], [1.0, 1.0, 1.0, 1.0, 1.0]],
    [T.CMYK, [-0.2, -0.2, -0.2, -0.2, -0.2], [0.0, 0.0, 0.0, 0.0, 0.0]],
  ]);

  it('has components', () => expect(componentIds(T.CMYK)).toEqual(['c', 'm', 'y', 'k']));

  it('knows over-inked colors', () => {
    expect(new Color(T.CMYK, [1, 1, 1, 0.3]).isOverInked()).toBe(true);
    expect(new Color(T.CMYK, [1, 1, 0.1, 0.3]).isOverInked()).toBe(false);
  });
});
