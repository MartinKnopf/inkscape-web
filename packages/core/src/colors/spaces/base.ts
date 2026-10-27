// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/base.cpp, src/colors/spaces/base.h, src/colors/spaces/convert-static.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023-2025 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Profile } from '../cms/profile.ts';
import type { Color } from '../color.ts';
import { ColorError } from '../forward.ts';
import { SP_RGBA32_F_COMPOSE } from '../utils.ts';
import { Components } from './components.ts';
import { RenderingIntent, SpaceType } from './enum.ts';
import { out_of_gamut, to_gamut_css } from './gamut.ts';

export function SCALE_UP(v: number, a: number, b: number): number {
  return v * (b - a) + a;
}

export function SCALE_DOWN(v: number, a: number, b: number): number {
  return (v - a) / (b - a);
}

/**
 * A converter between the channels of a space and of its profile, or back. `i` and `o` may be
 * the same array. Upstream has these as static templates (convert-static.h); the variants for
 * premultiplied alpha are not ported (they are used only for surface conversion).
 */
export type ChannelConverter = (i: ArrayLike<number>, o: number[]) => void;

/**
 * A color space. Each space has a unique type enum for easier static use. Colors are stored as
 * a list of channel values, the space knows what they mean, how to print them and how to
 * convert them to and from the channels of its profile.
 *
 * Members that are protected in upstream (used by the friend class Color) are public here.
 */
export abstract class AnySpace {
  protected _intent = RenderingIntent.UNKNOWN;
  protected _intent_priority = 0;
  protected _svgNames: string[] = [];

  readonly #type: SpaceType;
  readonly #components: number;
  readonly #name: string;
  readonly #shortName: string;
  readonly #icon: string;
  readonly #spaceIsUnbounded: boolean;

  /**
   * Construct a Color Space with all required data for display and use.
   *
   * @arg type       - The type of space, this will be the same as the end class
   * @arg components - The number of component channels in this color space
   * @arg name       - The common name for this color space
   * @arg shortName  - A shorter name used in drop down selections and other tight spaces
   * @arg icon       - An icon name which is used in many UI locations as a short hand for this space.
   * @arg spaceIsUnbounded - If true, this color space can have values larger and smaller than 0.0 to 1.0
   *
   * Further information about the components themselves are contained within components.ts
   */
  protected constructor(
    type: SpaceType,
    components: number,
    name: string,
    shortName: string,
    icon: string,
    spaceIsUnbounded = false,
  ) {
    this.#type = type;
    this.#components = components;
    this.#name = name;
    this.#shortName = shortName;
    this.#icon = icon;
    this.#spaceIsUnbounded = spaceIsUnbounded;
  }

  /** Same space: spaces are equal if their names are the same (upstream `operator==`). */
  equals(other: AnySpace): boolean {
    return other.getName() === this.getName();
  }

  getType(): SpaceType {
    return this.#type;
  }
  getName(): string {
    return this.#name;
  }
  getShortName(): string {
    return this.#shortName;
  }
  getSvgName(): string {
    return this._svgNames[0] ?? '';
  }
  getSvgNames(): readonly string[] {
    return this._svgNames;
  }
  getIcon(): string {
    return this.#icon;
  }
  getComponentCount(): number {
    return this.#components;
  }
  /** The type of the channels, use this for seeing the internal type of the space, for example in the CMS space. */
  getComponentType(): SpaceType {
    return this.getType();
  }

  abstract getProfile(): Profile;

  getIntent(): RenderingIntent {
    return this._intent;
  }

  /**
   * Get the best rendering intent for this color space conversion.
   */
  getBestIntent(toSpace: AnySpace): RenderingIntent {
    // Choose best rendering intent based on the intent priority
    let intent: RenderingIntent;
    if (this._intent_priority <= toSpace._intent_priority || this.getIntent() === RenderingIntent.UNKNOWN) {
      intent = toSpace.getIntent();
    } else {
      intent = this.getIntent();
    }
    if (intent === RenderingIntent.UNKNOWN) {
      intent = RenderingIntent.PERCEPTUAL;
    }
    return intent;
  }

