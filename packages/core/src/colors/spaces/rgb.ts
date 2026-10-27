// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/rgb.cpp, src/colors/spaces/rgb.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Profile } from '../cms/profile.ts';
import { LegacyParser, Parser, type StringStream } from '../parser.ts';
import { rgba_to_hex } from '../utils.ts';
import { type ChannelConversion, ConvertableSpace, ProfileSpace } from './base.ts';
import { SpaceType } from './enum.ts';

/**
 * A space that is converted to and from sRGB (upstream RGBBase<T>), for example HSL.
 */
export abstract class RGBBase extends ConvertableSpace {
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
    return Profile.createSrgb();
  }
}

export class RGB extends ProfileSpace {
  static readonly ProfileChannels = 3;
  static readonly OutputChannels = 3;

  constructor();
  /** Unique constructor for CSSNAME which is just sRGB with strings. */
  constructor(type: SpaceType, name: string, shortName: string, icon: string);
  constructor(type?: SpaceType, name?: string, shortName?: string, icon?: string) {
    if (type === undefined) {
      super(SpaceType.RGB, 3, 'RGB', 'RGB', 'color-selector-rgb');
      this._svgNames.push('sRGB');
    } else {
      super(type, 3, name!, shortName!, icon!);
    }
  }

  getProfile(): Profile {
    return Profile.createSrgb();
  }

  toString(values: readonly number[], opacity = true): string {
    return rgba_to_hex(this.toRGBA(values), values.length === 4 && opacity);
  }

  static Parser = class RGBParser extends LegacyParser {
    constructor(alpha: boolean) {
      super('rgb', SpaceType.RGB, alpha);
    }

    override parse(ss: StringStream, output: number[]): boolean {
      // Modern CSS syntax
      let sep0 = '';
      let sep1 = '/'; // alpha separator
      let max_count = 4;
      // Legacy CSS syntax
      if (ss.str().includes(',')) {
        sep0 = ',';
        sep1 = ',';
        max_count = this._alpha ? 4 : 3; // rgb() must have 3 and rgba() 4
      }
      const state = { end: false };
      while (!state.end && output.length < max_count) {
        if (
          !Parser.append_css_value(
            ss,
            output,
            state,
            output.length === 2 ? sep1 : sep0,
            output.length === 3 ? 1.0 : 255.0,
          )
        )
          break;
      }
      return state.end;
    }
  };
}
