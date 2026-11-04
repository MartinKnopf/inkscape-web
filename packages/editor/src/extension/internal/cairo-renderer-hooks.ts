// SPDX-License-Identifier: GPL-2.0-or-later
// The browser services of the cairo renderer (PDF, PS and EPS export): font files from the
// Local Font Access API (upstream: fontconfig), image decoding and the bitmaps of filtered
// items (upstream: gdk-pixbuf and Inkscape's renderer).
import type { CairoRendererHooks, FontDescription } from '@inkscape-web/core';
import { load_image_pixels } from '../../helper/image-pixels.ts';
import { sp_generate_internal_bitmap } from '../../helper/pixbuf-ops.ts';

/** A font of window.queryLocalFonts() (Local Font Access API, Chromium). */
interface LocalFontData {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
  blob(): Promise<Blob>;
}

/** Typical fonts for the generic CSS families (upstream: the fontconfig aliases). */
const GENERIC_FAMILIES: Record<string, string[]> = {
  'sans-serif': ['DejaVu Sans', 'Arial', 'Helvetica', 'Liberation Sans', 'Segoe UI', 'Roboto'],
  serif: ['DejaVu Serif', 'Times New Roman', 'Times', 'Liberation Serif', 'Georgia'],
  monospace: ['DejaVu Sans Mono', 'Courier New', 'Menlo', 'Liberation Mono', 'Consolas'],
  cursive: ['Comic Sans MS', 'Apple Chancery'],
  fantasy: ['Impact', 'Papyrus'],
};

let localFonts: Promise<LocalFontData[]> | null = null;

/** The local fonts; empty if the browser has no Local Font Access or the user denies it. */
function query_local_fonts(): Promise<LocalFontData[]> {
  const w = globalThis as typeof globalThis & { queryLocalFonts?: () => Promise<LocalFontData[]> };
  localFonts ??= w.queryLocalFonts ? w.queryLocalFonts().catch(() => []) : Promise.resolve([]);
  return localFonts;
}

/** The local fonts by family, style and PostScript name (for the font matching of the PDF import). */
export async function local_font_list(): Promise<
  { family: string; style: string; postscriptName: string }[]
> {
  return (await query_local_fonts()).map((f) => ({
    family: f.family,
    style: f.style,
    postscriptName: f.postscriptName,
  }));
}

/** The families of a CSS font-family list, generic families replaced by typical fonts. */
export function font_family_candidates(family: string): string[] {
  const names = family
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  return names.flatMap((n) => GENERIC_FAMILIES[n.toLowerCase()] ?? [n]);
}

/** How well a face style ("Bold Italic", "Regular", ...) fits the font; lower is better. */
export function font_style_distance(style: string, font: FontDescription): number {
  const s = style.toLowerCase();
  const italic = /italic|oblique/.test(s);
  const weight = /thin|hairline/.test(s)
    ? 100
    : /extra ?light|ultra ?light/.test(s)
      ? 200
      : /light/.test(s)
        ? 300
        : /semi ?bold|demi ?bold/.test(s)
          ? 600
          : /extra ?bold|ultra ?bold/.test(s)
            ? 800
            : /black|heavy/.test(s)
              ? 900
              : /bold/.test(s)
                ? 700
                : /medium/.test(s)
                  ? 500
                  : 400;
  const narrow = /condensed|narrow|compressed/.test(s);
  return (
    Math.abs(weight - font.weight) +
    (italic !== (font.style !== 'normal') ? 1000 : 0) +
    (narrow !== /condensed/.test(font.stretch) ? 300 : 0)
  );
}

/** The index of the face with the PostScript name in a font collection (TTC); 0 if not found. */
export function ttc_face_index(data: Uint8Array, postscriptName: string): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (at: number) => String.fromCharCode(...data.subarray(at, at + 4));
  if (data.length < 12 || tag(0) !== 'ttcf') return 0;
  const count = view.getUint32(8);
  for (let face = 0; face < count; face++) {
    const offset = view.getUint32(12 + 4 * face);
    const tables = view.getUint16(offset + 4);
    for (let t = 0; t < tables; t++) {
      const rec = offset + 12 + 16 * t;
      if (tag(rec) !== 'name') continue;
      const name = view.getUint32(rec + 8);
      const n = view.getUint16(name + 2);
      const strings = name + view.getUint16(name + 4);
      for (let i = 0; i < n; i++) {
        const r = name + 6 + 12 * i;
        if (view.getUint16(r + 6) !== 6) continue; // PostScript name
        const platform = view.getUint16(r);
        const len = view.getUint16(r + 8);
        const at = strings + view.getUint16(r + 10);
        const bytes = data.subarray(at, at + len);
        const text =
          platform === 3 || platform === 0
            ? String.fromCharCode(
                ...Array.from({ length: len / 2 }, (_, k) => (bytes[2 * k]! << 8) | bytes[2 * k + 1]!),
              )
            : String.fromCharCode(...bytes);
        if (text === postscriptName) return face;
      }
    }
  }
  return 0;
}

/** The font file of the local font that fits the font best (upstream: fontconfig matching). */
export async function load_local_font_file(
  font: FontDescription,
): Promise<{ data: Uint8Array; index: number } | null> {
  const fonts = await query_local_fonts();
  if (!fonts.length) return null;
  for (const family of font_family_candidates(font.family)) {
    const faces = fonts.filter((f) => f.family.toLowerCase() === family.toLowerCase());
    if (!faces.length) continue;
    const best = faces.reduce((a, b) =>
      font_style_distance(b.style, font) < font_style_distance(a.style, font) ? b : a,
    );
    const data = new Uint8Array(await (await best.blob()).arrayBuffer());
    return { data, index: ttc_face_index(data, best.postscriptName) };
  }
  return null;
}

/** The hooks of the cairo renderer in the browser. */
export const browser_cairo_renderer_hooks: CairoRendererHooks = {
  loadFont: load_local_font_file,
  loadImage: load_image_pixels,
  generateBitmap: sp_generate_internal_bitmap,
};
