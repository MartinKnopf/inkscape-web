// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/manager.cpp, src/colors/manager.h, src/colors/parser.cpp
/*
 * Manager - Look after all a document's icc profiles.
 *
 * Copyright 2023 Martin Owens <doctormo@geek-2.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { ColorError } from './forward.ts';
import { CssParser, HexParser, Parsers } from './parser.ts';
import { Alpha } from './spaces/alpha.ts';
import type { AnySpace } from './spaces/base.ts';
import { CMS } from './spaces/cms.ts';
import { DeviceCMYK } from './spaces/cmyk.ts';
import { Traits } from './spaces/components.ts';
import { SpaceType } from './spaces/enum.ts';
import { Gray } from './spaces/gray.ts';
import { HSL } from './spaces/hsl.ts';
import { HSLuv } from './spaces/hsluv.ts';
import { HSV } from './spaces/hsv.ts';
import { Lab } from './spaces/lab.ts';
import { Lch } from './spaces/lch.ts';
import { LinearRGB } from './spaces/linear-rgb.ts';
import { Luv } from './spaces/luv.ts';
import { NamedColor } from './spaces/named.ts';
import { OkHsl } from './spaces/okhsl.ts';
import { OkHsv } from './spaces/okhsv.ts';
import { OkLab } from './spaces/oklab.ts';
import { OkLch } from './spaces/oklch.ts';
import { RGB } from './spaces/rgb.ts';
import { XYZ, XYZ50 } from './spaces/xyz.ts';

// The parsers of all color spaces. Upstream adds them in the constructor of Parsers
// (parser.cpp); here they are added when this file loads, so parser.ts needs no color spaces.
{
  const parsers = Parsers.get();
  parsers.addParser(new HexParser());
  parsers.addParser(new NamedColor.NameParser());
  parsers.addParser(new CMS.CmsParser());
  parsers.addParser(new RGB.Parser(false));
  parsers.addParser(new RGB.Parser(true));
  parsers.addParser(new HSL.Parser(false));
  parsers.addParser(new HSL.Parser(true));
  parsers.addParser(new HSV.fromHwbParser(false));
  parsers.addParser(new HSV.fromHwbParser(true));
  parsers.addParser(new Lab.Parser());
  parsers.addParser(new Lch.Parser());
  parsers.addParser(new OkLab.Parser());
  parsers.addParser(new OkLch.Parser());
  parsers.addParser(new CssParser('srgb', SpaceType.RGB, 3));
  parsers.addParser(new CssParser('srgb-linear', SpaceType.linearRGB, 3));
  parsers.addParser(new CssParser('device-cmyk', SpaceType.CMYK, 4));
  parsers.addParser(new CssParser('xyz', SpaceType.XYZ, 3));
  parsers.addParser(new CssParser('xyz-d65', SpaceType.XYZ, 3));
  parsers.addParser(new CssParser('xyz-d50', SpaceType.XYZ50, 3));
}

/** The registry of the color spaces, there is one instance of each space. */
export class Manager {
  static #instance?: Manager;

  readonly #spaces: AnySpace[] = [];
  // Case insensitive: keys are lower case.
  readonly #svg_names_lookup = new Map<string, AnySpace>();

  private constructor() {
    // Regular SVG 1.1 Colors
    this.addSpace(new RGB());
    this.addSpace(new NamedColor());

    // Color module 4 and 5 support
    this.addSpace(new DeviceCMYK());
    this.addSpace(new Gray());
    this.addSpace(new HSL());
    this.addSpace(new HSLuv());
    this.addSpace(new HSV());
    this.addSpace(new Lab());
    this.addSpace(new LinearRGB());
    this.addSpace(new Lch());
    this.addSpace(new Luv());
    this.addSpace(new OkHsl());
    this.addSpace(new OkHsv());
    this.addSpace(new OkLab());
    this.addSpace(new OkLch());
    this.addSpace(new XYZ());
    this.addSpace(new XYZ50());

    // Image rendering spaces
    this.addSpace(new Alpha());
  }

  static get(): Manager {
    Manager.#instance ??= new Manager();
    return Manager.#instance;
  }

  /** Add a color space. Meant for the CMS spaces of documents. */
  addSpace(space: AnySpace): AnySpace {
    if (this.find(space.getType())) {
      throw new ColorError('Can not add the same color space twice.');
    }
    this.#spaces.push(space);
    for (const match of space.getSvgNames()) {
      if (this.#svg_names_lookup.has(match.toLowerCase())) {
        throw new ColorError('Can not add the same svg attribute name twice.');
      }
      this.#svg_names_lookup.set(match.toLowerCase(), space);
    }
    return space;
  }

  removeSpace(space: AnySpace): boolean {
    for (const [key, value] of this.#svg_names_lookup) {
      if (value === space) this.#svg_names_lookup.delete(key);
    }
    const index = this.#spaces.indexOf(space);
    if (index === -1) return false;
    this.#spaces.splice(index, 1);
    return true;
  }

  /** Request all color spaces with given trait(s); Ex: spaces(Traits.Picker) to list of types suitable for GUI */
  spaces(traits: Traits): AnySpace[] {
    return this.#spaces.filter((p) => (p.getComponents().traits() & traits) !== Traits.None);
  }

  /** The first color space of the given type, or of the given name. */
  find(type: SpaceType | string): AnySpace | undefined {
    if (typeof type === 'string') {
      return this.#spaces.find((v) => v.getName() === type);
    }
    return this.#spaces.find((v) => v.getType() === type);
  }

  /** The color space for a name used in svg, for example "srgb-linear", or "hsl". */
  findSvgColorSpace(input: string): AnySpace | undefined {
    return this.#svg_names_lookup.get(input.toLowerCase());
  }
}
