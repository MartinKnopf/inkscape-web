// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/xyz.cpp, src/colors/spaces/xyz.h
/*
 * Authors:
 *   2015 Alexei Boronine (original idea, JavaScript implementation)
 *   2015 Roger Tallada (Obj-C implementation)
 *   2017 Martin Mitas (C implementation, based on Obj-C implementation)
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Profile } from '../cms/profile.ts';
import { CssColorPrinter } from '../printer.ts';
import { type ChannelConversion, ConvertableSpace, ProfileSpace } from './base.ts';
import { RenderingIntent, SpaceType } from './enum.ts';

/** A space that is converted to and from XYZ D65 (upstream XYZBase<T>), for example Luv. */
export abstract class XYZBase extends ConvertableSpace {
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
    return Profile.createXyz65();
  }
}

export class XYZ extends ProfileSpace {
  constructor() {
    super(SpaceType.XYZ, 3, 'XYZ', 'XYZ', 'color-selector-xyz', true);
    this._svgNames.push('xyz-d65');
    this._svgNames.push('xyz');
    this._intent = RenderingIntent.RELATIVE_COLORIMETRIC_NOBPC;
    this._intent_priority = 10;
  }

  getProfile(): Profile {
    return Profile.createXyz65();
  }

  toString(values: readonly number[], opacity = true): string {
    const os = new CssColorPrinter(3, 'xyz');
    os.addAll(values);
    if (opacity && values.length === 4) os.add(values[3]!);
    return os.toString();
  }
}

export class XYZ50 extends ProfileSpace {
  constructor() {
    super(SpaceType.XYZ50, 3, 'XYZ D50', 'XYZ D50', 'color-selector-xyz', true);
    this._svgNames.push('xyz-d50');
  }

  getProfile(): Profile {
    return Profile.createXyz50();
  }

  toString(values: readonly number[], opacity = true): string {
    const os = new CssColorPrinter(3, 'xyz-d50');
    os.addAll(values);
    if (opacity && values.length === 4) os.add(values[3]!);
    return os.toString();
  }
}
