// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/gif.cpp, src/extension/internal/lib-gif.h, src/extension/internal/png-output.cpp
import { Colors, SPDocument } from '@inkscape-web/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db.ts';
import type { Output } from '../output.ts';
import { Gif } from './gif.ts';
import { GifWriter } from './lib-gif.ts';
import { PngOutput, SP_MODULE_KEY_RASTER_PNG } from './png-output.ts';

/** The frames of a GIF written by GifWriter, as palette colors per pixel (a minimal LZW decoder). */
function decodeGif(data: Uint8Array) {
  expect(new TextDecoder().decode(data.subarray(0, 6))).toBe('GIF89a');
  const width = data[6]! | (data[7]! << 8);
  const height = data[8]! | (data[9]! << 8);
  let pos = 13 + 6; // header, screen descriptor, global palette of 2 entries
  const canvas: number[][] = []; // rgb per pixel
  const frames: number[][][] = [];
  let loops = false;
  while (data[pos] !== 0x3b) {
    if (data[pos] === 0x21) {
      if (data[pos + 1] === 0xff) loops = true;
      pos += 2;
      while (data[pos] !== 0) pos += data[pos]! + 1;
      pos++;
    } else if (data[pos] === 0x2c) {
      const depth = (data[pos + 9]! & 7) + 1;
      pos += 10;
      const palette: number[][] = [];
      for (let i = 0; i < 1 << depth; i++)
        palette.push([data[pos + i * 3]!, data[pos + i * 3 + 1]!, data[pos + i * 3 + 2]!]);
      pos += 3 << depth;
      const min = data[pos++]!;
      const bytes: number[] = [];
      while (data[pos] !== 0) {
        bytes.push(...data.subarray(pos + 1, pos + 1 + data[pos]!));
        pos += data[pos]! + 1;
      }
      pos++;
      // LZW decode
      const clear = 1 << min;
      let size = min + 1;
      let table: number[][] = [];
      const reset = () => {
        table = [];
        for (let i = 0; i < clear + 2; i++) table.push([i]);
        size = min + 1;
      };
      reset();
      const out: number[] = [];
      let prev: number[] | null = null;
      let bit = 0;
      for (;;) {
        let code = 0;
        for (let i = 0; i < size; i++, bit++) code |= ((bytes[bit >> 3]! >> (bit & 7)) & 1) << i;
        if (code === clear) {
          reset();
          prev = null;
          continue;
        }
        if (code === clear + 1) break;
        const entry: number[] = table[code] ?? [...prev!, prev![0]!];
        out.push(...entry);
        if (prev) table.push([...prev, entry[0]!]);
        prev = entry;
        if (table.length === 1 << size && size < 12) size++;
      }
      // Index 0 is transparent: the pixel keeps the previous frame
      for (let i = 0; i < width * height; i++) if (out[i] !== 0) canvas[i] = palette[out[i]!]!;
      frames.push(canvas.map((p) => [...p]));
    } else {
      throw new Error(`block ${data[pos]}`);
    }
  }
  return { width, height, frames, loops };
}

/** An RGBA frame of w x h: the left half red, the right half blue. */
function frame(w: number, h: number, left: number[], right: number[]): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(i % w < w / 2 ? [...left, 255] : [...right, 255], i * 4);
  return px;
}

describe('GifWriter', () => {
  it('writes frames that decode to their colors, and loops when there is a delay', () => {
    const w = new GifWriter(4, 2, 10);
    w.writeFrame(frame(4, 2, [255, 0, 0], [0, 0, 255]), 10, 3);
    const gif = decodeGif(w.end());
    expect([gif.width, gif.height, gif.loops]).toEqual([4, 2, true]);
    const px = gif.frames[0]!;
    expect(px.slice(0, 2)).toEqual([
      [255, 0, 0],
      [255, 0, 0],
    ]);
    expect(px.slice(2, 4)).toEqual([
      [0, 0, 255],
      [0, 0, 255],
    ]);
  });

  it('codes only the changed pixels of the next frame (delta encoding)', () => {
    const w = new GifWriter(4, 2, 10);
    w.writeFrame(frame(4, 2, [255, 0, 0], [0, 0, 255]), 10);
    w.writeFrame(frame(4, 2, [255, 0, 0], [0, 255, 0]), 10);
    const gif = decodeGif(w.end());
    expect(gif.frames).toHaveLength(2);
    expect(gif.frames[1]![0]).toEqual([255, 0, 0]);
    expect(gif.frames[1]![3]).toEqual([0, 255, 0]);
  });

  it('dithers into the palette colors', () => {
    const w = new GifWriter(4, 2, 0);
    w.writeFrame(frame(4, 2, [255, 255, 255], [0, 0, 0]), 0, 2, true);
    const gif = decodeGif(w.end());
    expect(gif.loops).toBe(false);
    expect(gif.frames[0]![0]).toEqual([255, 255, 255]);
    expect(gif.frames[0]![3]).toEqual([0, 0, 0]);
  });
});

describe('GIF output', () => {
  beforeAll(() => {
    Gif.init();
    PngOutput.init();
  });

  it('writes one frame per page, in the size of the document', async () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
        'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="4" height="2">' +
        '<sodipodi:namedview><inkscape:page id="a" x="0" y="0" width="4" height="2"/>' +
        '<inkscape:page id="b" x="10" y="0" width="4" height="2"/></sodipodi:namedview></svg>',
    )!;
    const seen: number[] = [];
    Gif.render_page = async (_doc, area, w, h, background) => {
      seen.push(area.left());
      expect(background.getOpacity()).toBe(1);
      return new Uint8ClampedArray(frame(w, h, [seen.length * 100, 0, 0], [0, 0, 255]));
    };
    const out = db.get('org.inkscape.output.gif.animated') as Output;
    out.set_param_any('bit-depth', '3');
    const gif = decodeGif((await out.save(doc, 'a.gif'))!);
    expect(seen).toEqual([0, 10]);
    expect([gif.width, gif.height, gif.frames.length]).toEqual([4, 2, 2]);
    expect(gif.frames[1]![0]).toEqual([200, 0, 0]);
    expect(Colors.Color).toBeDefined();
  });

  it('PNG output hands the exported PNG on as the file and is a raster output', async () => {
    const out = db.get(SP_MODULE_KEY_RASTER_PNG) as Output;
    expect(out.raster).toBe(true);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(
      await out.export_raster(
        SPDocument.createNewDocFromMem('<svg xmlns="http://www.w3.org/2000/svg"/>')!,
        png,
        'a.png',
      ),
    ).toBe(png);
  });
});
