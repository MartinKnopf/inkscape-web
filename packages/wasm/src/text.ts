// SPDX-License-Identifier: GPL-2.0-or-later
// Typed API for text-module.wasm (HarfBuzz, FriBidi and libunibreak, see build.sh and
// bindings/text.cpp) and the bundled fonts. Load once with loadText(); after that, all calls are
// synchronous. The core uses it through its TextBackend interface (libnrtype/font-factory.ts).
import createModule, { type MainModule } from '../dist/text-module.mjs';

/** A font face with its HarfBuzz font (values in font units). Structurally the core FontFaceBackend. */
export interface TextFace {
  readonly upem: number;
  table(tag: string): Uint8Array;
  tableList(): string[];
  nominalGlyph(codepoint: number): number;
  /** [h_advance, v_advance, x_bearing, y_bearing, width, height, has_extents, v_origin_x, v_origin_y]. */
  glyphMetrics(glyph: number): Float64Array;
  hasVExtents(): boolean;
  glyphPath(glyph: number): string;
  shape(
    codepoints: Uint32Array,
    offset: number,
    length: number,
    direction: number,
    script: string,
    language: string,
    features: string,
  ): Int32Array;
  name(id: number): string;
  gsubTables(): string;
  varAxes(): string;
  withVariations(variations: string): TextFace;
  /** A copy of the face with synthetic bold (fontconfig's embolden). */
  withSyntheticBold(): TextFace;
  /** The font file data and the face index. */
  fontData(): { data: Uint8Array; index: number };
}

/** The text module. Structurally the core TextBackend. */
export interface TextModule {
  faceCount(bytes: Uint8Array): number;
  createFace(bytes: Uint8Array, index: number): TextFace | null;
  scripts(codepoints: Uint32Array): Uint32Array;
  bidiLevels(codepoints: Uint32Array, rtl: boolean): Uint8Array;
  lineBreaks(codepoints: Uint32Array, language: string): Uint8Array;
  wordBreaks(codepoints: Uint32Array, language: string): Uint8Array;
  graphemeBreaks(codepoints: Uint32Array): Uint8Array;
}

/** A bundled font file. style is a PangoStyle (0 normal, 1 oblique, 2 italic). */
export interface BundledFont {
  family: string;
  style: number;
  weight: number;
  display_name: string;
  url: URL;
}

/** The DejaVu fonts of dist/fonts, the fallback when system fonts are not available. */
export const BUNDLED_FONTS: readonly BundledFont[] = [
  {
    family: 'DejaVu Sans',
    style: 0,
    weight: 400,
    display_name: 'Book',
    url: new URL('../dist/fonts/DejaVuSans.ttf', import.meta.url),
  },
  {
    family: 'DejaVu Sans',
    style: 0,
    weight: 700,
    display_name: 'Bold',
    url: new URL('../dist/fonts/DejaVuSans-Bold.ttf', import.meta.url),
  },
  {
    family: 'DejaVu Sans',
    style: 1,
    weight: 400,
    display_name: 'Oblique',
    url: new URL('../dist/fonts/DejaVuSans-Oblique.ttf', import.meta.url),
  },
  {
    family: 'DejaVu Sans',
    style: 1,
    weight: 700,
    display_name: 'Bold Oblique',
    url: new URL('../dist/fonts/DejaVuSans-BoldOblique.ttf', import.meta.url),
  },
  {
    family: 'DejaVu Serif',
    style: 0,
    weight: 400,
    display_name: 'Book',
    url: new URL('../dist/fonts/DejaVuSerif.ttf', import.meta.url),
  },
  {
    family: 'DejaVu Serif',
    style: 0,
    weight: 700,
    display_name: 'Bold',
    url: new URL('../dist/fonts/DejaVuSerif-Bold.ttf', import.meta.url),
  },
  {
    family: 'DejaVu Sans Mono',
    style: 0,
    weight: 400,
    display_name: 'Book',
    url: new URL('../dist/fonts/DejaVuSansMono.ttf', import.meta.url),
  },
  {
    family: 'DejaVu Sans Mono',
    style: 0,
    weight: 700,
    display_name: 'Bold',
    url: new URL('../dist/fonts/DejaVuSansMono-Bold.ttf', import.meta.url),
  },
];

let module: Promise<MainModule> | undefined;

/** Load the text module (once). See loadGeom() for locateFile. */
export async function loadText(options?: { locateFile: (path: string) => string }): Promise<TextModule> {
  module ??= createModule(options);
  const m = await module;
  // Free the faces of the module when their wrappers are collected.
  const registry = new FinalizationRegistry<number>((id) => m.faceDestroy(id));

  /** The emboldening of synthetic bold in em (as Pango with FC_EMBOLDEN). */
  const SYNTHETIC_BOLD = 0.02;
  // A face of a font file; a clone keeps the variations and the synthetic bold of its source.
  const wrap = (id: number, data: Uint8Array, index: number, variations = '', bold = false): TextFace => {
    const clone = (v: string, b: boolean) => {
      const c = m.faceClone(id);
      if (v) m.setVariations(c, v);
      if (b) m.setSyntheticBold(c, SYNTHETIC_BOLD, SYNTHETIC_BOLD);
      return wrap(c, data, index, v, b);
    };
    const file = { data, index };
    const face: TextFace = {
      fontData: () => file,
      upem: m.upem(id),
      table: (tag) => m.table(id, tag) as Uint8Array,
      tableList: () => m.tableList(id).split(' ').filter(Boolean),
      nominalGlyph: (c) => m.nominalGlyph(id, c),
      glyphMetrics: (g) => m.glyphMetrics(id, g) as Float64Array,
      hasVExtents: () => m.hasVExtents(id),
      glyphPath: (g) => m.glyphPath(id, g),
      shape: (cps, offset, length, direction, script, language, features) =>
        m.shape(id, cps, offset, length, direction, script, language, features) as Int32Array,
      name: (n) => m.name(id, n),
      gsubTables: () => m.gsubTables(id),
      varAxes: () => m.varAxes(id),
      withVariations: (v) => clone(v, bold),
      withSyntheticBold: () => clone(variations, true),
    };
    registry.register(face, id);
    return face;
  };

  return {
    faceCount: (bytes) => m.faceCount(bytes),
    createFace: (bytes, index) => {
      const id = m.faceCreate(bytes, index);
      return id ? wrap(id, bytes, index) : null;
    },
    scripts: (cps) => m.scripts(cps) as Uint32Array,
    bidiLevels: (cps, rtl) => m.bidiLevels(cps, rtl) as Uint8Array,
    lineBreaks: (cps, language) => m.lineBreaks(cps, language) as Uint8Array,
    wordBreaks: (cps, language) => m.wordBreaks(cps, language) as Uint8Array,
    graphemeBreaks: (cps) => m.graphemeBreaks(cps) as Uint8Array,
  };
}
