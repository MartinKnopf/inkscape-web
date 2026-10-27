// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/lab.cpp, src/colors/spaces/lab.h
/** @file
 */ /*
 * Authors:
 *   2023 Martin Owens
 *
 * Copyright (C) 2023 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Profile } from '../cms/profile.ts';
import { Parser, type StringStream } from '../parser.ts';
import { CssFuncPrinter } from '../printer.ts';
import { type ChannelConversion, ConvertableSpace, ProfileSpace, SCALE_DOWN, SCALE_UP } from './base.ts';
import { RenderingIntent, SpaceType } from './enum.ts';

/** A space that is converted to and from Lab D50 (upstream LabBase<T>), for example Lch. */
export abstract class LabBase extends ConvertableSpace {
  protected constructor(
    type: SpaceType,
    name: string,
    shortName: string,
    icon: string,
    target: ChannelConversion,
    spaceIsUnbounded = false,
  ) {
    super(type, name, shortName, icon, target, spaceIsUnbounded);
  }

  getProfile(): Profile {
    return Profile.createLab();
  }
}

export class Lab extends ProfileSpace {
  static readonly LUMA_SCALE = 100;
  // CSS Actual values are scaled -128 -> 127
  static readonly MIN_SCALE = -128;
  static readonly MAX_SCALE = 127;

  constructor() {
    super(SpaceType.LAB, 3, 'Lab', 'Lab', 'color-selector-lab', true);
    this._svgNames.push('lab');
    this._intent = RenderingIntent.ABSOLUTE_COLORIMETRIC;
    this._intent_priority = 10;
  }

  getProfile(): Profile {
    return Profile.createLab();
  }

  toString(values: readonly number[], opacity = true): string {
    const os = new CssFuncPrinter(3, 'lab');
    os.add(values[0]! * Lab.LUMA_SCALE) // Luminance
      .add(SCALE_UP(values[1]!, Lab.MIN_SCALE, Lab.MAX_SCALE)) // Chroma A
      .add(SCALE_UP(values[2]!, Lab.MIN_SCALE, Lab.MAX_SCALE)); // Chroma B
    if (opacity && values.length === 4) os.add(values[3]!); // Optional opacity
    return os.toString();
  }

  static Parser = class LabParser extends Parser {
    constructor() {
      super('lab', SpaceType.LAB);
    }

    override parse(ss: StringStream, output: number[]): boolean {
      // CSS Color Module 4 defines 100% as 125 for A/B in lab
      const CSS_PERCENT_SCALE = 100.0 / 125.0;
      const state = { end: false };
      if (
        Parser.append_css_value(ss, output, state, ',', Lab.LUMA_SCALE) && // Lightness
        Parser.append_css_value(ss, output, state, ',', 1.0, CSS_PERCENT_SCALE) && // Chroma-A
        Parser.append_css_value(ss, output, state, '/', 1.0, CSS_PERCENT_SCALE) && // Chroma-B
        (Parser.append_css_value(ss, output, state) || true) && // Optional opacity
        state.end
      ) {
        // The A and B portions are between -128 and +127 which is hard for append_css_value to convert
        output[1] = SCALE_DOWN(output[1]!, Lab.MIN_SCALE, Lab.MAX_SCALE);
        output[2] = SCALE_DOWN(output[2]!, Lab.MIN_SCALE, Lab.MAX_SCALE);
        return true;
      }
      return false;
    }
  };
}