  /** Specifies if this color space can be used for color interpolation in the render engine. */
  canInterpolateColors(): boolean {
    return true;
  }

  /**
   * Some color spaces (like XYZ or LAB) do not put restrictions on valid ranges of values;
   * others (like sRGB) do, which means that channels outside those bounds represent colors out of gamut.
   */
  isUnbounded(): boolean {
    return this.#spaceIsUnbounded;
  }

  /**
   * Check if 'color' is out of gamut in this color space;
   * use epsilon value to ignore some small deviations from valid domain (they can arise during conversions).
   */
  isOutOfGamut(color: Color, eps = 0.0001): boolean {
    return out_of_gamut(color, this, eps);
  }

  /** Bring 'color' into gamut of this color space. */
  toGamut(color: Color): Color {
    // By default apply CSS Level 4 gamut mapping: https://www.w3.org/TR/css-color-4/#gamut-mapping
    // This approach will match behavior of browsers.
    // If we had an ICC profile selected, we could use that instead.
    return to_gamut_css(color, this);
  }

  /**
   * Return a list of Component objects, in order of the channels in this color space
   *
   * @arg alpha - If true, returns the alpha component as well
   */
  getComponents(alpha = false): Components {
    return Components.get(this.getComponentType(), alpha);
  }

  getPrefsPath(): string {
    return `/colorselector/${this.getName()}/`;
  }

  /** Returns true almost always. Only CMS could have a different return value. */
  hasValidCmsProfile(): boolean {
    return true;
  }

  abstract spaceToProfile(io: number[]): boolean;
  abstract profileToProfile(io: number[], profile: Profile, intent: RenderingIntent): boolean;
  abstract profileToSpace(io: number[]): boolean;

  /**
   * Convert between any two color spaces and their profiles.
   */
  convert(io: number[], toSpace: AnySpace, intent: RenderingIntent = this.getBestIntent(toSpace)): boolean {
    return (
      this.spaceToProfile(io) &&
      this.profileToProfile(io, toSpace.getProfile(), intent) &&
      toSpace.profileToSpace(io)
    );
  }

  /**
   * Return true if the given data would be valid for this color space.
   */
  isValidData(values: readonly number[]): boolean {
    const nValues = values.length;
    const nSpace = this.getComponentCount();
    return nValues === nSpace || nValues === nSpace + 1;
  }

  abstract toString(values: readonly number[], opacity?: boolean): string;

  /**
   * Convert the color into an RGBA32 for use within Gdk rendering.
   */
  toRGBA(values: readonly number[], opacity = 1.0): number {
    const toInt32 = (v: readonly number[]): number => {
      switch (v.length) {
        case 3:
          return SP_RGBA32_F_COMPOSE(v[0]!, v[1]!, v[2]!, opacity);
        case 4:
          return SP_RGBA32_F_COMPOSE(v[0]!, v[1]!, v[2]!, opacity * v[3]!);
        default:
          throw new ColorError('Color values should be size 3 for RGB or 4 for RGBA.');
      }
    };
    // We will always output sRGB for RGBA integers
    if (this.getType() === SpaceType.RGB) {
      return toInt32(values);
    }
    const copy = [...values];
    // The target space is sRGB, which has no conversion from its profile.
    if (
      this.spaceToProfile(copy) &&
      this.profileToProfile(copy, Profile.createSrgb(), RenderingIntent.PERCEPTUAL)
    ) {
      return toInt32(copy);
    }
    throw new ColorError("Couldn't convert color space to sRGB.");
  }

  /** Return true if this color would be considered over-inked. */
  overInk(_input: readonly number[]): boolean {
    return false;
  }

