// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { are_near, format_coord_nice, format_coord_shortest, hypot, parse_coord } from './coord.ts';
import { Point } from './point.ts';

describe('format_coord_shortest', () => {
  it.each([
    [0, '0'],
    [-0, '0'],
    [1, '1'],
    [-1.5, '-1.5'],
    [0.1 + 0.2, '0.30000000000000004'],
    [0.001, '0.001'],
    [0.0001, '1e-4'],
    [-0.00012345, '-1.2345e-4'],
    [123456, '123456'],
    [1000000, '1e6'],
    [1234567, '1.234567e6'],
    [1e21, '1e21'],
    [Number.POSITIVE_INFINITY, 'inf'],
    [Number.NEGATIVE_INFINITY, '-inf'],
    [Number.NaN, 'NaN'],
  ])('%s -> %s', (x, s) => {
    expect(format_coord_shortest(x)).toBe(s);
  });

  it('reads back to the same number', () => {
    for (const x of [Math.PI, 1 / 3, 5e-324, 1.7976931348623157e308, 123456.789, 1e-7 + 1e-23]) {
      expect(Number(format_coord_shortest(x))).toBe(x);
    }
  });
});

describe('format_coord_nice', () => {
  it.each([
    [0.000001, '0.000001'],
    [0.0000001, '1e-7'],
    [1e20, '100000000000000000000'],
    [1e21, '1e21'],
    [1234567, '1234567'],
  ])('%s -> %s', (x, s) => {
    expect(format_coord_nice(x)).toBe(s);
  });
});

describe('parse_coord', () => {
  it.each([
    [' 12.5 ', 12.5],
    ['- 3', -3],
    ['1e3', 1000],
    ['', 0],
    ['inf', Number.POSITIVE_INFINITY],
  ])('%j -> %s', (s, x) => {
    expect(parse_coord(s)).toBe(x);
  });

  it('gives NaN for junk', () => {
    expect(parse_coord('1x')).toBeNaN();
    expect(parse_coord('0x10')).toBeNaN();
  });
});

describe('are_near', () => {
  it('compares numbers and points', () => {
    expect(are_near(1, 1 + 1e-7)).toBe(true);
    expect(are_near(1, 1.1)).toBe(false);
    expect(are_near(new Point(0, 0), new Point(3e-7, 4e-7))).toBe(true);
    expect(are_near(new Point(0, 0), new Point(1, 1), 1.5)).toBe(true);
  });
});

describe('hypot', () => {
  it('handles special values and extreme exponents', () => {
    expect(hypot(3, 4)).toBe(5);
    expect(hypot(-3, 0)).toBe(3);
    expect(hypot(Number.POSITIVE_INFINITY, Number.NaN)).toBe(Number.POSITIVE_INFINITY);
    expect(hypot(Number.NaN, 1)).toBeNaN();
    expect(hypot(3e200, 4e200) / 1e200).toBeCloseTo(5, 12);
    expect(hypot(3e-200, 4e-200) / 1e-200).toBeCloseTo(5, 12);
    expect(hypot(1, 1e-30)).toBe(1);
  });
});
