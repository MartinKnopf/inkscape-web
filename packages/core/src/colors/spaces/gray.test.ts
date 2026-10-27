// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/spaces-gray-test.cpp, testfiles/src/colors/spaces-alpha-test.cpp
import { describe, expect, it } from 'vitest';
import { Manager } from '../manager.ts';
import { SpaceType as T } from './enum.ts';
import { componentIds, convertTests, normalizeTests, randomPassthrough } from './testbase.ts';

describe('Gray', () => {
  convertTests([
    [T.Gray, [0.7], T.RGB, [0.7, 0.7, 0.7]],
    // No conversion
    [T.Gray, [0.2], T.Gray, [0.2]],
  ]);

  normalizeTests([
    [T.Gray, [1.2], [1.0]],
    [T.Gray, [-0.2], [0.0]],
  ]);

  it('converts random colors back and forth', () => randomPassthrough(T.Gray, T.RGB, 100));

  it('has components', () => expect(componentIds(T.Gray)).toEqual(['gray']));
});

describe('Alpha', () => {
  convertTests([
    // These test the icc profile but are not "sensible" results for color conversions
    [T.Alpha, [1.0], T.RGB, [1, 1, 1]],
    [T.Alpha, [0.7], T.RGB, [0.711, 0.711, 0.711]],
    [T.RGB, [0.3, 0.3, 0.3], T.Alpha, [0.3]],
    [T.Alpha, [0.2], T.Alpha, [0.2]],
  ]);

  it('has no components', () => expect(Manager.get().find(T.Alpha)!.getComponents().size).toBe(0));
});
