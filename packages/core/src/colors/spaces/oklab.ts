// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/oklab.cpp, src/colors/spaces/oklab.h
/** @file
 */ /*
 * Authors:
 *   Rafał Siejakowski <rs@rs-math.net>
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Parser, type StringStream } from '../parser.ts';
import { CssFuncPrinter } from '../printer.ts';
import { SCALE_DOWN, SCALE_UP } from './base.ts';
import { SpaceType } from './enum.ts';
import { LinearRGB } from './linear-rgb.ts';
import { RGBBase } from './rgb.ts';

type Matrix = readonly (readonly number[])[];

const LRGB2CONE: Matrix = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

const CONE2LRGB: Matrix = [
  [4.076741661347994, -3.3077115904081933, 0.2309699287294279],
  [-1.268438004092176, 2.6097574006633715, -0.3413193963102196],
  [-0.004196086541837109, -0.7034186144594496, 1.7076147009309448],
];

const M2: Matrix = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

const M2_INVERSE: Matrix = [
  [0.9999999984505198, 0.39633779217376786, 0.2158037580607588],
  [1.0000000088817609, -0.10556134232365635, -0.06385417477170591],
  [1.0000000546724108, -0.08948418209496575, -1.2914855378640917],
];

function cube(x: number): number {
  return x * x * x;
}

function dot3(a1: readonly number[], a2: ArrayLike<number>): number {
  return a1[0]! * a2[0]! + a1[1]! * a2[1]! + a1[2]! * a2[2]!;
}

export class OkLab extends RGBBase {
  static readonly ProfileChannels = 3;
  static readonly OutputChannels = 3;

  /* These values are technically unbounded in the actual calculations but are
   * defined between -0.4 and 0.4 by the CSS Color Module specification
   * as the reasonable upper and lower limits for display. Our internal model
   * always scales from 0 to 1 of this expected range of values.
   */
  static readonly MIN_SCALE = -0.4;
  static readonly MAX_SCALE = 0.4;

  constructor() {
    super(SpaceType.OKLAB, 'OkLab', 'OkLab', 'color-selector-oklab', OkLab, true);
    this._svgNames.push('oklab');
  }

  static spaceToProfile(i: ArrayLike<number>, o: number[]): void {
    o[0] = i[0]!;
    o[1] = SCALE_UP(i[1]!, OkLab.MIN_SCALE, OkLab.MAX_SCALE);
    o[2] = SCALE_UP(i[2]!, OkLab.MIN_SCALE, OkLab.MAX_SCALE);
    OkLab.toLinearRGB(o, o);
    LinearRGB.toRGB(o, o);
  }

  static profileToSpace(i: ArrayLike<number>, o: number[]): void {
    LinearRGB.fromRGB(i, o);
    OkLab.fromLinearRGB(o, o);
    o[1] = SCALE_DOWN(o[1]!, OkLab.MIN_SCALE, OkLab.MAX_SCALE);
    o[2] = SCALE_DOWN(o[2]!, OkLab.MIN_SCALE, OkLab.MAX_SCALE);
  }

  static toLinearRGB(i: ArrayLike<number>, o: number[]): void {
    const cones = [0, 1, 2].map((c) => cube(dot3(M2_INVERSE[c]!, i)));
    for (let c = 0; c < 3; c++) {
      // input is unbounded, so don't clip it in linearRGB either, or else we loose information
      o[c] = dot3(CONE2LRGB[c]!, cones);
    }
  }

  static fromLinearRGB(i: ArrayLike<number>, o: number[]): void {
    const cones = [0, 1, 2].map((c) => Math.cbrt(dot3(LRGB2CONE[c]!, i)));
    for (let c = 0; c < 3; c++) {
      o[c] = dot3(M2[c]!, cones);
    }
  }

  toString(values: readonly number[], opacity = true): string {
    const os = new CssFuncPrinter(3, 'oklab');
    os.add(values[0]!) // Luminance
      .add(SCALE_UP(values[1]!, OkLab.MIN_SCALE, OkLab.MAX_SCALE)) // Chroma A
      .add(SCALE_UP(values[2]!, OkLab.MIN_SCALE, OkLab.MAX_SCALE)); // Chroma B
    if (opacity && values.length === 4) os.add(values[3]!); // Optional opacity
    return os.toString();
  }

  static Parser = class OkLabParser extends Parser {
    constructor() {
      super('oklab', SpaceType.OKLAB);
    }

    override parse(ss: StringStream, output: number[]): boolean {
      const state = { end: false };
      if (
        Parser.append_css_value(ss, output, state, ',') && // Luminance
        Parser.append_css_value(ss, output, state, ',', OkLab.MAX_SCALE) && // Chroma A
        Parser.append_css_value(ss, output, state, '/', OkLab.MAX_SCALE) && // Chroma B
        (Parser.append_css_value(ss, output, state) || true) && // Optional opacity
        state.end
      ) {
        // Values are between -100% and 100% so post processed into the range 0 to 1
        output[1] = (output[1]! + 1) / 2;
        output[2] = (output[2]! + 1) / 2;
        return true;
      }
      return false;
    }
  };
}
