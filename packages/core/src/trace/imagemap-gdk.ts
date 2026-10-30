// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/trace/imagemap-gdk.cpp, src/trace/imagemap-gdk.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import { GrayMap, type IndexedMap, RgbMap } from './imagemap.ts';

/**
 * An RGBA image, 4 bytes per pixel, not premultiplied, row by row (upstream: a GdkPixbuf with
 * alpha; the shape of the browser's ImageData).
 */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

/** The brightness of each pixel, over white where transparent. */
export function gdkPixbufToGrayMap(buf: RgbaImage): GrayMap {
  const map = new GrayMap(buf.width, buf.height);
  const p = buf.data;
  for (let i = 0; i < buf.width * buf.height; i++) {
    const alpha = p[4 * i + 3] ?? 255;
    const white = 3 * (255 - alpha);
    const sample = (p[4 * i] ?? 0) + (p[4 * i + 1] ?? 0) + (p[4 * i + 2] ?? 0);
    map.pixels[i] = Math.trunc((sample * alpha) / 256) + white;
  }
  return map;
}

export function grayMapToGdkPixbuf(map: GrayMap): RgbaImage {
  const data = new Uint8ClampedArray(4 * map.width * map.height);
  for (let i = 0; i < map.width * map.height; i++) {
    const pix = Math.trunc((map.pixels[i] ?? 0) / 3) & 0xff;
    data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = pix;
    data[4 * i + 3] = 255;
  }
  return { width: map.width, height: map.height, data };
}

/** The colors of each pixel, over white where transparent. */
export function gdkPixbufToRgbMap(buf: RgbaImage): RgbMap {
  const map = new RgbMap(buf.width, buf.height);
  const p = buf.data;
  for (let i = 0; i < buf.width * buf.height; i++) {
    const alpha = p[4 * i + 3] ?? 255;
    const white = 255 - alpha;
    for (let c = 0; c < 3; c++) {
      map.pixels[3 * i + c] = (Math.trunc(((p[4 * i + c] ?? 0) * alpha) / 256) + white) & 0xff;
    }
  }
  return map;
}

export function indexedMapToGdkPixbuf(map: IndexedMap): RgbaImage {
  const data = new Uint8ClampedArray(4 * map.width * map.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const rgb = map.getPixelValue(x, y);
      const i = 4 * (x + y * map.width);
      data[i] = rgb.r & 0xff;
      data[i + 1] = rgb.g & 0xff;
      data[i + 2] = rgb.b & 0xff;
      data[i + 3] = 255;
    }
  }
  return { width: map.width, height: map.height, data };
}
