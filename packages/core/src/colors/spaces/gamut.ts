// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/gamut.cpp, src/colors/spaces/gamut.h
//
// CSS Level 4 gamut mapping: https://www.w3.org/TR/css-color-4/#gamut-mapping
//
// Implementation adopted from:
// https://github.com/color-js/color.js/blob/main/src/toGamut.js

import type { Color } from '../color.ts';
import { ColorError } from '../forward.ts';
import type { AnySpace } from './base.ts';
import { SpaceType } from './enum.ts';

/** Channel values that are valid for a bounded space, 0..1 (extra opacity channels are ignored). */
function _out_of_gamut(input: readonly number[], space: AnySpace, eps: number): boolean {
  if (input.length === 0) return false;
  const N = space.getComponentCount();
  if (input.length < N) {
    throw new ColorError("_out_of_gamut: color values count doesn't match number of components");
  }
  // simple check for channels outside of 0..1 range, since most channels use normalized ranges;
  // using epsilon value to ignore conversion rounding errors
  for (let i = 0; i < N; ++i) {
    if (input[i]! < 0 - eps || input[i]! > 1 + eps) {
      return true; // out of gamut
    }
  }
  return false; // in gamut
}

/**
 * More accurate color-difference formulae
 * than the simple 1976 Euclidean distance in CIE Lab
 */
function deltaEOK(color: Color, sample: Color): number {
  // Given this color as the reference and a sample,
  // calculate deltaEOK, term by term as root sum of squares
  const c = color.converted(SpaceType.OKLAB)!;
  const s = sample.converted(SpaceType.OKLAB)!;
  const ΔL = c.get(0) - s.get(0);
  const Δa = c.get(1) - s.get(1);
  const Δb = c.get(2) - s.get(2);
  return Math.sqrt(ΔL * ΔL + Δa * Δa + Δb * Δb);
}

/** White or black in `space`, with the opacity of `origin`. */
function mediaColor(origin: Color, rgba: number, space: AnySpace): Color {
  const color = origin.clone();
  color.set(rgba, false);
  const converted = color.converted(space)!;
  if (origin.hasOpacity()) {
    converted.setOpacity(origin.getOpacity());
  }
  return converted;
}

/**
 * Given a color `origin`, returns a new color that is in gamut using
 * the CSS Gamut Mapping Algorithm. The result is in gamut in `space`, and returned in `space`.
 */
export function to_gamut_css(origin: Color, space: AnySpace): Color {
  const JND = 0.02;
  const ε = 0.0001;

  if (space.isUnbounded()) {
    return origin.converted(space)!;
  }

  const origin_OKLCH = origin.converted(SpaceType.OKLCH)!;
  const L = origin_OKLCH.get(0);

  // return media white or black, if lightness is out of range
  if (L >= 1) {
    return mediaColor(origin, 0xffffffff, space);
  }
  if (L <= 0) {
    return mediaColor(origin, 0x000000ff, space);
  }

  if (!out_of_gamut(origin_OKLCH, space, 0 /*{epsilon: 0}*/)) {
    return origin_OKLCH.converted(space)!;
  }

  const clip = (color: Color): Color => {
    const destColor = color.converted(space)!;
    destColor.normalize();
    return destColor;
  };
  let min = 0;
  let max = origin_OKLCH.get(1);
  let min_inGamut = true;
  const current = origin_OKLCH.clone();
  let clipped = clip(current);
  let E = deltaEOK(clipped, current);

  if (E < JND) {
    return clipped;
  }

  while (max - min > ε) {
    const chroma = (min + max) / 2;
    current.set(1, chroma);

    if (min_inGamut && !out_of_gamut(current, space, 0 /*{epsilon: 0}*/)) {
      min = chroma;
    } else {
      clipped = clip(current);
      E = deltaEOK(clipped, current);

      if (E < JND) {
        if (JND - E < ε) {
          break;
        }
        min_inGamut = false;
        min = chroma;
      } else {
        max = chroma;
      }
    }
  }

  return clipped;
}

/** Check if color is outside of given color space gamut. */
export function out_of_gamut(color: Color, space: AnySpace, eps = 0.0001): boolean {
  // if space is unbounded, all values are considered in-gamut
  if (space.isUnbounded()) return false;
  if (color.getSpace() === space) {
    return _out_of_gamut(color.getValues(), space, eps);
  }
  return _out_of_gamut(color.converted(space)!.getValues(), space, eps);
}
