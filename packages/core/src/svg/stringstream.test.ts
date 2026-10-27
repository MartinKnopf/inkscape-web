// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/svg-stringstream-test.cpp
import { describe, expect, it } from 'vitest';
import { cssNumber } from './css-ostringstream.ts';
import { svgNumber, svgPoint } from './stringstream.ts';
import { stripTrailingZeros } from './strip-trailing-zeros.ts';

describe('stripTrailingZeros', () => {
  it.each([
    ['1.500', '1.5'],
    ['1.000', '1'],
    ['100', '100'],
    ['100.0', '100'],
    ['0.000', '0'],
    ['1.500e+09', '1.5e+09'],
    ['3.000e+09', '3e+09'],
    ['-0.00000000', '-0'],
  ])('%s -> %s', (input, expected) => {
    expect(stripTrailingZeros(input)).toBe(expected);
  });
});

describe('svgNumber (SVGOStringStream), precision 8', () => {
  it.each([
    [0, '0'],
    [4.5, '4.5'],
    [-4, '-4'],
    [0.001, '0.001'],
    [1.23456789, '1.2345679'],
    [-1.23456789, '-1.2345679'],
    [12345678.9, '12345679'],
    [-12345678.9, '-12345679'],
    [1.234e-12, '1.234e-12'],
    [3e9, '3e+09'],
    [-3.5e9, '-3.5e+09'],
  ])('%s -> %s', (value, expected) => {
    expect(svgNumber(value, 8)).toBe(expected);
  });

  it('uses e notation below 1e-4 and from 10^precision', () => {
    expect(svgNumber(0.0001, 8)).toBe('0.0001');
    expect(svgNumber(0.00001, 8)).toBe('1e-05');
    expect(svgNumber(123456789.5, 8)).toBe('1.2345679e+08');
    expect(svgNumber(1e-9, 8)).toBe('1e-09');
  });

  it('writes integers in the int range as is, also with more digits than the precision', () => {
    expect(svgNumber(123456789, 8)).toBe('123456789');
    expect(svgNumber(2147483647, 8)).toBe('2147483647');
    expect(svgNumber(-2147483648, 8)).toBe('-2147483648');
    expect(svgNumber(2147483648, 8)).toBe('2.1474836e+09');
  });

  it('writes negative zero as 0', () => {
    expect(svgNumber(-0)).toBe('0');
  });

  it('rounds exact ties to even like printf', () => {
    expect(svgNumber(0.125, 2)).toBe('0.12');
    expect(svgNumber(0.375, 2)).toBe('0.38');
    expect(svgNumber(2.5, 1)).toBe('2');
    // 2^-15 = 3.0517578125e-05 has 11 significant digits and ends in 5
    expect(svgNumber(2 ** -15, 10)).toBe('3.051757812e-05');
  });

  it('carries a rounding overflow into the exponent', () => {
    expect(svgNumber(9.9999999999, 8)).toBe('10');
    expect(svgNumber(99999999.9, 8)).toBe('1e+08');
  });

  it('works with a precision of 1', () => {
    expect(svgNumber(0.25, 1)).toBe('0.2');
    expect(svgNumber(1234.5, 1)).toBe('1e+03');
  });
});

describe('svgNumber, default precision 10', () => {
  it('drops binary noise', () => {
    expect(svgNumber(0.1 + 0.2)).toBe('0.3');
    expect(svgNumber(1 / 3)).toBe('0.3333333333');
    expect(svgNumber(-1 / 3)).toBe('-0.3333333333');
    expect(svgNumber(37.79527559055119)).toBe('37.79527559');
    expect(svgNumber(100.5)).toBe('100.5');
  });
});

describe('svgPoint', () => {
  it('writes x,y', () => {
    expect(svgPoint(12, 3.4, 8)).toBe('12,3.4');
  });
});

describe('cssNumber (CSSOStringStream), precision 8 digits after the period', () => {
  it.each([
    [0, '0'],
    [4.5, '4.5'],
    [-4, '-4'],
    [0.001, '0.001'],
    [1.23456789, '1.23456789'],
    [-1.23456789, '-1.23456789'],
    [12345678.9, '12345678.9'],
    [-12345678.9, '-12345678.9'],
    [1.234e-12, '0'],
    [3e9, '3000000000'],
    [-3.5e9, '-3500000000'],
  ])('%s -> %s', (value, expected) => {
    expect(cssNumber(value, 8)).toBe(expected);
  });

  it('never uses e notation', () => {
    expect(cssNumber(1e-9, 8)).toBe('0');
    expect(cssNumber(1.6e-8, 8)).toBe('0.00000002');
    expect(cssNumber(2 ** 40, 8)).toBe('1099511627776');
  });

  it('keeps the sign of a value that rounds to zero, as printf does', () => {
    expect(cssNumber(-1e-12, 8)).toBe('-0');
  });

  it('clamps the precision to 16 and rounds ties to even', () => {
    expect(cssNumber(1 / 3, 20)).toBe('0.3333333333333333');
    expect(cssNumber(0.125, 2)).toBe('0.12');
    expect(cssNumber(2.5, 0)).toBe('2');
    expect(cssNumber(0.5, 0)).toBe('0');
  });
});
