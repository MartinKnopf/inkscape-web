// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/luv.cpp, src/colors/spaces/luv.h
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

import { SCALE_DOWN, SCALE_UP } from './base.ts';
import { SpaceType } from './enum.ts';
import { XYZBase } from './xyz.ts';

// CIE LUV constants
export const KAPPA = 903.2962962962963;
export const EPSILON = 0.008856451679035631;

export function y2l(y: number): number {
  if (y <= EPSILON) return y * KAPPA;
  return 116.0 * Math.cbrt(y) - 16.0;
}

export function l2y(l: number): number {
  if (l <= 8.0) {
    return l / KAPPA;
  }
  const x = (l + 16.0) / 116.0;
  return x * x * x;
}

export class Luv extends XYZBase {
  static readonly OutputChannels = 3;
  static readonly ProfileChannels = 3;
  static readonly REF_U = 0.1978300066428368;
  static readonly REF_V = 0.468319994938791;

  // There's no CSS for LUV yet, so we don't know what scales
  // the w3c might choose to use. Our own calculations use these.
  static readonly LUMA_SCALE = 100;
  static readonly MIN_U = -100;
  static readonly MAX_U = 200;
  static readonly MIN_V = -200;
  static readonly MAX_V = 120;

  constructor() {
    super(SpaceType.LUV, 'Luv', 'Luv', 'color-selector-luv', Luv);
  }

  /**
   * Convert a color from the the Luv colorspace to the XYZ colorspace.
   */
  static spaceToProfile(i: ArrayLike<number>, o: number[]): void {
    Luv.scaleUp(i, o);
    Luv.toXYZ(o, o);
  }

  static toXYZ(i: ArrayLike<number>, o: number[]): void {
    const l = i[0]!;
    if (l <= 0.00000001) {
      /* Black would create a divide-by-zero error. */
      o[0] = 0.0;
      o[1] = 0.0;
      o[2] = 0.0;
      return;
    }
    const var_u = i[1]! / (13.0 * l) + Luv.REF_U;
    const var_v = i[2]! / (13.0 * l) + Luv.REF_V;
    const y = l2y(l);
    const x = -(9.0 * y * var_u) / ((var_u - 4.0) * var_v - var_u * var_v);
    const z = (9.0 * y - 15.0 * var_v * y - var_v * x) / (3.0 * var_v);
    o[0] = x;
    o[1] = y;
    o[2] = z;
  }

  /**
   * Convert a color from the the XYZ colorspace to the Luv colorspace.
   */
  static profileToSpace(i: ArrayLike<number>, o: number[]): void {
    Luv.fromXYZ(i, o);
    Luv.scaleDown(o, o);
  }

  static fromXYZ(i: ArrayLike<number>, o: number[]): void {
    const denominator = i[0]! + 15.0 * i[1]! + 3.0 * i[2]!;
    const var_u = (4.0 * i[0]!) / denominator;
    const var_v = (9.0 * i[1]!) / denominator;
    const l = y2l(i[1]!);
    const u = 13.0 * l * (var_u - Luv.REF_U);
    const v = 13.0 * l * (var_v - Luv.REF_V);

    o[0] = l;
    if (l < 0.00000001) {
      o[1] = 0.0;
      o[2] = 0.0;
    } else {
      o[1] = u;
      o[2] = v;
    }
  }

  static scaleUp(i: ArrayLike<number>, o: number[]): void {
    o[0] = SCALE_UP(i[0]!, 0, Luv.LUMA_SCALE);
    o[1] = SCALE_UP(i[1]!, Luv.MIN_U, Luv.MAX_U);
    o[2] = SCALE_UP(i[2]!, Luv.MIN_V, Luv.MAX_V);
  }

  static scaleDown(i: ArrayLike<number>, o: number[]): void {
    o[0] = SCALE_DOWN(i[0]!, 0, Luv.LUMA_SCALE);
    o[1] = SCALE_DOWN(i[1]!, Luv.MIN_U, Luv.MAX_U);
    o[2] = SCALE_DOWN(i[2]!, Luv.MIN_V, Luv.MAX_V);
  }

  static fromCoordinates(input: readonly number[]): number[] {
    const out = [...input];
    Luv.scaleDown(input, out);
    return out;
  }

  static toCoordinates(input: readonly number[]): number[] {
    const out = [...input];
    Luv.scaleUp(input, out);
    return out;
  }

  toString(_values: readonly number[], _opacity = true): string {
    return '';
  }
}
