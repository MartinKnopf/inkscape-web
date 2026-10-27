// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/spaces-named-test.cpp
import { describe, expect, it } from 'vitest';
import { Color } from '../color.ts';
import { SpaceType as T } from './enum.ts';

describe('NamedColor', () => {
  it('parses names', () => {
    expect(Color.parse('  red  ')!.toRGBA()).toBe(0xff0000ff);
    expect(Color.parse('BLUE ')!.toRGBA(0.5)).toBe(0x0000ff80);
  });

  it('does not parse unknown names', () => {
    expect(Color.parse('réd')).toBeUndefined();
    expect(Color.parse('none')).toBeUndefined();
  });

  it('prints names', () => {
    expect(new Color(0xff000000, false).converted(T.CSSNAME)!.toString()).toBe('red');
    expect(Color.parse('mediumpurple')!.toString()).toBe('mediumpurple');
  });
});
