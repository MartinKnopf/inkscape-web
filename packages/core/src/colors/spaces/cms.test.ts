// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/spaces-cms-test.cpp
import { describe, expect, it } from 'vitest';
import { Color } from '../color.ts';
import { Parsers } from '../parser.ts';
import { CMS } from './cms.ts';
import { SpaceType as T } from './enum.ts';

describe('CMS space without a profile', () => {
  // TODO: CMS needs lcms via WASM, upstream tests the conversion with icc files.
  const space = new CMS('Some-Profile', 3, T.RGB);

  it('keeps an icc-color for printing', () => {
    const parsed = Parsers.get().parse('#ff8000 icc-color(Some-Profile, 0.1, 0.5, 1)')!;
    expect(parsed.cms).toBe('Some-Profile');
    const color = new Color(space, [...parsed.fallback, ...parsed.values]);
    expect(color.toString()).toBe('#ff8000 icc-color(Some-Profile, 0.1, 0.5, 1)');
  });

  it('is only converted from', () => {
    expect(space.hasValidCmsProfile()).toBe(false);
    const color = new Color(space, [1, 0, 0, 0.1, 0.2, 0.3]);
    expect(color.toRGBA()).toBe(0xff0000ff);
    // The fallback color is converted
    expect(color.converted(T.HSL)!.toString()).toBe('hsl(0, 100%, 50%)');
    // Without a profile, nothing is converted to the space
    expect(new Color(0xff0000ff).converted(space)).toBeUndefined();
  });
});
