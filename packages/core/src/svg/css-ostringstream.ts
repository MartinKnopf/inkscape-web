// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/css-ostringstream.cpp, src/svg/css-ostringstream.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { DEFAULT_NUMERIC_PRECISION, formatFixed } from './stringstream.ts';
import { stripTrailingZeros } from './strip-trailing-zeros.ts';

/**
 * Format a number as CSS requires (Inkscape::CSSOStringStream << double): `.` as decimal
 * separator, no `e` notation. `precision` is the number of digits after the period (0 to 16;
 * larger values are treated as 16). Trailing zeros are removed.
 */
export function cssNumber(d: number, precision: number = DEFAULT_NUMERIC_PRECISION): string {
  // Try as integer first. Upstream converts to a 64 bit `long`.
  if (Number.isInteger(d) && Math.abs(d) < 2 ** 63) {
    return BigInt(d).toString();
  }
  if (Number.isNaN(d)) return 'nan';
  if (!Number.isFinite(d)) return d < 0 ? '-inf' : 'inf';
  const digits = precision >= 0 && precision <= 16 ? Math.trunc(precision) : 16;
  return stripTrailingZeros(formatFixed(d, digits));
}
