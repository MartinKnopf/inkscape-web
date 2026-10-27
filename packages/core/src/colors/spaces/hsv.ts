// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/hsv.cpp, src/colors/spaces/hsv.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { HueParser, type StringStream } from '../parser.ts';
import { CssFuncPrinter } from '../printer.ts';
import { SpaceType } from './enum.ts';
import { RGBBase } from './rgb.ts';

export class HSV extends RGBBase {
  static readonly ProfileChannels = 3;
  static readonly OutputChannels = 3;

  constructor() {
    super(SpaceType.HSV, 'HSV', 'HSV', 'color-selector-hsx', HSV);
  }

  /**
   * Convert the HSV color into sRGB components used in the sRGB icc profile.
   */
  static spaceToProfile(i: ArrayLike<number>, o: number[]): void {
    const d = i[0]! * 5.99999999;
    const v = i[2]!;
    const f = d - Math.floor(d);
    const w = v * (1.0 - i[1]!);
    const q = v * (1.0 - i[1]! * f);
    const t = v * (1.0 - i[1]! * (1.0 - f));

    if (d < 1.0) {
      o[0] = v;
      o[1] = t;
      o[2] = w;
    } else if (d < 2.0) {
      o[0] = q;
      o[1] = v;
      o[2] = w;
    } else if (d < 3.0) {
      o[0] = w;
      o[1] = v;
      o[2] = t;
    } else if (d < 4.0) {
      o[0] = w;
      o[1] = q;
      o[2] = v;
    } else if (d < 5.0) {
      o[0] = t;
      o[1] = w;
      o[2] = v;
    } else {
      o[0] = v;
      o[1] = w;
      o[2] = q;
    }
  }

  /**
   * Convert from sRGB icc values to HSV values
   */
  static profileToSpace(i: ArrayLike<number>, o: number[]): void {
    const r = i[0]!;
    const g = i[1]!;
    const b = i[2]!;

    const max = Math.max(Math.max(r, g), b);
    const min = Math.min(Math.min(r, g), b);
    const delta = max - min;

    let h: number;
    const s = max > 0 ? delta / max : 0.0;
    if (s !== 0.0) {
      if (r === max) {
        h = (g - b) / delta;
      } else if (g === max) {
        h = 2.0 + (b - r) / delta;
      } else {
        h = 4.0 + (r - g) / delta;
      }
      h = h / 6.0;
      if (h < 0) h += 1.0;
    } else {
      h = 0.0;
    }
    o[0] = h;
    o[1] = s;
    o[2] = max;
  }

  /** Print as CSS hwb(). */
  toString(values: readonly number[], opacity = true): string {
    const CSS_WB_SCALE = 100.0;
    const oo = new CssFuncPrinter(3, 'hwb');
    // First entry is Hue, which is in degrees, white and black are derived
    oo.addInt(values[0]! * 360) // Hue, degrees, 0..360
      .add((1.0 - values[1]!) * values[2]! * CSS_WB_SCALE) // White,        0..100
      .add((1.0 - values[2]!) * CSS_WB_SCALE); // Black,        0..100
    if (opacity && values.length === 4) oo.add(values[3]!); // Optional opacity
    return oo.toString();
  }

  /** Parses CSS hwb() into HSV values. */
  static fromHwbParser = class FromHwbParser extends HueParser {
    constructor(alpha: boolean) {
      super('hwb', SpaceType.HSV, alpha, 100.0);
    }

    override parse(ss: StringStream, output: number[]): boolean {
      if (super.parse(ss, output)) {
        // See https://en.wikipedia.org/wiki/HWB_color_model#Converting_to_and_from_HSV
        const scale = output[1]! + output[2]!;
        if (scale > 1.0) {
          output[1] = output[1]! / scale;
          output[2] = output[2]! / scale;
        }
        output[1] = output[2] === 1.0 ? 0.0 : 1.0 - output[1]! / (1.0 - output[2]!);
        output[2] = 1.0 - output[2]!;
        return true;
      }
      return false;
    }
  };
}
