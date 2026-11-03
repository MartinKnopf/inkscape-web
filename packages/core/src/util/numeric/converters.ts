// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/util/numeric/converters.h
/*
 * Utility functions to convert ascii representations to numbers
 *
 * Authors:
 *   Felipe Corrêa da Silva Sanches <juca@members.fsf.org>
 *
 * Copyright (C) 2006 Hugo Rodrigues
 */

/** The number of value; 0 if it is not a number (upstream read_number with g_ascii_strtod). */
export function read_number(value: string | null): number {
  if (value === null) return 0;
  const t = value.trim();
  const ret = Number(t);
  return t !== '' && Number.isFinite(ret) ? ret : 0;
}

export function read_bool(value: string | null, default_value: boolean): boolean {
  if (!value) return default_value;
  if (value.startsWith('true')) return true;
  if (value.startsWith('false')) return false;
  return default_value;
}

/** The numbers of value, separated by spaces or commas; stops at the first non-number. */
export function read_vector(value: string): number[] {
  const v: number[] = [];
  for (const part of value.split(/[\s,]+/)) {
    if (part === '') continue;
    const n = Number.parseFloat(part);
    if (Number.isNaN(n)) break;
    v.push(n);
  }
  return v;
}

/**
 * The number at the start of value, like g_ascii_strtod: { value, ok } where ok is false if
 * value does not start with a number.
 */
export function strtod(value: string): { value: number; ok: boolean } {
  const m = /^\s*[+-]?(\d+\.?\d*(e[+-]?\d+)?|\.\d+(e[+-]?\d+)?)/i.exec(value);
  return m ? { value: Number.parseFloat(m[0]), ok: true } : { value: 0, ok: false };
}
