// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseIntRange } from './parse-int-range.ts';

describe('parseIntRange', () => {
  it('reads numbers and ranges, sorted and in range', () => {
    expect(parseIntRange('3, 1-2, 9', 1, 5)).toEqual([1, 2, 3]);
    expect(parseIntRange('4-', 1, 6)).toEqual([4, 5, 6]);
    expect(parseIntRange('-2', 1, 6)).toEqual([1, 2]);
    expect(parseIntRange('all', 1, 3)).toEqual([1, 2, 3]);
  });

  it('stops at the first part that is no number', () => {
    expect(parseIntRange('2, x, 3', 1, 5)).toEqual([2]);
    expect(parseIntRange('abc', 1, 5)).toEqual([]);
  });
});
