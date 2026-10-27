// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/okhsv.h
/*
 * Authors:
 *   Mike Kowalski
 *
 * Copyright (C) 2025 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { SpaceType } from './enum.ts';
import { okhsv_to_srgb, srgb_to_okhsv } from './ok-color.ts';
import { RGBBase } from './rgb.ts';

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0.0), 1.0);
}

export class OkHsv extends RGBBase {
  static readonly ProfileChannels = 3;
  static readonly OutputChannels = 3;

  constructor() {
    super(SpaceType.OKHSV, 'OkHsv', 'OkHsv', 'color-selector-okhsv', OkHsv);
  }

  toString(_values: readonly number[], _opacity = true): string {
    return '';
  }

  static spaceToProfile(i: ArrayLike<number>, o: number[]): void {
    const rgb = okhsv_to_srgb({ h: clamp01(i[0]!), s: clamp01(i[1]!), v: clamp01(i[2]!) });
    o[0] = rgb.r;
    o[1] = rgb.g;
    o[2] = rgb.b;
  }

  static profileToSpace(i: ArrayLike<number>, o: number[]): void {
    const hsv = srgb_to_okhsv({ r: i[0]!, g: i[1]!, b: i[2]! });
    o[0] = hsv.h;
    o[1] = hsv.s;
    o[2] = hsv.v;
  }
}
