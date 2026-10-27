// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/strip-trailing-zeros.cpp, src/svg/strip-trailing-zeros.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

/**
 * Remove trailing zeros (and a trailing decimal point) from the fractional part of a formatted
 * number. A part after an `e` exponent marker stays as it is: "1.500e+09" becomes "1.5e+09".
 * A string without a decimal point is returned unchanged.
 */
export function stripTrailingZeros(str: string): string {
  const pIx = str.indexOf('.');
  if (pIx === -1) return str;
  const eIx = str.indexOf('e', pIx);
  const end = eIx === -1 ? str.length : eIx;
  // Index of the last character before the exponent that is not '0'.
  let nzIx = end - 1;
  while (nzIx >= 0 && str[nzIx] === '0') nzIx--;
  if (nzIx < pIx) throw new Error("have `.' but couldn't find non-0");
  return str.slice(0, nzIx === pIx ? pIx : nzIx + 1) + str.slice(end);
}
