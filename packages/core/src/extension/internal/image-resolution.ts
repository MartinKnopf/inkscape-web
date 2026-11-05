// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/image-resolution.cpp, src/extension/internal/image-resolution.h
/*
 * Authors:
 *   Daniel Wagenaar <daw@caltech.edu>
 *
 * Copyright (C) 2012 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

/**
 * The resolution that an image file states (upstream ImageResolution): the pHYs chunk of PNG
 * files and the JFIF density of JPEG files, in dpi. Upstream reads these with libpng and
 * libjpeg, and also tries libexif (not built by default) and ImageMagick (for BMP); the
 * browser has neither.
 */
export class ImageResolution {
  #ok = false;
  #x = 0;
  #y = 0;

  constructor(bytes: Uint8Array) {
    this.#readpng(bytes);
    if (!this.#ok) this.#readjfif(bytes);
  }

  ok(): boolean {
    return this.#ok;
  }
  x(): number {
    return this.#x;
  }
  y(): number {
    return this.#y;
  }

  /** The pHYs chunk (libpng png_get_x_pixels_per_inch: pixels per meter, rounded to dpi). */
  #readpng(bytes: Uint8Array): void {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 8 || sig.some((b, i) => bytes[i] !== b)) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 8;
    while (pos + 8 <= bytes.length) {
      const length = view.getUint32(pos);
      const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
      if (type === 'IDAT' || type === 'IEND') return; // pHYs comes before the image data
      if (type === 'pHYs' && length === 9 && pos + 8 + 9 <= bytes.length) {
        const res_x = view.getUint32(pos + 8);
        const res_y = view.getUint32(pos + 12);
        const unit_type = bytes[pos + 16];
        const ppi = (ppm: number) => Math.floor((ppm * 127 + 2500) / 5000);
        if (unit_type === 1 && ppi(res_x) !== 0 && ppi(res_y) !== 0) {
          this.#ok = true;
          this.#x = ppi(res_x);
          this.#y = ppi(res_y);
        }
        return;
      }
      pos += 12 + length;
    }
  }

  /** The JFIF APP0 marker: the density in dots per inch or per cm. */
  #readjfif(bytes: Uint8Array): void {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos] !== 0xff) return;
      const marker = bytes[pos + 1]!;
      if (marker === 0xff) {
        pos++; // fill byte
        continue;
      }
      if (marker === 0xda || marker === 0xd9) return; // start of scan, end of image
      const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
      // "JFIF\0", version (2 bytes), units (1), X density (2), Y density (2)
      if (marker === 0xe0 && length >= 16 && pos + 4 + 12 <= bytes.length) {
        const d = pos + 4;
        const tag = String.fromCharCode(...bytes.subarray(d, d + 4));
        if (tag !== 'JFIF' || bytes[d + 4] !== 0) return;
        const unit = bytes[d + 7];
        const xd = (bytes[d + 8]! << 8) | bytes[d + 9]!;
        const yd = (bytes[d + 10]! << 8) | bytes[d + 11]!;
        const scale = unit === 1 ? 1 : unit === 2 ? 2.54 : 0; // dots/inch, dots/cm
        // The densities should be non-zero (they are not always, LP bug #1275443).
        if (scale && xd !== 0 && yd !== 0) {
          this.#ok = true;
          this.#x = xd * scale;
          this.#y = yd * scale;
        }
        return;
      }
      pos += 2 + length;
    }
  }
}
