// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/gray.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { SpaceType } from './enum.ts';
import { RGBBase } from './rgb.ts';

export class Gray extends RGBBase {
  static readonly OutputChannels = 1;
  static readonly ProfileChannels = 3;

  constructor() {
    super(SpaceType.Gray, 'Gray', 'Gray', 'color-selector-gray', Gray);
  }

  /**
   * Convert a single gray channel into an RGB
   */
  static spaceToProfile(i: ArrayLike<number>, o: number[]): void {
    const v = i[0]!;
    o[0] = v;
    o[1] = v;
    o[2] = v;
  }

  /**
   * Convert an RGB into a gray channel using the HSL method
   */
  static profileToSpace(i: ArrayLike<number>, o: number[]): void {
    const max = Math.max(Math.max(i[0]!, i[1]!), i[2]!);
    const min = Math.min(Math.min(i[0]!, i[1]!), i[2]!);
    o[0] = (max + min) / 2.0; // Based on HSL conversion
  }

  toString(_values: readonly number[], _opacity = true): string {
    return '';
  }
}
