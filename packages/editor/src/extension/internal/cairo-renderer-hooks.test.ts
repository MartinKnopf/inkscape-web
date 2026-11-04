// SPDX-License-Identifier: GPL-2.0-or-later
import type { FontDescription } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { font_family_candidates, font_style_distance, ttc_face_index } from './cairo-renderer-hooks.ts';

const font = (over: Partial<FontDescription> = {}): FontDescription => ({
  family: 'sans-serif',
  size: 12,
  weight: 400,
  style: 'normal',
  stretch: 'normal',
  variant: 'normal',
  ...over,
});

describe('local font matching', () => {
  it('tries the families of the list in order, generic families as typical fonts', () => {
    const list = font_family_candidates("'Noto Sans', serif");
    expect(list[0]).toBe('Noto Sans');
    expect(list).toContain('Times New Roman');
  });

  it('prefers the face with the weight and slant of the font', () => {
    const faces = ['Regular', 'Bold', 'Italic', 'Bold Italic'];
    const best = (f: FontDescription) =>
      faces.reduce((a, b) => (font_style_distance(b, f) < font_style_distance(a, f) ? b : a));
    expect(best(font())).toBe('Regular');
    expect(best(font({ weight: 700 }))).toBe('Bold');
    expect(best(font({ weight: 700, style: 'italic' }))).toBe('Bold Italic');
  });

  it('finds the face of a collection by its PostScript name', () => {
    // A TTC with two faces; each has a name table with one PostScript name (Mac Roman).
    const bytes: number[] = [];
    const u16 = (v: number) => bytes.push(v >> 8, v & 0xff);
    const u32 = (v: number) => {
      u16(v >>> 16);
      u16(v & 0xffff);
    };
    const ascii = (s: string) => bytes.push(...[...s].map((c) => c.charCodeAt(0)));
    const names = ['Face-Regular', 'Face-Bold'];
    ascii('ttcf');
    u32(0x10000);
    u32(2);
    const header = 12 + 8;
    const faceSize = 12 + 16 + 6 + 12 + 16;
    u32(header);
    u32(header + faceSize);
    names.forEach((name, i) => {
      const faceStart = header + i * faceSize;
      u32(0x10000);
      u16(1);
      u16(0);
      u16(0);
      u16(0);
      ascii('name');
      u32(0);
      u32(faceStart + 28);
      u32(18 + 16);
      u16(0); // name table format
      u16(1); // one record
      u16(18); // strings start
      u16(1); // Mac
      u16(0);
      u16(0);
      u16(6); // PostScript name
      u16(name.length);
      u16(0);
      ascii(name.padEnd(16, ' ').slice(0, 16));
    });
    expect(ttc_face_index(Uint8Array.from(bytes), 'Face-Bold')).toBe(1);
    expect(ttc_face_index(Uint8Array.from(bytes), 'Face-Regular')).toBe(0);
    expect(ttc_face_index(Uint8Array.from([0, 1, 0, 0]), 'x')).toBe(0); // not a collection
  });
});
