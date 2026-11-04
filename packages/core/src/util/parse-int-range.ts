// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/util/parse-int-range.cpp, src/util/parse-int-range.h
/*
 * Parse a string containing number ranges.
 *
 *  Authors:
 *    Martin Owens
 *    PBS <pbs3141@gmail.com>
 *
 * Copyright (C) 2024 Authors
 */

/**
 * The numbers of a list of numbers and ranges ("1, 3-5, 8-"), sorted and unique. Numbers below
 * start or above end (0: no end) are left out; open ranges go to start or end. "all" is every
 * number from start to end. Parsing stops at the first part that is no number or range.
 */
export function parseIntRange(input: string, start = 1, end = 0): number[] {
  // Special word based translations go here:
  if (input === 'all') return parseIntRange('-', start, end);

  const valid = (val: number) => start <= val && (!end || val <= end);
  const clamp_to_valid = (val: number) => {
    val = Math.max(val, start);
    if (end) val = Math.min(val, end);
    return val;
  };

  const out = new Set<number>();
  const regex = /^\s*(((\d*)\s*-\s*(\d*))|(\d+))\s*,?/;
  let rest = input;
  for (let m = regex.exec(rest); m; m = regex.exec(rest)) {
    const single = m[5];
    if (single) {
      const val = Number.parseInt(single, 10);
      if (valid(val)) out.add(val);
    } else {
      const first = m[3];
      const last = m[4];
      const first_num = first ? Number.parseInt(first, 10) : start;
      const last_num = last ? Number.parseInt(last, 10) : end ? end : first_num;
      const min = clamp_to_valid(Math.min(first_num, last_num));
      const max = clamp_to_valid(Math.max(first_num, last_num));
      for (let i = min; i <= max; i++) out.add(i);
    }
    rest = rest.slice(m[0].length);
    if (!m[0].length) break;
  }
  return [...out].sort((a, b) => a - b);
}
