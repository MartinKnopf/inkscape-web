// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/stringstream.cpp, src/svg/stringstream.h, src/util/numeric/precision.cpp
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { stripTrailingZeros } from './strip-trailing-zeros.ts';

/**
 * Default of the preference /options/svgoutput/numericprecision (significant digits).
 * Upstream: Inkscape::Util::get_default_numeric_precision
 */
export const DEFAULT_NUMERIC_PRECISION = 10;

/** Default of the preference /options/svgoutput/minimumexponent. */
export const DEFAULT_MINIMUM_EXPONENT = -8;

/** The finite, non-negative double `abs` as mant * 2^e2 with an integer mant. */
function decompose(abs: number): { mant: bigint; e2: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, abs);
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  return biased === 0 ? { mant: frac, e2: -1074 } : { mant: frac | (1n << 52n), e2: biased - 1075 };
}

/**
 * round(abs * 10^k) as an integer, exact, with ties rounded to even as glibc's printf does.
 * (Number#toFixed and Number#toExponential round ties up.)
 */
function scaledRound(abs: number, k: number): bigint {
  const { mant, e2 } = decompose(abs);
  const num = mant * (e2 > 0 ? 2n ** BigInt(e2) : 1n) * (k > 0 ? 10n ** BigInt(k) : 1n);
  const den = (e2 < 0 ? 2n ** BigInt(-e2) : 1n) * (k < 0 ? 10n ** BigInt(-k) : 1n);
  const q = num / den;
  const twiceRest = 2n * (num % den);
  return twiceRest > den || (twiceRest === den && q % 2n === 1n) ? q + 1n : q;
}

/** printf `%.{digits}f` for a finite number. */
export function formatFixed(d: number, digits: number): string {
  if (Number.isNaN(d)) return 'nan';
  if (!Number.isFinite(d)) return d < 0 ? '-inf' : 'inf';
  const s = scaledRound(Math.abs(d), digits)
    .toString()
    .padStart(digits + 1, '0');
  const int = s.slice(0, s.length - digits);
  return `${d < 0 ? '-' : ''}${digits > 0 ? `${int}.${s.slice(int.length)}` : int}`;
}

/**
 * Format a number like C++ `std::ostream << double` with `std::ios::showpoint` and the given
 * precision (printf `%.{precision}g` with trailing zeros kept).
 */
function formatG(d: number, precision: number): string {
  if (Number.isNaN(d)) return 'nan';
  if (!Number.isFinite(d)) return d < 0 ? '-inf' : 'inf';
  const p = Math.max(1, Math.trunc(precision));
  const abs = Math.abs(d);
  const sign = d < 0 ? '-' : '';
  if (abs === 0) return `${sign}${p > 1 ? `0.${'0'.repeat(p - 1)}` : '0'}`;
  // Decimal exponent X and the p significant digits.
  let x = Number(abs.toExponential(p - 1).split('e')[1]);
  let digits = scaledRound(abs, p - 1 - x);
  if (digits >= 10n ** BigInt(p)) {
    x += 1; // rounding carried into a new digit
    digits = scaledRound(abs, p - 1 - x);
  }
  const ds = digits.toString();
  if (x < -4 || x >= p) {
    const exp = `e${x < 0 ? '-' : '+'}${String(Math.abs(x)).padStart(2, '0')}`;
    return `${sign}${ds.slice(0, 1)}${p > 1 ? `.${ds.slice(1)}` : ''}${exp}`;
  }
  if (x >= 0) return `${sign}${ds.slice(0, x + 1)}${x + 1 < p ? `.${ds.slice(x + 1)}` : ''}`;
  return `${sign}0.${'0'.repeat(-x - 1)}${ds}`;
}

/**
 * Format a number the way Inkscape writes numbers to SVG (Inkscape::SVGOStringStream << double):
 * integers that fit an `int` are written as is, other values use `precision` significant digits
 * with trailing zeros removed and `e` notation for large and small exponents ("3e+09",
 * "1.234e-12").
 */
export function svgNumber(d: number, precision: number = DEFAULT_NUMERIC_PRECISION): string {
  // Try as integer first.
  if (Number.isInteger(d) && d >= -0x80000000 && d <= 0x7fffffff) {
    return String(d === 0 ? 0 : d); // "-0" would be "0"
  }
  return stripTrailingZeros(formatG(d, precision));
}

/** Upstream: SVGOStringStream << Geom::Point */
export function svgPoint(x: number, y: number, precision: number = DEFAULT_NUMERIC_PRECISION): string {
  return `${svgNumber(x, precision)},${svgNumber(y, precision)}`;
}
