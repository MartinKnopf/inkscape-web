// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/lch.cpp, src/colors/spaces/lch.h
/** @file
 */ /*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Parser, type StringStream } from '../parser.ts';
import { CssFuncPrinter } from '../printer.ts';
import { SCALE_DOWN, SCALE_UP } from './base.ts';
import { SpaceType } from './enum.ts';
import { Lab, LabBase } from './lab.ts';

export class Lch extends LabBase {
  static readonly ProfileChannels = 3;
  static readonly OutputChannels = 3;
  static readonly LUMA_SCALE = 100;
  static readonly CHROMA_SCALE = 150;
  static readonly HUE_SCALE = 360;

  constructor() {
    super(SpaceType.LCH, 'Lch', 'Lch', 'color-selector-lch', Lch, true);
    this._svgNames.push('lch');
  }

  static spaceToProfile(i: ArrayLike<number>, o: number[]): void {
    // Changes the values from 0..1, to typical lch scaling used in calculations.
    // L:0..100, C:0..150 H:0..360
    const l = SCALE_UP(i[0]!, 0, Lch.LUMA_SCALE);
    const c = SCALE_UP(i[1]!, 0, Lch.CHROMA_SCALE);
    const h = SCALE_UP(i[2]!, 0, Lch.HUE_SCALE);

    // Convert a color from the the LCH colorspace to the Lab colorspace.
    const hrad = h * (Math.PI / 180);
    const a = Math.cos(hrad) * c;
    const b = Math.sin(hrad) * c;

    // Changes the values from typical lab scaling (see above) to values 0..1.
    o[0] = SCALE_DOWN(l, 0, Lab.LUMA_SCALE);
    o[1] = SCALE_DOWN(a, Lab.MIN_SCALE, Lab.MAX_SCALE);
    o[2] = SCALE_DOWN(b, Lab.MIN_SCALE, Lab.MAX_SCALE);
  }

  static profileToSpace(i: ArrayLike<number>, o: number[]): void {
    // Changes the values from 0..1, to typical lab scaling used in calculations.
    const l = SCALE_UP(i[0]!, 0, Lab.LUMA_SCALE);
    const a = SCALE_UP(i[1]!, Lab.MIN_SCALE, Lab.MAX_SCALE);
    const b = SCALE_UP(i[2]!, Lab.MIN_SCALE, Lab.MAX_SCALE);

    // Convert a color from the the Lab colorspace to the LCH colorspace.
    let h: number;
    const c = Math.hypot(a, b);

    /* Grays: disambiguate hue */
    if (c < 0.00000001) {
      h = 0;
    } else {
      h = Math.atan2(b, a) * (180 / Math.PI);
      if (h < 0.0) {
        h += 360.0;
      }
    }

    // Changes the values from typical lch scaling (see above)
    // to values 0..1 used in the color module.
    o[0] = SCALE_DOWN(l, 0, Lch.LUMA_SCALE);
    o[1] = SCALE_DOWN(c, 0, Lch.CHROMA_SCALE);
    o[2] = SCALE_DOWN(h, 0, Lch.HUE_SCALE);
  }

  toString(values: readonly number[], opacity = true): string {
    const os = new CssFuncPrinter(3, 'lch');
    os.add(values[0]! * Lch.LUMA_SCALE) // Luminance
      .add(values[1]! * Lch.CHROMA_SCALE) // Chroma
      .add(values[2]! * Lch.HUE_SCALE); // Hue
    if (opacity && values.length === 4) os.add(values[3]!); // Optional opacity
    return os.toString();
  }

  static Parser = class LchParser extends Parser {
    constructor() {
      super('lch', SpaceType.LCH);
    }

    override parse(ss: StringStream, output: number[]): boolean {
      const state = { end: false };
      return (
        Parser.append_css_value(ss, output, state, ',', Lch.LUMA_SCALE) && // Luminance
        Parser.append_css_value(ss, output, state, ',', Lch.CHROMA_SCALE) && // Chroma
        Parser.append_css_value(ss, output, state, '/', Lch.HUE_SCALE) && // Hue
        (Parser.append_css_value(ss, output, state) || true) && // Optional opacity
        state.end
      );
    }
  };
}
