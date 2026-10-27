// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/components.cpp, src/colors/spaces/components.h
/*
 * Authors:
 *   Jon A. Cruz <jon@joncruz.org>
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2013-2023 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { _, C_ } from '../../i18n.ts';
import { SpaceType } from './enum.ts';

/** Bit flags (upstream Space::Traits). */
export enum Traits {
  None = 0,
  Picker = 1, // show color picker of this type in UI
  Internal = 2, // internal use only, has converters and tests, or is supported by CSS toString
  CMS = 4, // CMS use only, no conversion math available
}

/** Unit impacts component presentation in the UI and dictates what its scale is. */
export enum Unit {
  EightBit, // one byte, values from 0..255, unitless
  Percent, // 0..100%
  Degree, // 0..360 degree
  Linear1024, // 0..1024 for linear RGB
  Chroma40, // an oddball 0..40 for OkLch hue encoding
}

function unitScale(unit: Unit): number {
  switch (unit) {
    case Unit.EightBit:
      return 255;
    case Unit.Degree:
      return 360;
    case Unit.Percent:
      return 100;
    case Unit.Linear1024:
      return 1024;
    case Unit.Chroma40:
      return 40;
  }
}

/** One channel of a color space. */
export class Component {
  readonly scale: number;

  constructor(
    public type: SpaceType,
    public index: number,
    public id: string,
    public name: string,
    public tip: string,
    public unit: Unit = Unit.EightBit,
  ) {
    this.scale = unitScale(unit);
  }

  /**
   * Clamp the value to between 0.0 and 1.0, except for hue which is wrapped around.
   */
  normalize(value: number): number {
    if (this.unit === Unit.Degree && (value < 0.0 || value > 1.0)) {
      return value - Math.floor(value);
    }
    return Math.min(Math.max(value, 0.0), 1.0);
  }
}

/** The channels of a color space, with the color wheel type and traits of the space. */
export class Components {
  readonly #components: Component[];
  #type: SpaceType;
  #wheelType: SpaceType;
  readonly #traits: Traits;

  constructor(
    type = SpaceType.NONE,
    wheel = SpaceType.NONE,
    traits = Traits.None,
    components: Component[] = [],
  ) {
    this.#type = type;
    this.#wheelType = wheel;
    this.#traits = traits;
    this.#components = components;
  }

  static get(type: SpaceType, alpha = false): Components {
    const sets = alpha ? Components.#withAlpha() : Components.#noAlpha();
    return sets.get(type) ?? sets.get(SpaceType.NONE)!;
  }

  static #sets: Map<SpaceType, Components> | undefined;
  static #setsAlpha: Map<SpaceType, Components> | undefined;

  static #noAlpha(): Map<SpaceType, Components> {
    Components.#sets ??= Components.#build(false);
    return Components.#sets;
  }
  static #withAlpha(): Map<SpaceType, Components> {
    Components.#setsAlpha ??= Components.#build(true);
    return Components.#setsAlpha;
  }

  static #build(alpha: boolean): Map<SpaceType, Components> {
    const sets = new Map<SpaceType, Components>();
    for (const components of getColorSpaces()) {
      // patch components
      components.#components.forEach((component, index) => {
        component.type = components.#type;
        component.index = index;
      });
      sets.set(components.#type, components);
    }
    if (alpha) {
      for (const val of sets.values()) {
        // alpha component with unique ID, so it doesn't clash with "a" in Lab
        val.add('alpha', C_('Transparency (alpha)', '_A'), _('Alpha'), Unit.Percent);
      }
    }
    return sets;
  }

  getAll(): readonly Component[] {
    return this.#components;
  }

  [Symbol.iterator](): Iterator<Component> {
    return this.#components[Symbol.iterator]();
  }

  at(index: number): Component {
    const c = this.#components[index];
    if (!c) throw new RangeError(`no component ${index}`);
    return c;
  }

  getType(): SpaceType {
    return this.#type;
  }

  get size(): number {
    return this.#components.length;
  }

  add(id: string, name: string, tip: string, unit: Unit = Unit.EightBit): void {
    this.#components.push(new Component(this.#type, this.#components.length, id, name, tip, unit));
  }

  setType(type: SpaceType, colorWheel = SpaceType.NONE): void {
    this.#type = type;
    this.#wheelType = colorWheel;
  }

  /** Says which space the color wheel should be in when picking this color space. */
  get_wheel_type(): SpaceType {
    return this.#wheelType;
  }

  /** Trait(s) of those components. */
  traits(): Traits {
    return this.#traits;
  }
}

type Spec = [id: string, name: string, tip: string, unit?: Unit];

function make(type: SpaceType, wheel: SpaceType, traits: Traits, specs: Spec[]): Components {
  return new Components(
    type,
    wheel,
    traits,
    specs.map(([id, name, tip, unit], i) => new Component(type, i, id, name, tip, unit)),
  );
}

