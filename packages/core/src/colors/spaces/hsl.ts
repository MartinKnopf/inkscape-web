// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/hsl.cpp, src/colors/spaces/hsl.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { HueParser } from '../parser.ts';
import { CssLegacyPrinter } from '../printer.ts';
import { SpaceType } from './enum.ts';
import { RGBBase } from './rgb.ts';

// Upstream computes this with floats.
function hue_2_rgb(v1: number, v2: number, h: number): number {
  if (h < 0) h += 6.0;
  if (h > 6) h -= 6.0;
  if (h < 1) return v1 + (v2 - v1) * h;
  if (h < 3) return v2;
  if (h < 4) return v1 + (v2 - v1) * (4 - h);
  return v1;
}

export class HSL extends RGBBase {
  static readonly OutputChannels = 3;
  static readonly ProfileChannels = 3;

  constructor() {
    super(SpaceType.HSL, 'HSL', 'HSL', 'color-selector-hsx', HSL);
    this._svgNames.push('hsl');
  }

  /**
   * Convert the HSL color into sRGB components used in the sRGB icc profile.
   */
  static spaceToProfile(i: ArrayLike<number>, o: number[]): void {
    const h = i[0]!;
    const s = i[1]!;
    const l = i[2]!;

    if (s === 0) {
      // Gray
      o[0] = l;
      o[1] = l;
      o[2] = l;
    } else {
      let v2: number;
      if (l < 0.5) {
        v2 = l * (1 + s);
      } else {
        v2 = l + s - l * s;
      }
      const v1 = 2 * l - v2;

      o[0] = hue_2_rgb(v1, v2, h * 6 + 2.0);
      o[1] = hue_2_rgb(v1, v2, h * 6);
      o[2] = hue_2_rgb(v1, v2, h * 6 - 2.0);
    }
  }

  /**
   * Convert from sRGB icc values to HSL values
   */
  static profileToSpace(i: ArrayLike<number>, o: number[]): void {
    const r = i[0]!;
    const g = i[1]!;
    const b = i[2]!;

    const max = Math.max(Math.max(r, g), b);
    const min = Math.min(Math.min(r, g), b);
    const delta = max - min;

    let h = 0;
    let s = 0;
    const l = (max + min) / 2.0;

    if (delta !== 0) {
      if (l <= 0.5) s = delta / (max + min);
      else s = delta / (2 - max - min);

      if (r === max) h = (g - b) / delta;
      else if (g === max) h = 2.0 + (b - r) / delta;
      else if (b === max) h = 4.0 + (r - g) / delta;

      h = h / 6.0;
      if (h < 0) h += 1;
      if (h > 1) h -= 1;
    }
    o[0] = h;
    o[1] = s;
    o[2] = l;
  }

  toString(values: readonly number[], opacity = true): string {
    const CSS_SL_SCALE = 100.0;
    const oo = new CssLegacyPrinter(3, 'hsl', opacity && values.length === 4);
    oo.addInt(values[0]! * 360) // hue, in degrees
      .add(values[1]! * CSS_SL_SCALE)
      .addText('%') // saturation, as percentage
      .add(values[2]! * CSS_SL_SCALE)
      .addText('%') // lightness, as percentage
      .add(values[values.length - 1]!); // optional alpha
    return oo.toString();
  }

  static Parser = class HSLParser extends HueParser {
    constructor(alpha: boolean) {
      super('hsl', SpaceType.HSL, alpha, 100.0);
    }
  };
}
