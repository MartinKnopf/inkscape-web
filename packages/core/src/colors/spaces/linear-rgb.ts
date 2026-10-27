// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/linear-rgb.cpp, src/colors/spaces/linear-rgb.h
/** @file
 */ /*
 * Authors:
 *   Rafał Siejakowski <rs@rs-math.net>
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Profile } from '../cms/profile.ts';
import { CssColorPrinter } from '../printer.ts';
import { ProfileSpace } from './base.ts';
import { RenderingIntent, SpaceType } from './enum.ts';

export class LinearRGB extends ProfileSpace {
  constructor() {
    super(SpaceType.linearRGB, 3, 'linearRGB', 'linearRGB', 'color-selector-linear-rgb');
    this._svgNames.push('linearRGB');
    this._svgNames.push('srgb-linear');
    this._intent = RenderingIntent.RELATIVE_COLORIMETRIC;
    this._intent_priority = 10;
  }

  getProfile(): Profile {
    return Profile.createLinearrgb();
  }

  toString(values: readonly number[], opacity = true): string {
    const os = new CssColorPrinter(3, 'srgb-linear');
    os.addAll(values);
    if (opacity && values.length === 4) os.add(values[values.length - 1]!);
    return os.toString();
  }

  // NOTE: the following conversions are used by OkLab to avoid being based in the linearRGB icc profile

  /**
   * Convert a color from the a linear RGB colorspace to the sRGB colorspace.
   * `i` and `o` may be the same array.
   */
  static toRGB(i: ArrayLike<number>, o: number[]): void {
    const from_linear = (c: number): number =>
      c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1.0 / 2.4) - 0.055;
    const [r, g, b] = [from_linear(i[0]!), from_linear(i[1]!), from_linear(i[2]!)];
    o[0] = r;
    o[1] = g;
    o[2] = b;
  }

  /**
   * Convert from sRGB icc values to linear RGB values. `i` and `o` may be the same array.
   */
  static fromRGB(i: ArrayLike<number>, o: number[]): void {
    const to_linear = (c: number): number => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
    const [r, g, b] = [to_linear(i[0]!), to_linear(i[1]!), to_linear(i[2]!)];
    o[0] = r;
    o[1] = g;
    o[2] = b;
  }
}