// Built on first use, so that the translations are loaded.
function getColorSpaces(): Components[] {
  const T = SpaceType;
  return [
    make(T.RGB, T.RGB, Traits.Picker, [
      ['r', _('_R'), _('Red'), Unit.EightBit],
      ['g', _('_G'), _('Green'), Unit.EightBit],
      ['b', _('_B'), _('Blue'), Unit.EightBit],
    ]),
    make(T.linearRGB, T.NONE, Traits.Internal, [
      ['r', _('<sub>l</sub>_R'), _('Linear Red'), Unit.EightBit],
      ['g', _('<sub>l</sub>_G'), _('Linear Green'), Unit.EightBit],
      ['b', _('<sub>l</sub>_B'), _('Linear Blue'), Unit.EightBit],
    ]),
    make(T.HSL, T.HSL, Traits.Picker, [
      ['h', _('_H'), _('Hue'), Unit.Degree],
      ['s', _('_S'), _('Saturation'), Unit.Percent],
      ['l', _('_L'), _('Lightness'), Unit.Percent],
    ]),
    make(T.HSV, T.HSV, Traits.Picker, [
      ['h', _('_H'), _('Hue'), Unit.Degree],
      ['s', _('_S'), _('Saturation'), Unit.Percent],
      ['v', _('_V'), _('Value'), Unit.Percent],
    ]),
    make(T.CMYK, T.NONE, Traits.Picker, [
      ['c', _('_C'), C_('CMYK', 'Cyan'), Unit.Percent],
      ['m', _('_M'), C_('CMYK', 'Magenta'), Unit.Percent],
      ['y', _('_Y'), C_('CMYK', 'Yellow'), Unit.Percent],
      ['k', _('_K'), C_('CMYK', 'Black'), Unit.Percent],
    ]),
    make(T.CMY, T.NONE, Traits.Picker, [
      ['c', _('_C'), C_('CMYK', 'Cyan'), Unit.Percent],
      ['m', _('_M'), C_('CMYK', 'Magenta'), Unit.Percent],
      ['y', _('_Y'), C_('CMYK', 'Yellow'), Unit.Percent],
    ]),
    make(T.HSLUV, T.HSLUV, Traits.Picker, [
      ['h', _('_H*'), _('Hue'), Unit.Degree],
      ['s', _('_S*'), _('Saturation'), Unit.Percent],
      ['l', _('_L*'), _('Lightness'), Unit.Percent],
    ]),
    make(T.OKHSL, T.OKHSL, Traits.Picker, [
      ['h', _('_H<sub>ok</sub>'), _('Hue'), Unit.Degree],
      ['s', _('_S<sub>ok</sub>'), _('Saturation'), Unit.Percent],
      ['l', _('_L<sub>ok</sub>'), _('Lightness'), Unit.Percent],
    ]),
    make(T.OKHSV, T.OKHSV, Traits.Internal, [
      ['h', _('_H<sub>ok</sub>'), _('Hue'), Unit.Degree],
      ['s', _('_S<sub>ok</sub>'), _('Saturation'), Unit.Percent],
      ['v', _('_V<sub>ok</sub>'), _('Value'), Unit.Percent],
    ]),
    make(T.LCH, T.NONE, Traits.Internal, [
      ['l', _('_L'), _('Luminance'), Unit.EightBit],
      ['c', _('_C'), _('Chroma'), Unit.EightBit],
      ['h', _('_H'), _('Hue'), Unit.Degree],
    ]),
    make(T.LUV, T.NONE, Traits.Internal, [
      ['l', _('_L'), _('Luminance'), Unit.Percent],
      ['u', _('_U'), _('Chroma U'), Unit.Percent],
      ['v', _('_V'), _('Chroma V'), Unit.Percent],
    ]),
    make(T.OKLAB, T.NONE, Traits.Internal, [
      ['l', _('_L<sub>ok</sub>'), _('Lightness'), Unit.Percent],
      ['a', _('_A<sub>ok</sub>'), _('Component A'), Unit.Percent],
      ['b', _('_B<sub>ok</sub>'), _('Component B'), Unit.Percent],
    ]),
    make(T.OKLCH, T.OKHSL, Traits.Picker, [
      ['l', _('_L<sub>ok</sub>'), _('Lightness'), Unit.Percent],
      ['c', _('_C<sub>ok</sub>'), _('Chroma'), Unit.Chroma40], // 100% is 0.4
      ['h', _('_H<sub>ok</sub>'), _('Hue'), Unit.Degree],
    ]),
    make(T.LAB, T.NONE, Traits.Internal, [
      ['l', _('_L'), _('Lightness'), Unit.Percent],
      ['a', _('_A'), _('Component A'), Unit.EightBit],
      ['b', _('_B'), _('Component B'), Unit.EightBit],
    ]),
    make(T.YCbCr, T.NONE, Traits.CMS, [
      ['y', _('_Y'), _('Y'), Unit.EightBit],
      ['cb', _('C_r'), _('Cb'), Unit.EightBit],
      ['cr', _('C_b'), _('Cr'), Unit.EightBit],
    ]),
    make(T.XYZ, T.NONE, Traits.Internal, [
      ['x', '_X', 'X', Unit.EightBit],
      ['y', '_Y', 'Y', Unit.EightBit],
      ['z', '_Z', 'Z', Unit.EightBit],
    ]),
    make(T.XYZ50, T.NONE, Traits.Internal, [
      ['x', '_X', 'X', Unit.EightBit],
      ['y', '_Y', 'Y', Unit.EightBit],
      ['z', '_Z', 'Z', Unit.EightBit],
    ]),
    make(T.YXY, T.NONE, Traits.Internal, [
      ['y1', '_Y', 'Y', Unit.EightBit],
      ['x', '_x', 'x', Unit.EightBit],
      ['y2', 'y', 'y', Unit.EightBit],
    ]),
    make(T.Gray, T.NONE, Traits.Internal, [['gray', _('G'), _('Gray'), Unit.Linear1024]]),
    make(T.Alpha, T.NONE, Traits.Internal, []),
  ];
}
