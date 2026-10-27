// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/svg-bool.cpp
import { describe, expect, it } from 'vitest';
import { SVGBool } from './svg-bool.ts';

describe('SVGBool', () => {
  it('returns the default until a value is read', () => {
    expect(new SVGBool(true).value).toBe(true);
    expect(new SVGBool(false).value).toBe(false);
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    ['Yes', true],
    ['y', true],
    ['1', true],
    ['-2', true],
    [' 3x', true],
    ['0', false],
    ['false', false],
    ['no', false],
    ['', false],
    ['yess', false],
  ])('reads %j as %s', (str, expected) => {
    const b = new SVGBool(!expected);
    expect(b.read(str)).toBe(true);
    expect(b.value).toBe(expected);
  });

  it('unsets on a missing value and falls back to the default', () => {
    const b = new SVGBool(true);
    b.read('false');
    b.readOrUnset(null);
    expect(b.value).toBe(true);
  });
});
