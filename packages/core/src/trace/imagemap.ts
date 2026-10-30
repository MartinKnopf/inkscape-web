// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/trace/imagemap.cpp, src/trace/imagemap.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */

/**
 * A gray map: one brightness per pixel, 0 (black) to 765 (white, 3 * 255) (upstream GrayMap).
 */
export class GrayMap {
  static readonly BLACK = 0;
  static readonly WHITE = 255 * 3;
  readonly pixels: Uint32Array;

  constructor(
    readonly width: number,
    readonly height: number,
    pixels?: Uint32Array,
  ) {
    this.pixels = pixels ?? new Uint32Array(width * height);
  }

  offset(x: number, y: number): number {
    return x + y * this.width;
  }
  setPixel(x: number, y: number, val: number): void {
    this.pixels[this.offset(x, y)] = val;
  }
  getPixel(x: number, y: number): number {
    return this.pixels[this.offset(x, y)] ?? 0;
  }
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** An RGB map: 3 bytes per pixel (upstream RgbMap). */
export class RgbMap {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    pixels?: Uint8Array,
  ) {
    this.pixels = pixels ?? new Uint8Array(3 * width * height);
  }

  setPixel(x: number, y: number, { r, g, b }: RGB): void {
    const i = 3 * (x + y * this.width);
    this.pixels[i] = r;
    this.pixels[i + 1] = g;
    this.pixels[i + 2] = b;
  }
  getPixel(x: number, y: number): RGB {
    const i = 3 * (x + y * this.width);
    return { r: this.pixels[i] ?? 0, g: this.pixels[i + 1] ?? 0, b: this.pixels[i + 2] ?? 0 };
  }
}

/** A color index per pixel and the color look-up table (upstream IndexedMap). */
export class IndexedMap {
  readonly pixels: Uint32Array;
  nrColors = 0;
  /** Color look-up table. */
  clut: RGB[] = Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0 }));

  constructor(
    readonly width: number,
    readonly height: number,
    pixels?: Uint32Array,
  ) {
    this.pixels = pixels ?? new Uint32Array(width * height);
  }

  getPixel(x: number, y: number): number {
    return this.pixels[x + y * this.width] ?? 0;
  }
  setPixel(x: number, y: number, val: number): void {
    this.pixels[x + y * this.width] = val;
  }
  getPixelValue(x: number, y: number): RGB {
    return this.clut[this.getPixel(x, y) % this.clut.length] as RGB;
  }
}
