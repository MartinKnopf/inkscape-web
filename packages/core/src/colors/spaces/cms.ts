// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/cms.cpp, src/colors/spaces/cms.h
/** @file
 */ /*
 * Authors: see git history
 *
 * Copyright (C) 2023 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

// TODO: CMS needs lcms via WASM. This file only has the "naked" CMS space of upstream: the
// name of an icc profile, its number of channels and the sRGB fallback color, kept so that an
// icc-color value is printed again unchanged. It cannot convert colors through the profile.

import { Profile } from '../cms/profile.ts';
import { type ParseMore, Parser, type StringStream } from '../parser.ts';
import { IccColorPrinter } from '../printer.ts';
import { rgba_to_hex } from '../utils.ts';
import { ProfileSpace } from './base.ts';
import { type RenderingIntent, SpaceType } from './enum.ts';

/**
 * A space for the colors of an icc profile. The values are the three sRGB fallback values,
 * the channel values of the profile, and an optional opacity.
 */
export class CMS extends ProfileSpace {
  readonly #profile_size: number;
  readonly #profile_type: SpaceType;

  /**
   * Naked CMS space for data retention where the profile is unavailable.
   *
   * @arg profile_name - The name of the icc profile
   * @arg profile_size - The number of channels of the icc profile
   * @arg profile_type - The space type of the channels
   */
  constructor(profile_name: string, profile_size: number, profile_type: SpaceType = SpaceType.NONE) {
    super(SpaceType.CMS, profile_size + 3, profile_name, profile_name, 'color-selector-cms');
    this.#profile_size = profile_size;
    this.#profile_type = profile_type;
    this._intent_priority = 100;
  }

  override getComponentType(): SpaceType {
    return this.#profile_type;
  }

  /** There is no icc profile in this space, so the fallback sRGB profile is returned. */
  getProfile(): Profile {
    return Profile.createSrgb();
  }

  setIntent(intent: RenderingIntent): void {
    this._intent = intent;
  }

  /** Returns false if this icc profile is not connected to any actual profile */
  override hasValidCmsProfile(): boolean {
    return false;
  }

  /**
   * This space lacks a profile, so its values are really the sRGB fallback values, and
   * we strip out any other values from the io.
   */
  override spaceToProfile(io: number[]): boolean {
    const has_rgb = io.length >= this.#profile_size + 3;
    const has_alpha = io.length === this.#profile_size + (has_rgb ? 3 : 0) + 1;
    // Remove the CMS values leaving just the backup RGB
    io.splice(3, io.length - Number(has_alpha) - 3);
    return true;
  }

  /**
   * Output these values into this CMS space.
   *
   * @args values - The values for each channel in the icc profile.
   * @args opacity - Should opacity be included. This is ignored since cms
   *                 output is ALWAYS without opacity.
   *
   * @returns the string suitable for css and style use.
   */
  toString(values: readonly number[], _opacity = true): string {
    if (values.length < this.#profile_size) return '';

    // RGBA Hex fallback plus icc-color section
    const oo = new IccColorPrinter(this.#profile_size, this.getName());

    // When an icc color was parsed, but there is no profile
    // Not enough values for a fallback option (maybe corrupt?)
    if (values.length < this.#profile_size + 3) return '';
    oo.addAll(values.slice(3));
    // opacity is never added to the printer here, always ignored

    return `${rgba_to_hex(this.toRGBA(values), false)} ${oo.toString()}`;
  }

  /**
   * Return true if, using a rough hueruistic, this color could be considered to be using
   * too much ink if it was printed using the ink as specified.
   *
   * NOTE: This is only useful for CMYK profiles. Anything else will return false.
   *
   * @arg input - Channel values in this space.
   */
  override overInk(input: readonly number[]): boolean {
    if (input.length === 0 || this.#profile_type !== SpaceType.CMYK) return false;

    /* Some literature states that when the sum of paint values exceed 320%, it is considered to be a satured color,
       which means the paper can get too wet due to an excessive amount of ink. This may lead to several issues
       such as misalignment and poor quality of printing in general.*/
    return input[3]! + input[4]! + input[5]! + input[6]! > 3.2;
  }

  /** Parses `icc-color(name, values...)` (the sRGB fallback comes before it, see `Parsers`). */
  static CmsParser = class CmsParser extends Parser {
    constructor() {
      super('icc-color', SpaceType.CMS);
    }

    /**
     * Parse a string stream into a vector of doubles which are always values in
     * this CMS space / icc profile.
     *
     * @args ss - String input which doesn't have to be at the start of the string.
     * @returns output - The vector to populate with the numbers found in the string.
     * @returns the name of the cms profile requested.
     */
    override parseColor(ss: StringStream, output: number[], _more: ParseMore): string {
      let icc_name = ss.readToken();
      if (icc_name !== '' && icc_name.endsWith(',')) icc_name = icc_name.slice(0, -1);

      const state = { end: false };
      while (!state.end && Parser.append_css_value(ss, output, state, ',')) {
        // keep reading values
      }

      if (output.length === 0) {
        const named = ss.readToken();
        if (named !== '' && ss.get() === ')') {
          console.error(
            `Found SVG2 ICC named color '${named}' for profile '${icc_name}', which not supported yet.`,
          );
        }
      }
      return icc_name;
    }
  };
}
