// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/color.cpp, src/colors/color.h
/*
 * Author:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 AUTHORS
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { ColorError } from './forward.ts';
import { Manager } from './manager.ts';
import { Parsers } from './parser.ts';
import type { AnySpace } from './spaces/base.ts';
import { SpaceType } from './spaces/enum.ts';
import { rgba_to_values } from './utils.ts';

export { ColorError };

/**
 * A color: a color space and the value of each channel in that space, usually between 0.0
 * and 1.0, with an optional extra value for the opacity. Like upstream, the methods named
 * `set`, `convert`, `normalize`, `invert`, `compose`, `average` and `jitter` change the color;
 * `clone()`, `converted()`, `normalized()`, `composed()` and `averaged()` return a new color.
 */
export class Color {
  static readonly EPSILON = 1e-4;

  #name = '';
  #values: number[];
  #space: AnySpace;

  /**
   * Create a color, given the space (or the type of the space) and the values to store.
   *
   * @arg space - The color space these channel values exist in.
   * @arg values - Each channel in the color space must have a value between 0.0 and 1.0
   *               an extra value may be appended to indicate the opacity to support CSS
   *               formatted opacity parsing but is not expected to be written by Inkscape
   *               when being generated. The array is kept, not copied.
   */
  constructor(space: AnySpace | SpaceType, values: number[]);
  /** Compatibility layer for making blind RGB colors from a number 0xRRGGBBAA. */
  constructor(rgba: number, alpha?: boolean);
  constructor(a: AnySpace | SpaceType, b: number[] | boolean = true) {
    let space: AnySpace | undefined;
    let values: number[];
    if (typeof a === 'number' && !Array.isArray(b)) {
      space = Manager.get().find(SpaceType.RGB);
      values = rgba_to_values(a, b);
    } else {
      space = typeof a === 'number' ? Manager.get().find(a) : a;
      values = b as number[];
    }
    if (!space) throw new ColorError('No such color space.');
    if (!space.isValidData(values))
      throw new ColorError('Invalid number of color values for the color space.');
    this.#space = space;
    this.#values = values;
  }

