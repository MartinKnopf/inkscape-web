// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/cairo-utils.cpp, src/display/cairo-utils.h
/*
 * Helper functions to use cairo with inkscape
 *
 * Copyright (C) 2007 bulia byak
 * Copyright (C) 2008 Johan Engelen
 */
import {
  Affine,
  BezierCurve,
  type Curve,
  EllipticalArc,
  type Path,
  type PathVector,
  Point,
} from '@inkscape-web/geom';
import type { Color } from '../colors/color.ts';
import { SpaceType } from '../colors/spaces/enum.ts';
import { type CairoHandle, CairoOperator, cairoBackend } from '../extension/internal/cairo-backend.ts';
import { SPBlendMode } from '../style-enums.ts';

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

// ----- Cairo helpers (the cairo calls go to the backend of extension/internal/cairo-backend.ts)

/** The segments of a path for CairoBackend.appendPath(). */
class CairoPathData {
  ops: number[] = [];
  coords: number[] = [];
  moveTo(p: Point): void {
    this.ops.push(0);
    this.coords.push(p.x, p.y);
  }
  lineTo(p: Point): void {
    this.ops.push(1);
    this.coords.push(p.x, p.y);
  }
  curveTo(a: Point, b: Point, c: Point): void {
    this.ops.push(2);
    this.coords.push(a.x, a.y, b.x, b.y, c.x, c.y);
  }
  closePath(): void {
    this.ops.push(3);
  }
}

/**
 * Upstream feed_curve_to_cairo() without the view optimization. Quadratic Beziers are degree
 * elevated; elliptical arcs become cubic Beziers of at most 90 degrees on the unit circle
 * (upstream calls cairo_arc() in the unit circle transform, which does the same).
 */
function feed_curve_to_cairo(out: CairoPathData, c: Curve): void {
  if (c instanceof BezierCurve) {
    const order = c.order();
    if (order === 1) {
      out.lineTo(c.finalPoint());
    } else if (order === 2) {
      const [p0, p1, p2] = [c.controlPoint(0), c.controlPoint(1), c.controlPoint(2)];
      const b1 = p0.add(p1.sub(p0).mul(2 / 3));
      const b2 = b1.add(p2.sub(p0).mul(1 / 3));
      out.curveTo(b1, b2, p2);
    } else {
      out.curveTo(c.controlPoint(1), c.controlPoint(2), c.controlPoint(3));
    }
    return;
  }
  if (c instanceof EllipticalArc) {
    if (c.isChord()) {
      out.lineTo(c.finalPoint());
      return;
    }
    const xform = c.unitCircleTransform();
    const a0 = c.initialAngle().radians();
    let a1 = c.finalAngle().radians();
    if (Number.isNaN(a0) || Number.isNaN(a1)) return; // Bad angle while drawing EllipticalArc
    if (c.sweep()) while (a1 < a0) a1 += 2 * Math.PI;
    else while (a1 > a0) a1 -= 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
    const d = (a1 - a0) / n;
    const k = (4 / 3) * Math.tan(d / 4);
    for (let i = 0; i < n; i++) {
      const s = a0 + i * d;
      const e = s + d;
      const p0 = new Point(Math.cos(s), Math.sin(s));
      const p3 = new Point(Math.cos(e), Math.sin(e));
      const p1 = new Point(p0.x - k * p0.y, p0.y + k * p0.x);
      const p2 = new Point(p3.x + k * p3.y, p3.y - k * p3.x);
      out.curveTo(p1.transformed(xform), p2.transformed(xform), p3.transformed(xform));
    }
    // The last point exactly at the end of the arc.
    out.coords.splice(-2, 2, c.finalPoint().x, c.finalPoint().y);
    return;
  }
  out.lineTo(c.finalPoint());
}

/** Upstream feed_path_to_cairo(). */
function feed_path_to_cairo(out: CairoPathData, path: Path): void {
  if (path.empty()) return;
  out.moveTo(path.initialPoint());
  for (const c of path.openCurves()) feed_curve_to_cairo(out, c);
  if (path.closed()) out.closePath();
}

