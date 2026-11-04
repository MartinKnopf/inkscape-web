// SPDX-License-Identifier: GPL-2.0-or-later
// The cairo library calls of the cairo renderer (cairo.h, cairo-pdf.h, cairo-ps.h, cairo-ft.h).
// The cairo module of @inkscape-web/wasm (cairo and pixman compiled to WASM) implements it.
//
// The core has no dependency on the WASM module: the app loads it when the user exports to
// PDF, PS or EPS (or a test loads it) and passes it to setCairoBackend(). Then all calls are
// synchronous. Cairo objects are handles (pointers into the WASM memory); 0 is NULL.

/** A cairo_t, cairo_surface_t, cairo_pattern_t or cairo_font_face_t. */
export type CairoHandle = number;

/** cairo_operator_t */
export enum CairoOperator {
  CLEAR = 0,
  SOURCE,
  OVER,
  IN,
  OUT,
  ATOP,
  DEST,
  DEST_OVER,
  DEST_IN,
  DEST_OUT,
  DEST_ATOP,
  XOR,
  ADD,
  SATURATE,
  MULTIPLY,
  SCREEN,
  OVERLAY,
  DARKEN,
  LIGHTEN,
  COLOR_DODGE,
  COLOR_BURN,
  HARD_LIGHT,
  SOFT_LIGHT,
  DIFFERENCE,
  EXCLUSION,
  HSL_HUE,
  HSL_SATURATION,
  HSL_COLOR,
  HSL_LUMINOSITY,
}

/** cairo_format_t */
export enum CairoFormat {
  INVALID = -1,
  ARGB32 = 0,
  RGB24 = 1,
  A8 = 2,
  A1 = 3,
}

/** cairo_content_t */
export enum CairoContent {
  COLOR = 0x1000,
  ALPHA = 0x2000,
  COLOR_ALPHA = 0x3000,
}

/** cairo_fill_rule_t */
export enum CairoFillRule {
  WINDING = 0,
  EVEN_ODD = 1,
}

/** cairo_line_join_t */
export enum CairoLineJoin {
  MITER = 0,
  ROUND = 1,
  BEVEL = 2,
}

/** cairo_line_cap_t */
export enum CairoLineCap {
  BUTT = 0,
  ROUND = 1,
  SQUARE = 2,
}

/** cairo_extend_t */
export enum CairoExtend {
  NONE = 0,
  REPEAT = 1,
  REFLECT = 2,
  PAD = 3,
}

/** cairo_filter_t */
export enum CairoFilter {
  FAST = 0,
  GOOD = 1,
  BEST = 2,
  NEAREST = 3,
  BILINEAR = 4,
}

/** cairo_pdf_version_t */
export enum CairoPdfVersion {
  VERSION_1_4 = 0,
  VERSION_1_5 = 1,
  VERSION_1_6 = 2,
  VERSION_1_7 = 3,
}

/** cairo_ps_level_t */
export enum CairoPsLevel {
  LEVEL_2 = 0,
  LEVEL_3 = 1,
}

/** cairo_pdf_metadata_t */
export enum CairoPdfMetadata {
  TITLE = 0,
  AUTHOR,
  SUBJECT,
  KEYWORDS,
  CREATOR,
  CREATE_DATE,
  MOD_DATE,
}

export const CAIRO_STATUS_SUCCESS = 0;
export const CAIRO_TAG_DEST = 'cairo.dest';
export const CAIRO_TAG_LINK = 'Link';
export const CAIRO_MIME_TYPE_JPEG = 'image/jpeg';

/** A matrix in the order of Geom::Affine and cairo_matrix_init(): [xx, yx, xy, yy, x0, y0]. */
export type CairoMatrix = readonly number[];