  /** A copy of this color. */
  clone(): Color {
    const copy = new Color(this.#space, [...this.#values]);
    copy.#name = this.#name;
    return copy;
  }

  /** Create an optional color, if possible, from the given string. */
  static parse(value: string | null | undefined): Color | undefined {
    if (value === null || value === undefined) return undefined;
    const parsed = Parsers.get().parse(value);
    // Couldn't be parsed as a color at all
    if (!parsed) return undefined;
    // TODO: icc-color needs CMS spaces of the document (see spaces/cms.ts), they are not found here.
    return Color.ifValid(parsed.type, parsed.values);
  }

  /** Construct a color from the space type and values, if the values are valid */
  static ifValid(spaceType: SpaceType, values: number[]): Color | undefined {
    const space = Manager.get().find(spaceType);
    if (space?.isValidData(values)) {
      return new Color(space, values);
    }
    // Invalid color data, return undefined
    return undefined;
  }

  /**
   * Return true if the two colors are the same.
   *
   * The color space AND the values must be the same. But the name doesn't not
   * have to be the same in both colors.
   */
  equals(other: Color): boolean {
    // TODO: Adjust epsilon value to ignore roundtrip conversion rounding errors,
    // but still keep high precision of color comparison.
    //
    // I arrived at this value empirically. If it is too big, then sometimes changes (by the user) are not picked up,
    // and no refresh happens. If it is too small, then roundtrip conversions will also trigger changes, while they ideally should not.
    // It's all a bit fragile.
    return this.#space === other.#space && this.#isnear(other.#values, 0.00001);
  }

  getSpace(): AnySpace {
    return this.#space;
  }

  getValues(): readonly number[] {
    return this.#values;
  }

  size(): number {
    return this.#values.length;
  }

  /**
   * Get a single channel from this color. The opacity channel is 1.0 if the color has no opacity.
   */
  get(index: number): number {
    if (index > this.getOpacityChannel()) throw new RangeError('No such color channel.');
    return this.#values[index] ?? 1.0;
  }

  /**
   * Set the channels directly without checking if the space is correct.
   *
   * @arg values - A vector of doubles, one value between 0.0 and 1.0 for
   *               each channel. An extra channel can be included for opacity.
   */
  setValues(values: number[]): void {
    this.#name = '';
    this.#values = values;
    if (!this.#space.isValidData(values))
      throw new ColorError('Invalid number of color values for the color space.');
  }

  /**
   * Set a specific channel in the color.
   *
   * @arg index - The channel/component index to set
   * @arg value - The new value to set it to.
   *
   * @returns true if the new value if different from the old value
   */
  set(index: number, value: number): boolean;
  /**
   * Set this color to the values from another color.
   *
   * @arg other - The other color which is a source for the values.
   * @arg keepSpace - If true, this color's color-space will stay the same
   *                  and the new values will be converted. This includes
   *                  discarding opacity if this color didn't have opacity.
   *
   * @returns true if the new value if different from the old value
   */
  set(other: Color, keepSpace?: boolean): boolean;
  /**
   * Set this color by parsing the given string. If there's a parser error
   * it will not change the existing color.
   *
   * @arg parsable - A string with a typical css color value.
   * @arg keepSpace - If true, the existing space will stay the same (see the Color overload)
   *
   * @returns true if the new value if different from the old value
   */
  set(parsable: string, keepSpace?: boolean): boolean;
  /**
   * Set this color from an RGBA unsigned int.
   *
   * @arg rgba - The RGBA color encoded as a single unsigned integer, 8bpc
   * @arg opacity - True if the opacity (Alpha) should be stored too.
   *
   * @returns true if the new value if different from the old value
   */
  set(rgba: number, opacity?: boolean): boolean;
  set(a: number | Color | string, b: number | boolean = true): boolean {
    if (a instanceof Color) return this.#setColor(a, b as boolean);
    if (typeof a === 'string') {
      const color = Color.parse(a);
      return color ? this.#setColor(color, b as boolean) : false;
    }
    if (typeof b === 'number') return this.#setChannel(a, b);
    return this.#setRGBA(a, b);
  }

  #setChannel(index: number, value: number): boolean {
    if (index > this.getOpacityChannel()) throw new RangeError('No such color channel.');
    if (index === this.#values.length) {
      this.#values.push(1.0);
    }
    const changed = Math.abs(this.#values[index]! - value) >= 0.001;
    this.#values[index] = value;
    return changed;
  }

  #setColor(other: Color, keepSpace: boolean): boolean {
    if (keepSpace) {
      const prevSpace = this.#space;
      const prevValues = [...this.#values];
      const prevOpacity = this.hasOpacity();

      if (this.#setColor(other, false)) {
        // Convert back to the previous space if needed.
        this.convert(prevSpace);
        this.enableOpacity(prevOpacity);
        // Return true if the converted result is different
        return !this.#isnear(prevValues);
      }
    } else if (!this.equals(other)) {
      this.#space = other.#space;
      this.#values = [...other.#values];
      this.#name = other.#name;
      return true;
    }
    return false;
  }

  #setRGBA(rgba: number, opacity: boolean): boolean {
    if (this.#space.getType() !== SpaceType.RGB) {
      // Ensure we are in RGB
      this.#space = Manager.get().find(SpaceType.RGB)!;
    } else if (rgba >>> 0 === this.toRGBA(opacity ? 1.0 : 0.0)) {
      return false; // nothing to do.
    }
    this.#name = '';
    this.#values = rgba_to_values(rgba, opacity);
    return true;
  }

  /** Returns true if the values are near to the other values */
  #isnear(other: readonly number[], epsilon = 0.001): boolean {
    return (
      this.#values.length === other.length && this.#values.every((v, i) => Math.abs(v - other[i]!) < epsilon)
    );
  }

  /** Returns true if there is an opacity channel in this color. */
  hasOpacity(): boolean {
    return this.#values.length > this.getOpacityChannel();
  }

  /** Enables or disables the opacity channel. */
  enableOpacity(enable: boolean): void {
    const hasOpacity = this.hasOpacity();
    if (enable && !hasOpacity) {
      this.#values.push(1.0);
    } else if (!enable && hasOpacity) {
      this.#values.pop();
    }
  }

  /** Get the opacity channel index */
  getOpacityChannel(): number {
    return this.#space.getComponentCount();
  }

  /**
   * Get the opacity in this color, if it's stored. Returns 1.0 if no
   * opacity exists in this color.
   */
  getOpacity(): number {
    return this.hasOpacity() ? this.#values[this.#values.length - 1]! : 1.0;
  }

