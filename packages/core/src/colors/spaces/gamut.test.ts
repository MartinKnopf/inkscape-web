// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/gamut-test.cpp
import { describe, expect, it } from 'vitest';
import { Color } from '../color.ts';
import { Manager } from '../manager.ts';
import { SpaceType as T } from './enum.ts';
import { expectNear } from './testbase.ts';

describe('CSS gamut mapping', () => {
  const rgb = Manager.get().find(T.RGB)!;

  it.each([
    // red oversaturated and out of gamut in sRGB, but fits in Rec2020
    [
      [0.7, 0.25 / 0.4, 20 / 360.0],
      [1.0, 0.332, 0.393],
    ],
    // dark cyan, desaturated below sRGB, but fits in P3
    [
      [0.53, 0.1 / 0.4, 209 / 360.0],
      [0.0, 0.486, 0.553],
    ],
  ])('maps oklch %j to sRGB', (input, out) => {
    const result = rgb.toGamut(new Color(T.OKLCH, [...input!]));
    expectNear(result.getValues(), out!, 0.001);
  });

  it('keeps the opacity of white and black', () => {
    const white = rgb.toGamut(new Color(T.OKLCH, [1.2, 0.1, 0.5, 0.5]));
    expect(white.toString()).toBe('#ffffff80');
    const black = rgb.toGamut(new Color(T.OKLCH, [-0.1, 0.1, 0.5]));
    expect(black.toString()).toBe('#000000');
  });

  it('tells if a color is out of gamut', () => {
    expect(rgb.isOutOfGamut(new Color(T.OKLCH, [0.7, 0.25 / 0.4, 20 / 360.0]))).toBe(true);
    expect(rgb.isOutOfGamut(new Color(0xff0000ff))).toBe(false);
    expect(
      Manager.get()
        .find(T.LAB)!
        .isOutOfGamut(new Color(T.LAB, [3, -3, 4])),
    ).toBe(false);
  });
});
