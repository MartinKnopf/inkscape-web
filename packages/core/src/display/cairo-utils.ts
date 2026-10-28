// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/cairo-utils.cpp, src/display/cairo-utils.h
/*
 * Helper functions to use cairo with inkscape
 *
 * Copyright (C) 2007 bulia byak
 * Copyright (C) 2008 Johan Engelen
 */

/** Size of an encoded image, read from its header. */
interface ImageSize {
  width: number;
  height: number;
}

/**
 * A bitmap image (upstream Inkscape::Pixbuf). Upstream decodes the pixels
 * into a Cairo surface. Here the browser decodes and draws the image, so a
 * Pixbuf has only what the document model needs: the pixel size, read from
 * the file header, and a URL the browser can load (`href`).
 *
 * Sizes of data: URIs are read synchronously. Other URLs (blob:, http:)
 * need a loader that the editor sets (Pixbuf.urlLoader); until it has the
 * size, create_from_url() returns null.
 * TODO: the resolution of the file (pHYs, EXIF), EXIF orientation, color profiles.
 */
export class Pixbuf {
  /** Loads the size of an image URL (set by the editor; null without a DOM). */
  static urlLoader: ((url: string) => Promise<ImageSize>) | null = null;
  static readonly #urlCache = new Map<string, Pixbuf | 'pending' | 'failed'>();
  static readonly #urlListeners = new Map<string, (() => void)[]>();

  constructor(
    readonly href: string,
    readonly _width: number,
    readonly _height: number,
    readonly mime_type: string | null = null,
  ) {}

  width(): number {
    return this._width;
  }
  height(): number {
    return this._height;
  }

  /** A Pixbuf for a data: URI, or null if it is not an image that we can read. */
  static create_from_data_uri(uri: string, svgdpi = 0): Pixbuf | null {
    const m = /^data:([^,;]*)((?:;[^,;]*)*),/i.exec(uri);
    if (!m) return null;
    const isBase64 = /;base64/i.test(m[2] ?? '');
    const data = uri.slice(m[0].length);
    let bytes: Uint8Array;
    try {
      bytes = isBase64 ? base64Decode(data) : new TextEncoder().encode(decodeURIComponent(data));
    } catch {
      return null;
    }
    const size = sniffImageSize(bytes, svgdpi);
    if (!size) return null;
    return new Pixbuf(uri, size.width, size.height, size.mime);
  }

  /** A Pixbuf for the bytes of an image file, embedded as a data: URI; null if it is no image. */
  static create_from_buffer(bytes: Uint8Array, svgdpi = 0): Pixbuf | null {
    const size = sniffImageSize(bytes, svgdpi);
    if (!size) return null;
    return new Pixbuf(`data:${size.mime};base64,${base64Encode(bytes)}`, size.width, size.height, size.mime);
  }

  /**
   * A Pixbuf for an image URL that is not a data: URI. Returns null if the size
   * is not known yet: then the loader starts and calls onLoad when it is done.
   */
  static create_from_url(url: string, onLoad: () => void): Pixbuf | null {
    const cached = Pixbuf.#urlCache.get(url);
    if (cached instanceof Pixbuf) return cached;
    if (cached === 'failed' || !Pixbuf.urlLoader) return null;
    const listeners = Pixbuf.#urlListeners.get(url) ?? [];
    listeners.push(onLoad);
    Pixbuf.#urlListeners.set(url, listeners);
    if (cached === 'pending') return null;
    Pixbuf.#urlCache.set(url, 'pending');
    Pixbuf.urlLoader(url)
      .then(
        (size) => Pixbuf.#urlCache.set(url, new Pixbuf(url, size.width, size.height)),
        () => Pixbuf.#urlCache.set(url, 'failed'),
      )
      .finally(() => {
        const done = Pixbuf.#urlListeners.get(url) ?? [];
        Pixbuf.#urlListeners.delete(url);
        for (const listener of done) listener();
      });
    return null;
  }
}

function base64Decode(data: string): Uint8Array {
  const bin = atob(data.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** The MIME type and pixel size of PNG, JPEG, GIF, WebP and SVG data; null for other data. */
export function sniffImageSize(b: Uint8Array, svgdpi = 0): (ImageSize & { mime: string }) | null {
  const be16 = (i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  const be32 = (i: number) => be16(i) * 0x10000 + be16(i + 2);
  const le16 = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
  const le24 = (i: number) => le16(i) | ((b[i + 2] ?? 0) << 16);
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') {
    return { mime: 'image/png', width: be32(16), height: be32(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: find the start-of-frame marker.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1] ?? 0;
      if (marker === 0xff) {
        i++;
        continue;
      }
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) return { mime: 'image/jpeg', width: be16(i + 7), height: be16(i + 5) };
      i += 2 + be16(i + 2);
    }
    return null;
  }
  if (ascii(0, 4) === 'GIF8') return { mime: 'image/gif', width: le16(6), height: le16(8) };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return { mime: 'image/webp', width: le24(24) + 1, height: le24(27) + 1 };
    if (chunk === 'VP8L') {
      const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') return { mime: 'image/webp', width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    return null;
  }
  const text = new TextDecoder().decode(b.subarray(0, 4096));
  const svg = /<svg\b[^>]*>/.exec(text)?.[0];
  if (svg) return { mime: 'image/svg+xml', ...svgSize(svg, svgdpi) };
  return null;
}

/** The size of an SVG image from the attributes of its root element (300×150 if unknown). */
function svgSize(tag: string, _svgdpi: number): ImageSize {
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`).exec(tag)?.[1] ?? null;
  const vb = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const len = (value: string | null, fallback: number) => {
    const m = value ? /^\s*([\d.eE+-]+)\s*(px|pt|pc|mm|cm|in)?\s*$/.exec(value) : null;
    if (!m) return fallback;
    const factor = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[m[2] ?? 'px'] ?? 1;
    return Number(m[1]) * factor;
  };
  // TODO: svgdpi (inkscape:svg-dpi) scaling.
  return { width: len(attr('width'), vb?.[2] ?? 300), height: len(attr('height'), vb?.[3] ?? 150) };
}