  /**
   * Get the opacity, and remove it from this color. This is useful when setting a color
   * into an svg css property that has it's own opacity property but you aren't ready to
   * create a string (see toString(false) for that use)
   */
  stealOpacity(): number {
    const ret = this.getOpacity();
    this.enableOpacity(false);
    return ret;
  }

  /** Set the opacity of this color object. Returns true if it changed. */
  setOpacity(opacity: number): boolean {
    if (this.hasOpacity()) {
      if (opacity === this.#values[this.#values.length - 1]) {
        return false;
      }
      this.#values[this.#values.length - 1] = opacity;
    } else {
      this.#values.push(opacity);
    }
    return true;
  }

  /** Multiply the opacity of this color by `opacity`. */
  addOpacity(opacity = 1.0): boolean {
    return this.setOpacity(opacity * this.getOpacity());
  }

  /** Make a copy and add the given opacity on top. */
  withOpacity(opacity: number): Color {
    const copy = this.clone();
    copy.addOpacity(opacity);
    return copy;
  }

  /**
   * Return the pin number (pow2) of the channel index to pin
   * that channel in a mutation.
   */
  getPin(channel: number): number {
    return 1 << channel;
  }

  /**
   * Get the mean square difference between this color and another.
   */
  difference(other: Color): number {
    let ret = 0.0;
    const copy = other.converted(this);
    if (copy) {
      for (let i = 0; i < this.#values.length; i++) {
        ret += (this.#values[i]! - copy.get(i)) ** 2;
      }
    }
    return ret;
  }

  /**
   * Find out if a color is a close match to another color of the same type.
   *
   * @returns true if the colors are the same structure (space, opacity)
   *          and have values which are no more than epison apart.
   */
  isClose(other: Color, epsilon = Color.EPSILON): boolean {
    return (
      this.#space === other.#space &&
      this.#values.length === other.#values.length &&
      this.#values.every((v, i) => Math.abs(v - other.#values[i]!) < epsilon)
    );
  }

  /**
   * Find out if a color is similar to another color, converting it
   * first if it's a different type. If one has opacity and the other does not
   * it always returns false.
   *
   * @returns true if the colors are similar when converted to the same space.
   */
  isSimilar(other: Color, epsilon = Color.EPSILON): boolean {
    if (other.#space !== this.#space) {
      const copy = other.converted(this.#space);
      if (copy) {
        return this.isClose(copy, epsilon);
      }
      return false; // bad color conversion
    }
    return this.isClose(other, epsilon);
  }

  /**
   * Convert this color into a different color space. A color is also a target: the space and
   * the opacity are copied from it.
   *
   * @arg to - The target space, the type of a space, or a color to copy the space and opacity from.
   *
   * @returns false if the space is not available
   */
  convert(to: Color | AnySpace | SpaceType): boolean {
    if (to instanceof Color) {
      if (this.convert(to.#space)) {
        this.enableOpacity(to.hasOpacity());
        return true;
      }
      return false;
    }
    if (typeof to === 'number') {
      const space = Manager.get().find(to);
      return space ? this.convert(space) : false;
    }
    if (!to.hasValidCmsProfile()) {
      return false;
    }

    if (this.#space !== to) {
      this.#space.convert(this.#values, to);
      this.#space = to;
      if (!this.#space.isValidData(this.#values))
        throw new ColorError('Invalid color data after conversion.');
    }
    this.#name = '';

    return true;
  }

  /**
   * Return a copy of this color converted to the space of `to`, or to a space or a space type;
   * undefined if the space is not available. A color is also a target: the opacity is copied too.
   */
  converted(to: Color | AnySpace | SpaceType): Color | undefined {
    const copy = this.clone();
    return copy.convert(to) ? copy : undefined;
  }

  /**
   * Format the color as a css string and return it.
   *
   * @arg opacity - If set to false the opacity will be ignored, even if present.
   *
   * Note: Choose the color space for your color carefully before printing. If you
   * are outputting to a CSS version that only supports RGB hex codes, then convert
   * the color to that color space before printing.
   */
  toString(opacity = true): string {
    return this.#space.toString(this.#values, opacity);
  }

  /**
   * Return an sRGB conversion of the color in RGBA int32 format (an unsigned number).
   *
   * @args opacity - optional opacity to be mixed into any existing
   *                 opacity in this color.
   */
  toRGBA(opacity = 1.0): number {
    return this.#space.toRGBA(this.#values, opacity);
  }

  /** Return the RGBA int32 as an ARGB format number. */
  toARGB(opacity = 1.0): number {
    const value = this.toRGBA(opacity);
    return ((value >>> 8) | ((value & 0xff) << 24)) >>> 0;
  }

  /** Return the RGBA int32 as an ABGR format color. */
  toABGR(opacity = 1.0): number {
    const value = this.toRGBA(opacity);
    return (
      ((value << 24) | ((value << 8) & 0x00ff0000) | ((value >>> 8) & 0x0000ff00) | (value >>> 24)) >>> 0
    );
  }

  getName(): string {
    return this.#name;
  }

  setName(name: string): void {
    this.#name = name;
  }

  /**
   * Return true if this color would be out of gamut when converted to another space.
   *
   * @arg other - The other color space to compare against.
   */
  isOutOfGamut(other: AnySpace): boolean {
    return this.#space.outOfGamut(this.#values, other);
  }

  /** Return true if this color would be considered over-inked. */
  isOverInked(): boolean {
    return this.#space.overInk(this.#values);
  }

  /** Make sure the values for this color are within acceptable ranges. */
  normalize(): void {
    for (const comp of this.#space.getComponents(this.hasOpacity()).getAll()) {
      this.#values[comp.index] = comp.normalize(this.#values[comp.index]!);
    }
  }

  /** Return a normalized copy of this color so the values are within acceptable ranges. */
  normalized(): Color {
    const copy = this.clone();
    copy.normalize();
    return copy;
  }

  /**
   * Invert the color for each channel.
   *
   * @arg pin - Bit field, which channels should not change if not specified
   *            the opacity pin is used as this is the most reasonable default.
   */
  invert(pin: number = this.getPin(this.getOpacityChannel())): void {
    for (let i = 0; i < this.#values.length; i++) {
      if (pin & (1 << i)) continue;
      this.#values[i] = 1.0 - this.#values[i]!;
    }
  }

  /**
   * Jitter the color for each channel.
   *
   * @arg force - The amount of jitter to add to each channel.
   * @arg pin   - Bit field, which channels should not change (see invert).
   */
  jitter(force: number, pin = 0): void {
    for (let i = 0; i < this.#values.length; i++) {
      if (pin & (1 << i)) continue;
      // Random number between -0.5 and 0.5 times the force.
      const r = Math.random() - 0.5;
      this.#values[i] = this.#values[i]! + r * force;
    }
    this.normalize();
  }

  /**
   * Put the other color on top of this color, mixing the two according to the alpha.
   *
   * @arg other - The other color to compose with this one.
   */
  compose(other: Color): void {
    const alpha = other.getOpacity();
    this.#mutate(
      other,
      this.getPin(this.getOpacityChannel()),
      (value, otherValue) => value * (1.0 - alpha) + otherValue * alpha,
    );
    this.setOpacity(1.0 - (1.0 - this.getOpacity()) * (1.0 - alpha));
  }

  /**
   * Return the composition of this color, plus the other color on top.
   *
   * @arg other - The other color to compose with this one.
   */
  composed(other: Color): Color {
    const copy = this.clone();
    copy.compose(other);
    return copy;
  }

  /**
   * Modify this color to be the average between two colors, modifying the first.
   *
   * @arg other  - The other color to average with
   * @arg pos    - The position (i.e. t) between the two colors.
   * @pin pin    - Bit field, which channels should not change (see invert)
   */
  average(other: Color, pos = 0.5, pin = 0): void {
    this.#mutate(other, pin, (value, otherValue) => value * (1 - pos) + otherValue * pos);
  }

  /**
   * Return the average between this and another color.
   *
   * @arg other - The other color to average with
   * @arg pos - The weighting to give each color
   */
  averaged(other: Color, pos = 0.5): Color {
    const copy = this.clone();
    copy.average(other, pos);
    return copy;
  }

  /** Color-color in-place modification. */
  #mutate(other: Color, pin: number, func: (value: number, otherValue: number) => number): void {
    // Convert the other's space and opacity if it's different
    if (other.#space !== this.#space || other.hasOpacity() !== this.hasOpacity()) {
      const copy = other.converted(this);
      if (copy) {
        this.#mutate(copy, pin, func);
      }
      return; // Bad conversion
    }

    // Both are good, so average each channel
    for (let i = 0; i < this.#values.length; i++) {
      if (pin & (1 << i)) continue;
      this.#values[i] = func(this.#values[i]!, other.get(i));
    }
  }
}
