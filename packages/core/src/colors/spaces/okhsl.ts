// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/okhsl.h
/*
 * Authors:
 *   Rafał Siejakowski <rs@rs-math.net>
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Angle } from '@inkscape-web/geom';
import { SpaceType } from './enum.ts';
import { LinearRGB } from './linear-rgb.ts';
import { OkLab } from './oklab.ts';
import { OkLch } from './oklch.ts';
import { RGBBase } from './rgb.ts';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export class OkHsl extends RGBBase {
  static readonly ProfileChannels = 3;
  static readonly OutputChannels = 3;

  constructor() {
    super(SpaceType.OKHSL, 'OkHsl', 'OkHsl', 'color-selector-okhsl', OkHsl, true);
  }

  static spaceToProfile(i: ArrayLike<number>, o: number[]): void {
    const h = i[0]!;
    const s = i[1]!;
    const l = clamp(i[2]!, 0.0, 1.0);

    // Get max chroma for this hue and lightness and compute the absolute chroma.
    const chromax = OkLch.max_chroma(l, h * 360.0);
    const absolute_chroma = s * chromax;

    // Convert hue and chroma to the Cartesian a, b coordinates.
    const b = Math.sin(h * 2.0 * Math.PI);
    const a = Math.cos(h * 2.0 * Math.PI);

    o[0] = l;
    o[1] = a * absolute_chroma;
    o[2] = b * absolute_chroma;

    OkLab.toLinearRGB(o, o);
    LinearRGB.toRGB(o, o);
  }

  static profileToSpace(i: ArrayLike<number>, o: number[]): void {
    LinearRGB.fromRGB(i, o);
    OkLab.fromLinearRGB(o, o);

    // Compute the chroma.
    const absolute_chroma = Math.hypot(o[1]!, o[2]!);

    if (absolute_chroma < 1e-7) {
      // It would be numerically unstable to calculate the hue for this
      // color, so we set the hue and saturation to zero (grayscale color).
      o[2] = o[0]!;
      o[1] = 0.0;
      o[0] = 0.0;
    } else {
      // Compute the hue (in the unit interval).
      const hue_angle = new Angle(Math.atan2(o[2]!, o[1]!));
      o[2] = clamp(o[0]!, 0.0, 1.0);
      o[0] = hue_angle.radians0() / (2.0 * Math.PI);

      // Compute the linear saturation.
      const hue_degrees = hue_angle.radians0() * (180 / Math.PI);
      const chromax = OkLch.max_chroma(o[2], hue_degrees);
      o[1] = chromax === 0.0 ? 0.0 : clamp(absolute_chroma / chromax, 0.0, 1.0);
    }
  }

  toString(_values: readonly number[], _opacity = true): string {
    return '';
  }
}
