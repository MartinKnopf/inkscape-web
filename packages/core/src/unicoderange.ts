// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/unicoderange.cpp, src/unicoderange.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */

interface Urange {
  start: string;
  end: string | null;
}

/** A list of characters and U+ ranges (with ? wildcards), as in the u1/u2 attributes of hkern (upstream UnicodeRange). */
export class UnicodeRange {
  readonly unichars: number[] = [];
  readonly range: Urange[] = [];

  constructor(value: string | null) {
    if (!value) return;
    let i = 0;
    while (i < value.length) {
      if (value[i] === 'U' && value[i + 1] === '+') {
        const m = /^([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?/.exec(value.slice(i + 2));
        this.range.push({ start: m?.[1] ?? '', end: m?.[2] ?? null });
        i += 2 + (m?.[0].length ?? 0);
      } else {
        const c = value.codePointAt(i)!;
        this.unichars.push(c);
        i += c > 0xffff ? 2 : 1;
      }
      // skip spaces or commas
      while (value[i] === ' ' || value[i] === ',') i++;
    }
  }

  contains(unicode: number): boolean {
    if (this.unichars.includes(unicode)) return true;
    const uni = unicode.toString(16).toUpperCase().padStart(8, '0');
    for (const r of this.range) {
      if (r.end) {
        if (unicode >= Number.parseInt(r.start, 16) && unicode <= Number.parseInt(r.end, 16)) return true;
      } else {
        const start = r.start.toUpperCase();
        let found = true;
        for (let p = start.length - 1, pos = 7; p >= 0; p--, pos--) {
          if (start[p] !== '?' && uni[pos] !== start[p]) found = false;
        }
        if (found) return true;
      }
    }
    return false;
  }

  attribute_string(): string {
    const chars = this.unichars.map((c) => String.fromCodePoint(c)).join(',');
    const ranges = this.range.map((r) => `U+${r.start}${r.end ? `-${r.end}` : ''}`).join(', ');
    return [chars, ranges].filter(Boolean).join(',');
  }

  sample_glyph(): number {
    if (this.unichars.length) return this.unichars[0]!;
    if (this.range.length) return Number.parseInt(this.range[0]!.start.replace(/\?/g, '0'), 16);
    return 0x20;
  }
}
