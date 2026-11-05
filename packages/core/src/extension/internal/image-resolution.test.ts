// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/image-resolution.cpp
import { describe, expect, it } from 'vitest';
import { ImageResolution } from './image-resolution.ts';

/** A PNG signature and IHDR (not valid CRCs; the reader does not check them), then pHYs. */
function png(ppmX: number, ppmY: number, unit: number): Uint8Array {
  const chunk = (type: string, data: number[]) => [
    0,
    0,
    0,
    data.length,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0,
  ];
  const u32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [...u32(1), ...u32(1), 8, 6, 0, 0, 0]),
    ...chunk('pHYs', [...u32(ppmX), ...u32(ppmY), unit]),
    ...chunk('IEND', []),
  ]);
}

function jfif(unit: number, xd: number, yd: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    16,
    0x4a,
    0x46,
    0x49,
    0x46,
    0,
    1,
    1,
    unit,
    xd >> 8,
    xd & 255,
    yd >> 8,
    yd & 255,
    0,
    0,
    0xff,
    0xd9,
  ]);
}

describe('ImageResolution', () => {
  it('reads the pHYs chunk of a PNG as dpi', () => {
    const ir = new ImageResolution(png(11811, 5906, 1)); // 300 dpi and 150 dpi
    expect([ir.ok(), ir.x(), ir.y()]).toEqual([true, 300, 150]);
  });

  it('ignores a PNG with unknown units', () => {
    expect(new ImageResolution(png(11811, 11811, 0)).ok()).toBe(false);
  });

  it('reads the JFIF density in dots per inch and per cm', () => {
    const inch = new ImageResolution(jfif(1, 72, 96));
    expect([inch.ok(), inch.x(), inch.y()]).toEqual([true, 72, 96]);
    const cm = new ImageResolution(jfif(2, 100, 100));
    expect(cm.ok()).toBe(true);
    expect(cm.x()).toBeCloseTo(254);
  });

  it('rejects a zero JFIF density and other data', () => {
    expect(new ImageResolution(jfif(1, 0, 72)).ok()).toBe(false);
    expect(new ImageResolution(new Uint8Array([1, 2, 3])).ok()).toBe(false);
  });
});
