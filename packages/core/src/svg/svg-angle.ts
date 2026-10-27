// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/svg-angle.cpp, src/svg/svg-angle.h
/*
 * SVG angle type
 *
 * Authors:
 *   Tomasz Boczkowski <penginsbacon@gmail.com>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { convertUnit, DEG, readNumberPrefix } from './svg-length.ts';

export enum SVGAngleUnit {
  NONE,
  DEG,
  GRAD,
  RAD,
  TURN,
  LAST_UNIT = TURN,
}

interface ParsedAngle {
  unit: SVGAngleUnit;
  value: number;
  computed: number;
}

/** Upstream: sp_svg_angle_read_lff (static) */
function readAngle(str: string): ParsedAngle | null {
  const num = readNumberPrefix(str);
  if (!num) return null;
  const { value: v, rest: e } = num;
  const unitless = { unit: SVGAngleUnit.NONE, value: v, computed: v };
  if (e === '') return unitless; // Unitless (defaults to degrees)
  if (!/^[0-9a-zA-Z]/.test(e)) {
    // spaces between value and unit are not allowed
    if (/^[ \t\n\v\f\r][a-zA-Z]/.test(e)) return null;
    return unitless;
  }
  // Like upstream, only the start of the rest is compared: "degrees" reads as "deg".
  if (e.startsWith('deg')) return { unit: SVGAngleUnit.DEG, value: v, computed: v };
  if (e.startsWith('grad'))
    return { unit: SVGAngleUnit.GRAD, value: v, computed: convertUnit(v, 'grad', DEG) };
  if (e.startsWith('rad')) return { unit: SVGAngleUnit.RAD, value: v, computed: convertUnit(v, 'rad', DEG) };
  if (e.startsWith('turn'))
    return { unit: SVGAngleUnit.TURN, value: v, computed: convertUnit(v, 'turn', DEG) };
  return null;
}

/** SVG angle type */
export class SVGAngle {
  /** The object's value is valid / exists in SVG. */
  _set = false;
  /** The unit of value. */
  unit = SVGAngleUnit.NONE;
  /** The value of this SVGAngle as found in the SVG. */
  value = 0;
  /** The value in degrees. */
  computed = 0;

  /** Upstream: SVGAngle::operator= (double). Sets a unitless value. */
  assign(v: number): number {
    this._set = true;
    this.unit = SVGAngleUnit.NONE;
    this.value = this.computed = v;
    return v;
  }

  read(str: string | null | undefined): boolean {
    if (str == null) return false;
    const a = readAngle(str);
    if (!a) return false;
    this._set = true;
    this.unit = a.unit;
    this.value = a.value;
    this.computed = a.computed;
    return true;
  }

  unset(u = SVGAngleUnit.NONE, v = 0, c = 0): void {
    this._set = false;
    this.unit = u;
    this.value = v;
    this.computed = c;
  }

  readOrUnset(str: string | null | undefined, u = SVGAngleUnit.NONE, v = 0, c = 0): void {
    if (!this.read(str)) this.unset(u, v, c);
  }
}