/** Feeds path-creating calls to the cairo context translating them from the PathVector. */
export function feed_pathvector_to_cairo(ct: CairoHandle, pathv: PathVector): void {
  if (pathv.length === 0) return;
  const out = new CairoPathData();
  for (const path of pathv) feed_path_to_cairo(out, path);
  cairoBackend().appendPath(ct, Uint8Array.from(out.ops), Float64Array.from(out.coords));
}

/** The cairo matrix of an affine ([xx, yx, xy, yy, x0, y0]). */
export function ink_matrix_to_cairo(m: Affine): number[] {
  return [m.c0, m.c1, m.c2, m.c3, m.c4, m.c5];
}

export function ink_matrix_to_2geom(cm: readonly number[]): Affine {
  return new Affine(cm[0], cm[1], cm[2], cm[3], cm[4], cm[5]);
}

export function ink_cairo_transform(ct: CairoHandle, m: Affine): void {
  cairoBackend().transform(ct, ink_matrix_to_cairo(m));
}

export function ink_cairo_pattern_set_matrix(cp: CairoHandle, m: Affine): void {
  cairoBackend().patternSetMatrix(cp, ink_matrix_to_cairo(m));
}

/** The sRGB components and the opacity of a color (other color spaces are converted). */
function rgba(color: Color): [number, number, number, number] {
  const rgb =
    color.getSpace().getType() === SpaceType.RGB ? color : (color.converted(SpaceType.RGB) ?? color);
  return [rgb.get(0), rgb.get(1), rgb.get(2), rgb.getOpacity()];
}

export function ink_cairo_set_source_color(ctx: CairoHandle, color: Color): void {
  cairoBackend().setSourceRgba(ctx, ...rgba(color));
}

export function ink_cairo_pattern_add_color_stop(ptn: CairoHandle, offset: number, color: Color): void {
  cairoBackend().patternAddColorStopRgba(ptn, offset, ...rgba(color));
}

/** Draw strokes with the thinnest line of the output device (cairo_set_hairline). */
export function ink_cairo_set_hairline(ct: CairoHandle): void {
  cairoBackend().setHairline(ct, true);
}

export function ink_css_blend_to_cairo_operator(css_blend: SPBlendMode): CairoOperator {
  // All of the blend modes are implemented in Cairo as of 1.10.
  // For a detailed description, see:
  // http://cairographics.org/operators/
  switch (css_blend) {
    case SPBlendMode.SP_CSS_BLEND_MULTIPLY:
      return CairoOperator.MULTIPLY;
    case SPBlendMode.SP_CSS_BLEND_SCREEN:
      return CairoOperator.SCREEN;
    case SPBlendMode.SP_CSS_BLEND_DARKEN:
      return CairoOperator.DARKEN;
    case SPBlendMode.SP_CSS_BLEND_LIGHTEN:
      return CairoOperator.LIGHTEN;
    case SPBlendMode.SP_CSS_BLEND_OVERLAY:
      return CairoOperator.OVERLAY;
    case SPBlendMode.SP_CSS_BLEND_COLORDODGE:
      return CairoOperator.COLOR_DODGE;
    case SPBlendMode.SP_CSS_BLEND_COLORBURN:
      return CairoOperator.COLOR_BURN;
    case SPBlendMode.SP_CSS_BLEND_HARDLIGHT:
      return CairoOperator.HARD_LIGHT;
    case SPBlendMode.SP_CSS_BLEND_SOFTLIGHT:
      return CairoOperator.SOFT_LIGHT;
    case SPBlendMode.SP_CSS_BLEND_DIFFERENCE:
      return CairoOperator.DIFFERENCE;
    case SPBlendMode.SP_CSS_BLEND_EXCLUSION:
      return CairoOperator.EXCLUSION;
    case SPBlendMode.SP_CSS_BLEND_HUE:
      return CairoOperator.HSL_HUE;
    case SPBlendMode.SP_CSS_BLEND_SATURATION:
      return CairoOperator.HSL_SATURATION;
    case SPBlendMode.SP_CSS_BLEND_COLOR:
      return CairoOperator.HSL_COLOR;
    case SPBlendMode.SP_CSS_BLEND_LUMINOSITY:
      return CairoOperator.HSL_LUMINOSITY;
    default:
      return CairoOperator.OVER;
  }
}