/** The cairo functions that the renderer calls; the names drop the "cairo_" prefix. */
export interface CairoBackend {
  // Surfaces
  /** cairo_pdf_surface_create_for_stream() that writes into memory (see surfaceTakeOutput). */
  pdfSurfaceCreate(width: number, height: number): CairoHandle;
  /** cairo_ps_surface_create_for_stream() that writes into memory (see surfaceTakeOutput). */
  psSurfaceCreate(width: number, height: number): CairoHandle;
  /** The bytes that a PDF or PS surface wrote since the last call; null for other surfaces. */
  surfaceTakeOutput(surface: CairoHandle): Uint8Array | null;
  surfaceDestroy(surface: CairoHandle): void;
  surfaceFinish(surface: CairoHandle): void;
  surfaceStatus(surface: CairoHandle): number;
  surfaceCreateSimilar(
    surface: CairoHandle,
    content: CairoContent,
    width: number,
    height: number,
  ): CairoHandle;
  surfaceGetContent(surface: CairoHandle): number;
  surfaceSetMimeData(surface: CairoHandle, mimeType: string, data: Uint8Array): void;
  /** cairo_surface_write_to_png_stream(): the PNG file. */
  surfaceWriteToPng(surface: CairoHandle): Uint8Array;
  pdfSurfaceRestrictToVersion(surface: CairoHandle, version: CairoPdfVersion): void;
  pdfSurfaceSetSize(surface: CairoHandle, width: number, height: number): void;
  pdfSurfaceSetPageLabel(surface: CairoHandle, label: string): void;
  pdfSurfaceSetMetadata(surface: CairoHandle, key: CairoPdfMetadata, value: string): void;
  psSurfaceRestrictToLevel(surface: CairoHandle, level: CairoPsLevel): void;
  psSurfaceSetEps(surface: CairoHandle, eps: boolean): void;
  psSurfaceSetSize(surface: CairoHandle, width: number, height: number): void;
  psSurfaceDscComment(surface: CairoHandle, comment: string): void;
  imageSurfaceCreate(format: CairoFormat, width: number, height: number): CairoHandle;
  /** An ARGB32 surface from RGBA bytes (not premultiplied, rows without padding). */
  imageSurfaceFromRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): CairoHandle;
  /** cairo_image_surface_create_from_png_stream() */
  imageSurfaceFromPng(png: Uint8Array): CairoHandle;
  /** A copy of the pixels (stride * height bytes); null if the surface has no image data. */
  imageSurfaceGetData(surface: CairoHandle): Uint8Array | null;
  imageSurfaceSetData(surface: CairoHandle, data: Uint8Array): void;
  imageSurfaceGetWidth(surface: CairoHandle): number;
  imageSurfaceGetHeight(surface: CairoHandle): number;
  imageSurfaceGetStride(surface: CairoHandle): number;

  // Context
  create(surface: CairoHandle): CairoHandle;
  destroy(cr: CairoHandle): void;
  status(cr: CairoHandle): number;
  statusToString(status: number): string;
  getTarget(cr: CairoHandle): CairoHandle;
  save(cr: CairoHandle): void;
  restore(cr: CairoHandle): void;
  pushGroup(cr: CairoHandle): void;
  popGroupToSource(cr: CairoHandle): void;
  showPage(cr: CairoHandle): void;
  setOperator(cr: CairoHandle, op: CairoOperator): void;
  paint(cr: CairoHandle): void;
  paintWithAlpha(cr: CairoHandle, alpha: number): void;
  maskSurface(cr: CairoHandle, surface: CairoHandle, x: number, y: number): void;
  clip(cr: CairoHandle): void;
  newPath(cr: CairoHandle): void;
  rectangle(cr: CairoHandle, x: number, y: number, width: number, height: number): void;
  /** ops: 0 move to, 1 line to, 2 curve to, 3 close path; coords: the points of the segments. */
  appendPath(cr: CairoHandle, ops: Uint8Array, coords: Float64Array): void;
  fill(cr: CairoHandle): void;
  fillPreserve(cr: CairoHandle): void;
  stroke(cr: CairoHandle): void;
  strokePreserve(cr: CairoHandle): void;
  setFillRule(cr: CairoHandle, rule: CairoFillRule): void;
  setSourceRgba(cr: CairoHandle, r: number, g: number, b: number, a: number): void;
  setSource(cr: CairoHandle, pattern: CairoHandle): void;
  setSourceSurface(cr: CairoHandle, surface: CairoHandle, x: number, y: number): void;
  getSource(cr: CairoHandle): CairoHandle;
  setDash(cr: CairoHandle, dashes: Float64Array, offset: number): void;
  setLineWidth(cr: CairoHandle, width: number): void;
  setHairline(cr: CairoHandle, on: boolean): void;
  setLineJoin(cr: CairoHandle, join: CairoLineJoin): void;
  setLineCap(cr: CairoHandle, cap: CairoLineCap): void;
  setMiterLimit(cr: CairoHandle, limit: number): void;
  getMatrix(cr: CairoHandle): number[];
  setMatrix(cr: CairoHandle, matrix: CairoMatrix): void;
  transform(cr: CairoHandle, matrix: CairoMatrix): void;
  identityMatrix(cr: CairoHandle): void;
  scale(cr: CairoHandle, sx: number, sy: number): void;
  tagBegin(cr: CairoHandle, name: string, attributes: string): void;
  tagEnd(cr: CairoHandle, name: string): void;

  // Patterns
  patternCreateLinear(x0: number, y0: number, x1: number, y1: number): CairoHandle;
  patternCreateRadial(
    cx0: number,
    cy0: number,
    r0: number,
    cx1: number,
    cy1: number,
    r1: number,
  ): CairoHandle;
  patternCreateForSurface(surface: CairoHandle): CairoHandle;
  patternAddColorStopRgba(
    pattern: CairoHandle,
    offset: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void;
  patternSetExtend(pattern: CairoHandle, extend: CairoExtend): void;
  patternSetFilter(pattern: CairoHandle, filter: CairoFilter): void;
  patternSetMatrix(pattern: CairoHandle, matrix: CairoMatrix): void;
  patternDestroy(pattern: CairoHandle): void;

  // Fonts
  /** A FreeType font face for a font file (index: face in a collection); 0 if it is no font. */
  ftFontFaceCreate(data: Uint8Array, index: number): CairoHandle;
  /** FT_Get_Char_Index() of each code point (0: the font has no glyph). */
  ftFontFaceGlyphIndices(fontFace: CairoHandle, codepoints: Uint32Array): number[];
  fontFaceDestroy(fontFace: CairoHandle): void;
  setFontFace(cr: CairoHandle, fontFace: CairoHandle): void;
  setFontMatrix(cr: CairoHandle, matrix: CairoMatrix): void;
  /** cairo_show_glyphs(); glyphs: [index, x, y, index, x, y, ...]. */
  showGlyphs(cr: CairoHandle, glyphs: Float64Array): void;
  /** cairo_glyph_path(); glyphs as for showGlyphs(). */
  glyphPath(cr: CairoHandle, glyphs: Float64Array): void;
}

let backend: CairoBackend | null = null;

/** Set the cairo library (the app loads the WASM module before an export). */
export function setCairoBackend(b: CairoBackend | null): void {
  backend = b;
}

/** The cairo library; throws if it is not loaded. */
export function cairoBackend(): CairoBackend {
  if (!backend) throw new Error('cairo is not loaded (setCairoBackend)');
  return backend;
}

/** Whether the cairo library is loaded. */
export function hasCairoBackend(): boolean {
  return backend !== null;
}

let loader: (() => Promise<CairoBackend>) | null = null;

/** Set the function that loads the cairo library on the first export (the app sets it). */
export function setCairoBackendLoader(load: (() => Promise<CairoBackend>) | null): void {
  loader = load;
}

/** Load the cairo library if it is not loaded yet; false if there is no loader or it fails. */
export async function ensureCairoBackend(): Promise<boolean> {
  if (backend) return true;
  if (!loader) return false;
  try {
    setCairoBackend(await loader());
  } catch (e) {
    console.error(e);
    return false;
  }
  return true;
}
