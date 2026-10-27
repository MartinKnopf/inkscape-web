// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/coord.h, src/3rdparty/2geom/src/2geom/coord.cpp
/*
 * Authors:
 *   Nathan Hurst <njh@mail.csse.monash.edu.au>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2006-2015 Authors
 *
 * Number formatting in coord.cpp follows the output of double-conversion:
 * https://code.google.com/p/double-conversion/
 * Copyright 2010 the V8 project authors. All rights reserved.
 */

/** A coordinate value. */
export type Coord = number;

/** Dimension index: X = 0, Y = 1. */
export const X = 0;
export const Y = 1;
export type Dim2 = typeof X | typeof Y;

export const EPSILON: Coord = 1e-6;

/** The other dimension (upstream `other_dimension`). */
export function other_dimension(d: Dim2): Dim2 {
  return d === X ? Y : X;
}

/** Anything with x and y coordinates, such as Point. */
export interface Vec2 {
  readonly x: Coord;
  readonly y: Coord;
}

/**
 * Approximate equality. For numbers: |a - b| <= eps. For points: the distance
 * between them is at most eps.
 */
export function are_near(a: Coord, b: Coord, eps?: number): boolean;
export function are_near(a: Vec2, b: Vec2, eps?: number): boolean;
export function are_near(a: Coord | Vec2, b: Coord | Vec2, eps: number = EPSILON): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= eps;
  }
  const p = a as Vec2;
  const q = b as Vec2;
  return hypot(p.x - q.x, p.y - q.y) <= eps;
}

const SPLIT = 2 ** 27 + 1;

/** x * x as the exact sum hi + lo (Dekker's algorithm). */
function square(x: number): [hi: number, lo: number] {
  const xc = x * SPLIT;
  const xh = x - xc + xc;
  const xl = x - xh;
  const hi = x * x;
  return [hi, xh * xh - hi + 2 * xh * xl + xl * xl];
}

const float64 = new DataView(new ArrayBuffer(8));

/** The exponent field (0..2047) of a double. */
function biasedExponent(x: number): number {
  float64.setFloat64(0, x);
  return (float64.getUint16(0) >> 4) & 0x7ff;
}

/**
 * sqrt(x^2 + y^2) with the algorithm of C's hypot() in musl (used by the WASM build of lib2geom).
 * Math.hypot() can differ from it in the last digit, which shows in the written path data.
 */
export function hypot(x: number, y: number): number {
  x = Math.abs(x);
  y = Math.abs(y);
  if (x < y) [x, y] = [y, x];
  if (y === Infinity) return y;
  if (x === Infinity || y === 0 || Number.isNaN(x)) return x;
  if (Number.isNaN(y)) return y;
  // hypot(x, y) = x + y*y/x/2 for small y/x.
  if (biasedExponent(x) - biasedExponent(y) > 64) return x + y;
  let z = 1;
  if (x >= 2 ** 511) {
    z = 2 ** 700;
    x *= 2 ** -700;
    y *= 2 ** -700;
  } else if (y < 2 ** -450) {
    z = 2 ** -700;
    x *= 2 ** 700;
    y *= 2 ** 700;
  }
  const [hx, lx] = square(x);
  const [hy, ly] = square(y);
  return z * Math.sqrt(ly + lx + hy + hx);
}

/** True when |a| <= eps * b. */
export function rel_error_bound(a: Coord, b: Coord, eps: number = EPSILON): boolean {
  return Math.abs(a) <= eps * b;
}

export function lerp(t: Coord, a: Coord, b: Coord): Coord {
  return (1 - t) * a + t * b;
}

/**
 * Shortest decimal representation of x that reads back to the same double,
 * written like double-conversion's DoubleToStringConverter::ToShortest().
 * Exponent notation is used when the decimal exponent is outside [low, high).
 */
function toShortest(x: Coord, low: number, high: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  if (x === 0) return '0'; // UNIQUE_ZERO
  const sign = x < 0 ? '-' : '';
  const [mantissa, exp] = Math.abs(x).toExponential().split('e') as [string, string];
  const digits = mantissa.replace('.', '');
  const exponent = Number(exp);
  const decimalPoint = exponent + 1;

  if (low <= exponent && exponent < high) {
    if (decimalPoint <= 0) {
      return `${sign}0.${'0'.repeat(-decimalPoint)}${digits}`;
    }
    if (decimalPoint >= digits.length) {
      return sign + digits + '0'.repeat(decimalPoint - digits.length);
    }
    return `${sign}${digits.slice(0, decimalPoint)}.${digits.slice(decimalPoint)}`;
  }
  const rest = digits.length > 1 ? `.${digits.slice(1)}` : '';
  return `${sign}${digits[0]}${rest}e${exponent}`;
}

/** Shortest exact representation; exponent notation below 1e-3 and from 1e6. Used by SVGPathWriter. */
export function format_coord_shortest(x: Coord): string {
  return toShortest(x, -3, 6);
}

/** Shortest exact representation; exponent notation below 1e-6 and from 1e21. */
export function format_coord_nice(x: Coord): string {
  return toShortest(x, -6, 21);
}

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parse a number like double-conversion's StringToDouble() with leading/trailing
 * spaces and spaces after the sign allowed. Empty string gives 0, junk gives NaN.
 */
export function parse_coord(s: string): Coord {
  const t = s.trim();
  if (t === '') return 0;
  const m = /^([+-]?)\s*(.*)$/s.exec(t) as RegExpExecArray;
  const sign = m[1] === '-' ? -1 : 1;
  const body = m[2] as string;
  if (body === 'inf') return sign * Infinity;
  if (body === 'NaN') return Number.NaN;
  return NUMBER.test(body) ? sign * Number(body) : Number.NaN;
}
