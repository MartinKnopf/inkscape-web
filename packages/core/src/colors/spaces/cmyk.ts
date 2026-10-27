// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/cmyk.cpp, src/colors/spaces/cmyk.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { CssFuncPrinter } from '../printer.ts';
import { SpaceType } from './enum.ts';
import { RGBBase } from './rgb.ts';

export class DeviceCMYK extends RGBBase {
  static readonly OutputChannels = 4;
  static readonly ProfileChannels = 3;

  constructor() {
    super(SpaceType.CMYK, 'DeviceCMYK', 'CMYK', 'color-selector-cmyk', DeviceCMYK);
    this._svgNames.push('device-cmyk');
  }

  /**
   * Convert the DeviceCMYK color into sRGB components used in the sRGB icc profile.
   *
   * See CSS Color Module Level 5, device-cmyk Uncalibrated conversion.
   */
  static spaceToProfile(i: ArrayLike<number>, o: number[]): void {
    const black = i[3]!;
    const white = 1.0 - black;
    const c = i[0]!;
    const m = i[1]!;
    const y = i[2]!;

    o[0] = 1.0 - Math.min(1.0, c * white + black);
    o[1] = 1.0 - Math.min(1.0, m * white + black);
    o[2] = 1.0 - Math.min(1.0, y * white + black);
  }

  /**
   * Convert from sRGB icc values to DeviceCMYK values. The output has 4 channels, so `o` must
   * have room for the 4th.
   *
   * See CSS Color Module Level 5, device-cmyk Uncalibrated conversion.
   */
  static profileToSpace(i: ArrayLike<number>, o: number[]): void {
    const r = i[0]!;
    const g = i[1]!;
    const b = i[2]!;

    // Insert black channel at position 3
    const black = 1.0 - Math.max(Math.max(r, g), b);
    const white = 1.0 - black;
    o[3] = black;

    // Each channel is its color chart opposite (cyan->red) with a bit of white removed.
    o[0] = white ? (1.0 - r - black) / white : 0.0;
    o[1] = white ? (1.0 - g - black) / white : 0.0;
    o[2] = white ? (1.0 - b - black) / white : 0.0;
  }

  toString(values: readonly number[], opacity = true): string {
    const os = new CssFuncPrinter(4, 'device-cmyk');
    os.addAll(values);
    if (opacity && values.length === 5) os.add(values[4]!);
    return os.toString();
  }

  override overInk(input: readonly number[]): boolean {
    if (!input.length) return false;
    // Over 320% is considered over inked, see cms.cpp for details.
    return input[0]! + input[1]! + input[2]! + input[3]! > 3.2;
  }
}
