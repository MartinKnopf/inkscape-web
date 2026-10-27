// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/hsluv.cpp, src/colors/spaces/hsluv.h
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

import { SpaceType } from './enum.ts';
import { EPSILON, KAPPA, Luv } from './luv.ts';
import { XYZBase } from './xyz.ts';

/** The line `a*x + b*y + c = 0` (upstream Geom::Line::setCoefficients). */
export interface Line {
  a: number;
  b: number;
  c: number;
}

const d65: readonly (readonly number[])[] = [
  [3.2409699419045213, -1.5373831775700935, -0.4986107602930033],
  [-0.9692436362808798, 1.8759675015077206, 0.04155505740717561],
  [0.05563007969699361, -0.20397695888897657, 1.0569715142428786],
];

/**
 * Distance from the origin to the closest of the lines of the RGB gamut at lightness l, on the
 * ray with hue h (degrees).
 */
export function max_chroma_for_lh(l: number, h: number): number {
  let min_len = Number.MAX_VALUE;
  const rad = h * (Math.PI / 180);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  for (const line of HSLuv.get_bounds(l)) {
    // Intersection of the line with the ray from the origin, if it is on the ray.
    const den = line.a * cos + line.b * sin;
    if (den === 0) continue;
    const len = -line.c / den;
    if (len >= 0 && len < min_len) {
      min_len = len;
    }
  }

  return min_len;
}

export class HSLuv extends XYZBase {
  static readonly ProfileChannels = 3;
  static readonly OutputChannels = 3;

  constructor() {
    super(SpaceType.HSLUV, 'HSLuv', 'HSLuv', 'color-selector-hsluv', HSLuv);
  }

  /**
   * Convert a color from the the HSLuv colorspace to the XYZ65 colorspace
   */
  static spaceToProfile(i: ArrayLike<number>, o: number[]): void {
    let h = i[0]! * 360;
    const s = i[1]! * 100;
    const l = i[2]! * 100;
    let c: number;

    /* White and black: disambiguate chroma */
    if (l > 99.9999999 || l < 0.00000001) {
      c = 0.0;
    } else {
      c = (max_chroma_for_lh(l, h) / 100.0) * s;
    }

    /* Grays: disambiguate hue */
    if (s < 0.00000001) {
      h = 0.0;
    }

    const rad = h * (Math.PI / 180);
    const u = Math.cos(rad) * c;
    const v = Math.sin(rad) * c;

    o[0] = l;
    o[1] = u;
    o[2] = v;
    Luv.toXYZ(o, o);
  }

  /**
   * Convert a color from the the XYZ65 colorspace to the HSLuv colorspace
   */
  static profileToSpace(i: ArrayLike<number>, o: number[]): void {
    Luv.fromXYZ(i, o);
    const l = o[0]!;
    const u = o[1]!;
    const v = o[2]!;
    let h: number;
    const c = Math.hypot(u, v);

    /* Grays: disambiguate hue */
    if (c < 0.00000001) {
      h = 0;
    } else {
      h = Math.atan2(v, u) * (180 / Math.PI);
      if (h < 0.0) {
        h += 360.0;
      }
    }

    let s: number;
    /* White and black: disambiguate saturation */
    if (l > 99.9999999 || l < 0.00000001) {
      s = 0.0;
    } else {
      s = (c / max_chroma_for_lh(l, h)) * 100.0;
    }

    o[0] = h / 360;
    o[1] = s / 100;
    o[2] = l / 100;
  }

  toString(_values: readonly number[], _opacity = true): string {
    return '';
  }

  static get_bounds(l: number): Line[] {
    const bounds: Line[] = [];
    const tl = l + 16.0;
    const sub1 = (tl * tl * tl) / 1560896.0;
    const sub2 = sub1 > EPSILON ? sub1 : l / KAPPA;

    for (let channel = 0; channel < 3; channel++) {
      const m1 = d65[channel]![0]!;
      const m2 = d65[channel]![1]!;
      const m3 = d65[channel]![2]!;

      for (let t = 0; t < 2; t++) {
        const top1 = (284517.0 * m1 - 94839.0 * m3) * sub2;
        const top2 = (838422.0 * m3 + 769860.0 * m2 + 731718.0 * m1) * l * sub2 - 769860.0 * t * l;
        const bottom = (632260.0 * m3 - 126452.0 * m2) * sub2 + 126452.0 * t;

        bounds[channel * 2 + t] = { a: top1, b: -bottom, c: top2 };
      }
    }
    return bounds;
  }
}