  /**
   * Return true if the color would be out of gamut in the target color space.
   *
   * NOTE: This can NOT work if the base color spaces are exactly the same. i.e. device-cmyk(sRGB)
   * will always return false despite not being reversible with RGB (which is also sRGB).
   *
   * Upstream asks lcms2 whether the color survives the conversion between the profiles. Here
   * the color is converted and its channels checked against the bounds of the target space.
   *
   * @arg input - Channel values in this space.
   * @arg toSpace - The target space to compare against.
   */
  outOfGamut(input: readonly number[], toSpace: AnySpace): boolean {
    if (toSpace.getProfile() === this.getProfile()) return false;
    const copy = [...input];
    if (!this.convert(copy, toSpace)) return false;
    if (toSpace.isUnbounded()) return false;
    const n = toSpace.getComponentCount();
    return copy.slice(0, n).some((v) => v < -0.0001 || v > 1.0001);
  }
}

/**
 * A space with a profile, whose channels are the channels of the profile (`isDirect()`), for
 * example sRGB. See ConvertableSpace for the others.
 */
export abstract class ProfileSpace extends AnySpace {
  protected constructor(
    type: SpaceType,
    channels: number,
    name: string,
    shortName: string,
    icon: string,
    spaceIsUnbounded = false,
  ) {
    super(type, channels, name, shortName, icon, spaceIsUnbounded);
  }

  isDirect(): boolean {
    return true;
  }

  spaceToProfile(_io: number[]): boolean {
    return true;
  }

  profileToSpace(_io: number[]): boolean {
    return true;
  }

  profileToProfile(io: number[], toProfile: Profile, _intent: RenderingIntent): boolean {
    return Profile.convert(io, this.getProfile(), toProfile);
  }
}

/** The converters and channel counts of a ConvertableSpace. */
export interface ChannelConversion {
  /** The channels of the space. */
  readonly OutputChannels: number;
  /** The channels of the profile. */
  readonly ProfileChannels: number;
  readonly spaceToProfile: ChannelConverter;
  readonly profileToSpace: ChannelConverter;
}

/**
 * A space that is converted to and from the channels of its profile by code, for example HSL
 * (profile sRGB). An extra opacity channel is kept at the end.
 */
export abstract class ConvertableSpace extends ProfileSpace {
  readonly #target: ChannelConversion;

  protected constructor(
    type: SpaceType,
    name: string,
    shortName: string,
    icon: string,
    target: ChannelConversion,
    spaceIsUnbounded = false,
  ) {
    super(type, target.OutputChannels, name, shortName, icon, spaceIsUnbounded);
    this.#target = target;
  }

  override isDirect(): boolean {
    return false;
  }

  override spaceToProfile(io: number[]): boolean {
    const t = this.#target;
    const hasAlpha = io.length === t.OutputChannels + 1;
    if (t.OutputChannels < t.ProfileChannels) {
      while (io.length - Number(hasAlpha) < t.ProfileChannels) {
        io.splice(io.length - Number(hasAlpha), 0, 0.0);
      }
    }
    t.spaceToProfile(io, io);
    if (t.OutputChannels > t.ProfileChannels) {
      io.splice(t.ProfileChannels, io.length - Number(hasAlpha) - t.ProfileChannels);
    }
    return true;
  }

  override profileToSpace(io: number[]): boolean {
    const t = this.#target;
    const hasAlpha = io.length === t.ProfileChannels + 1;
    if (t.ProfileChannels < t.OutputChannels) {
      while (io.length - Number(hasAlpha) < t.OutputChannels) {
        io.splice(io.length - Number(hasAlpha), 0, 0.0);
      }
    }
    t.profileToSpace(io, io);
    if (t.ProfileChannels > t.OutputChannels) {
      io.splice(t.OutputChannels, io.length - Number(hasAlpha) - t.OutputChannels);
    }
    return true;
  }
}
