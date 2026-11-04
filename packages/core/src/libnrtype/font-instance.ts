// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/font-instance.cpp, src/libnrtype/font-instance.h, src/libnrtype/font-glyph.h, src/libnrtype/OpenTypeUtil.h
/*
 * Authors:
 *   fred
 *   bulia byak <buliabyak@users.sf.net>
 *
 * Copyright (C) 2018 Authors
 */
import { Affine, PathVector, parse_svg_path, Rect } from '@inkscape-web/geom';
import { SPCSSBaseline } from '../style-enums.ts';

/**
 * One opened font face with its HarfBuzz font, from the text module
 * (@inkscape-web/wasm loadText()). Values are in font units (y up), the
 * HarfBuzz font scale is the units per em. Upstream gets this from Pango,
 * FreeType and HarfBuzz.
 */
export interface FontFaceBackend {
  readonly upem: number;
  /** The data of an OpenType table, empty if the font has none. */
  table(tag: string): Uint8Array;
  /** The tags of the tables of the font. */
  tableList(): string[];
  /** The glyph of a code point, 0 if the font has none. */
  nominalGlyph(codepoint: number): number;
  /** [h_advance, v_advance, x_bearing, y_bearing, width, height, has_extents, v_origin_x, v_origin_y]. */
  glyphMetrics(glyph: number): ArrayLike<number>;
  /** Whether HarfBuzz has vertical font extents (hb_font_get_v_extents). */
  hasVExtents(): boolean;
  /** Glyph outline as SVG path data. */
  glyphPath(glyph: number): string;
  /**
   * Shape the code points [offset, offset + length) of a paragraph (the rest is context):
   * [glyph, cluster, x_advance, y_advance, x_offset, y_offset] per glyph, clusters are indices
   * into codepoints, glyphs in visual order. direction is an hb_direction_t.
   */
  shape(
    codepoints: Uint32Array,
    offset: number,
    length: number,
    direction: number,
    script: string,
    language: string,
    features: string,
  ): Int32Array;
  /** A string of the name table. */
  name(id: number): string;
  /** Upstream readOpenTypeGsubTable: lines "tag \t before \t input \t after \t output". */
  gsubTables(): string;
  /** Upstream readOpenTypeFvarAxes: lines "tag \t name \t min \t default \t max \t value". */
  varAxes(): string;
  /** A face with the same data and the font variations ("wght=700,wdth=80"). */
  withVariations(variations: string): FontFaceBackend;
  /** A face with the same data, emboldened (fontconfig's synthetic bold). */
  withSyntheticBold(): FontFaceBackend;
  /** The font file data and the face index (for PDF export with cairo). */
  fontData?(): { data: Uint8Array; index: number };
}

/** The info for a glyph in a font, in em units (upstream FontGlyph). */
export interface FontGlyph {
  h_advance: number;
  v_advance: number;
  pathvector: PathVector;
  /** Exact bounding box, from font (y up). */
  bbox_exact: Rect | null;
  bbox_pick: Rect;
  bbox_draw: Rect;
}

/** Characters before, in, after and out of an OpenType substitution (upstream OTSubstitution). */
export interface OTSubstitution {
  before: string;
  input: string;
  after: string;
  output: string;
}

/** An OpenType fvar axis (upstream OTVarAxis). */
export interface OTVarAxis {
  tag: string;
  name: string;
  minimum: number;
  def: number;
  maximum: number;
  set_val: number;
}

/** The glyph id Pango uses for zero-width empty glyphs (PANGO_GLYPH_EMPTY). */
export const PANGO_GLYPH_EMPTY = 0x0fffffff;

/** Read a big-endian integer of a table. */
function i16(t: Uint8Array, o: number): number {
  return ((t[o]! << 24) >> 16) | t[o + 1]!;
}
function u16(t: Uint8Array, o: number): number {
  return (t[o]! << 8) | t[o + 1]!;
}
function u32(t: Uint8Array, o: number): number {
  return ((t[o]! << 24) | (t[o + 1]! << 16) | (t[o + 2]! << 8) | t[o + 3]!) >>> 0;
}

/**
 * A font face at a style (upstream FontInstance): metrics, glyph outlines and
 * shaping. Without a backend face (tests, before the text module is loaded)
 * every character is a glyph of half an em with an em box outline extent and
 * no outline, with ascent 0.8 and descent 0.2 (the defaults of upstream).
 * synthetic_slant shears the outlines (fontconfig's synthetic oblique).
 */
export class FontInstance {
  readonly descr: import('./font-factory.ts').PangoFontDescription;
  readonly face: FontFaceBackend | null;
  readonly synthetic_slant: number;

  _ascent = 0.8;
  _descent = 0.2;
  _xheight = 0.5;
  _ascent_max = 0.8;
  _descent_max = 0.2;
  _design_units = 1000;
  _italic_angle = 0.0;
  _fixed_width = false;
  _oblique = false;
  _has_vertical = false;
  _family_class = 0;
  readonly _baselines: number[] = new Array(SPCSSBaseline.SP_CSS_BASELINE_SIZE).fill(0);
  readonly openTypeTableList = new Set<string>();
  readonly #glyphs = new Map<number, FontGlyph | null>();
  #openTypeTables: Map<string, OTSubstitution> | null = null;
  #openTypeVarAxes: OTVarAxis[] | null = null;
  #underline_position = 0.1;
  #underline_thickness = 0.05;
  #linethrough_position = 0.3;
  #caret_slope_run = 0;
  #caret_slope_rise = 1;

  constructor(
    descr: import('./font-factory.ts').PangoFontDescription,
    face: FontFaceBackend | null,
    synthetic_slant = 0,
  ) {
    this.descr = descr;
    this.face = face;
    this.synthetic_slant = synthetic_slant;
    // Default baseline values, alphabetic is reference
    const b = this._baselines;
    b[SPCSSBaseline.SP_CSS_BASELINE_AUTO] = 0.0;
    b[SPCSSBaseline.SP_CSS_BASELINE_ALPHABETIC] = 0.0;
    b[SPCSSBaseline.SP_CSS_BASELINE_IDEOGRAPHIC] = -this._descent;
    b[SPCSSBaseline.SP_CSS_BASELINE_HANGING] = 0.8 * this._ascent;
    b[SPCSSBaseline.SP_CSS_BASELINE_MATHEMATICAL] = 0.8 * this._xheight;
    b[SPCSSBaseline.SP_CSS_BASELINE_CENTRAL] = 0.5 - this._descent;
    b[SPCSSBaseline.SP_CSS_BASELINE_MIDDLE] = 0.5 * this._xheight;
    b[SPCSSBaseline.SP_CSS_BASELINE_TEXT_BEFORE_EDGE] = this._ascent;
    b[SPCSSBaseline.SP_CSS_BASELINE_TEXT_AFTER_EDGE] = -this._descent;
    if (face) {
      this.#init_face();
      this.#find_font_metrics();
    }
  }

  #init_face(): void {
    for (const t of this.face!.tableList()) this.openTypeTableList.add(t);
    this._has_vertical = this.openTypeTableList.has('vmtx') && this.openTypeTableList.has('vhea');
  }

  /** Find ascent, descent, x-height, and baselines (upstream find_font_metrics). */
  #find_font_metrics(): void {
    // CSS2 recommends using the OS/2 values sTypoAscender and sTypoDescender for the Typographic
    // ascender and descender values. The FreeType face ascender and descender come from hhea.
    const face = this.face!;
    const upem = face.upem;
    if (!upem) return;
    const os2 = face.table('OS/2');
    const hhea = face.table('hhea');
    const post = face.table('post');
    const head = face.table('head');
    if (post.length >= 16) {
      this._italic_angle = (u32(post, 4) | 0) / 65536.0;
      this._fixed_width = u32(post, 12) !== 0;
      // fsSelection mask: oblique/italic = 0x201
      this._oblique = this._italic_angle !== 0 || (os2.length >= 64 && (u16(os2, 62) & 0x201) !== 0);
      this.#underline_position = Math.abs(i16(post, 8) / upem);
      this.#underline_thickness = Math.abs(i16(post, 10) / upem);
    }
    // FreeType face->ascender/descender: hhea, else OS/2 typo, else OS/2 win, else the bbox.
    let face_ascender = hhea.length >= 8 ? i16(hhea, 4) : 0;
    let face_descender = hhea.length >= 8 ? i16(hhea, 6) : 0;
    if (!face_ascender && !face_descender) {
      if (os2.length >= 74) {
        face_ascender = i16(os2, 68);
        face_descender = i16(os2, 70);
        if (!face_ascender && !face_descender && os2.length >= 78) {
          face_ascender = u16(os2, 74);
          face_descender = -u16(os2, 76);
        }
      } else if (head.length >= 44) {
        face_ascender = i16(head, 42);
        face_descender = i16(head, 38);
      }
    }
    if (hhea.length >= 22) {
      this.#caret_slope_rise = i16(hhea, 18);
      this.#caret_slope_run = i16(hhea, 20);
    }
    if (os2.length >= 72) {
      this._family_class = i16(os2, 30);
      this._ascent = Math.abs(i16(os2, 68) / upem);
      this._descent = Math.abs(i16(os2, 70) / upem);
    } else {
      this._ascent = Math.abs(face_ascender / upem);
      this._descent = Math.abs(face_descender / upem);
    }
    this._ascent_max = Math.abs(face_ascender / upem);
    this._descent_max = Math.abs(face_descender / upem);
    this._design_units = upem;
    this.#linethrough_position = Math.abs(face_ascender / 3.0 / upem);

    // In CSS em size is ascent + descent... which should be 1. If not, adjust so it is.
    const em = this._ascent + this._descent;
    if (em > 0.0) {
      this._ascent /= em;
      this._descent /= em;
    }

    // x-height
    const os2_version = os2.length >= 2 ? u16(os2, 0) : 0;
    if (os2.length >= 88 && os2_version >= 0x0002 && os2_version !== 0xffff) {
      // Only os/2 version 2 and above have sxHeight, 0xffff marks "old Mac fonts" without table
      this._xheight = Math.abs(i16(os2, 86) / upem);
    } else {
      // Measure 'x' height in font. Recommended option by XSL standard if no sxHeight.
      const index = face.nominalGlyph(0x78);
      if (index !== 0) {
        const m = face.glyphMetrics(index);
        this._xheight = Math.abs(m[5]! / upem);
      } else {
        // No 'x' in font!
        this._xheight = 0.5;
      }
    }

    // Baselines defined relative to  alphabetic.
    const b = this._baselines;
    b[SPCSSBaseline.SP_CSS_BASELINE_IDEOGRAPHIC] = -this._descent; // Recommendation
    b[SPCSSBaseline.SP_CSS_BASELINE_HANGING] = 0.8 * this._ascent; // Guess
    b[SPCSSBaseline.SP_CSS_BASELINE_MATHEMATICAL] = 0.8 * this._xheight; // Guess
    b[SPCSSBaseline.SP_CSS_BASELINE_CENTRAL] = 0.5 - this._descent; // Definition
    b[SPCSSBaseline.SP_CSS_BASELINE_MIDDLE] = 0.5 * this._xheight; // Definition
    b[SPCSSBaseline.SP_CSS_BASELINE_TEXT_BEFORE_EDGE] = this._ascent; // Definition
    b[SPCSSBaseline.SP_CSS_BASELINE_TEXT_AFTER_EDGE] = -this._descent; // Definition

    // Better math baseline:
    // Try center of minus sign
    let index = face.nominalGlyph(0x2212); //'−'
    // If no minus sign, try hyphen
    if (index === 0) index = face.nominalGlyph(0x2d);
    if (index !== 0) {
      const m = face.glyphMetrics(index);
      // y_bearing is the top, height is negative.
      b[SPCSSBaseline.SP_CSS_BASELINE_MATHEMATICAL] = (m[3]! + m[3]! + m[5]!) / 2.0 / upem;
    }
    // Find hanging baseline... assume it is at top of 'म'.
    index = face.nominalGlyph(0x092e); // 'म'
    if (index !== 0) {
      const m = face.glyphMetrics(index);
      b[SPCSSBaseline.SP_CSS_BASELINE_HANGING] = m[3]! / upem;
    }
  }

  /** The glyph of a character, 0 if the font has none (upstream MapUnicodeChar). */
  MapUnicodeChar(c: number): number {
    if (c > 0x10ffff) return 0;
    if (!this.face) return c;
    return this.face.nominalGlyph(c);
  }

  /** Extract and cache the glyph metrics and path (upstream LoadGlyph). */
  LoadGlyph(glyph_id: number): FontGlyph | null {
    if (glyph_id === PANGO_GLYPH_EMPTY || glyph_id < 0) {
      // Pango value for zero-width empty glyph that we can ignore (e.g. 0xFE0F, Emoji variant selector).
      return null;
    }
    const cached = this.#glyphs.get(glyph_id);
    if (cached !== undefined) return cached;
    const g = this.face ? this.#loadFaceGlyph(glyph_id) : this.#loadFixedGlyph(glyph_id);
    this.#glyphs.set(glyph_id, g);
    return g;
  }

  #loadFaceGlyph(glyph_id: number): FontGlyph {
    const face = this.face!;
    const scale = face.upem;
    const m = face.glyphMetrics(glyph_id);
    const h_advance = m[0]! / scale;
    // Don't use harfbuzz synthesized vertical metrics, it's wrong (includes line gap?)! CSS3
    // Writing modes dictates that if vertical font metrics are missing we must synthesize them.
    const v_advance = this.openTypeTableList.has('vmtx') ? -m[1]! / scale : 1.0;
    let pathvector: PathVector = [];
    const d = face.glyphPath(glyph_id);
    if (d) {
      pathvector = PathVector.transformed(parse_svg_path(d), this.#outlineTransform(1 / scale));
    }
    let bbox_exact: Rect | null = null;
    if (m[6]) {
      bbox_exact = new Rect(m[2]! / scale, m[3]! / scale, (m[2]! + m[4]!) / scale, (m[3]! + m[5]!) / scale);
      if (this.synthetic_slant) bbox_exact = PathVector.boundsExact(pathvector) ?? bbox_exact;
    }
    return this.#glyph(h_advance, v_advance, pathvector, bbox_exact);
  }

  /** Outline scale and the synthetic oblique shear. */
  #outlineTransform(s: number): Affine {
    return new Affine(s, 0, this.synthetic_slant * s, s, 0, 0);
  }

  /** A glyph of the font without backend: half an em, the em box as extent. */
  #loadFixedGlyph(glyph_id: number): FontGlyph {
    const white = /\s/u.test(String.fromCodePoint(Math.min(glyph_id, 0x10ffff)));
    const bbox_exact = white ? null : new Rect(0, -this._descent, 0.5, this._ascent);
    return this.#glyph(0.5, 1.0, [], bbox_exact);
  }

  #glyph(h_advance: number, v_advance: number, pathvector: PathVector, bbox_exact: Rect | null): FontGlyph {
    // Pick box: same as exact bbox but subject to a minimum size (advance width x half em-box height).
    const min = Rect.fromXywh(0.0, 0.0, h_advance, 0.5);
    const bbox_pick = bbox_exact ? bbox_exact.unionWith(min) : min;
    // Any place that might be inked, including any text decoration.
    let bbox_draw = new Rect(0, -this._descent_max * 1.1, h_advance, this._ascent_max * 1.1);
    if (bbox_exact) bbox_draw = bbox_draw.unionWith(bbox_exact);
    return { h_advance, v_advance, pathvector, bbox_exact, bbox_pick, bbox_draw };
  }

  /** The outline of a glyph in em units (y up), or null. */
  PathVector(glyph_id: number): PathVector | null {
    return this.LoadGlyph(glyph_id)?.pathvector ?? null;
  }

  /** Bounding box of glyph. From Harfbuzz. */
  BBoxExact(glyph_id: number): Rect | null {
    return this.LoadGlyph(glyph_id)?.bbox_exact ?? null;
  }

  /** For picking. (Height: embox, Width: glyph advance.) */
  BBoxPick(glyph_id: number): Rect {
    return this.LoadGlyph(glyph_id)?.bbox_pick ?? new Rect(0, 0, 1, 1);
  }

  /** Contains all inked areas including possible text decorations. */
  BBoxDraw(glyph_id: number): Rect | null {
    return this.LoadGlyph(glyph_id)?.bbox_draw ?? null;
  }

  Advance(glyph_id: number, vertical: boolean): number {
    const g = this.LoadGlyph(glyph_id);
    if (!g) return 0;
    return vertical ? g.v_advance : g.h_advance;
  }

  GetTypoAscent(): number {
    return this._ascent;
  }
  GetTypoDescent(): number {
    return this._descent;
  }
  GetXHeight(): number {
    return this._xheight;
  }
  GetMaxAscent(): number {
    return this._ascent_max;
  }
  GetMaxDescent(): number {
    return this._descent_max;
  }
  GetBaselines(): readonly number[] {
    return this._baselines;
  }
  GetDesignUnits(): number {
    return this._design_units;
  }

  FontMetrics(): { ascent: number; descent: number; xheight: number } {
    return { ascent: this._ascent, descent: this._descent, xheight: this._xheight };
  }

  FontDecoration(): {
    underline_position: number;
    underline_thickness: number;
    linethrough_position: number;
    linethrough_thickness: number;
  } {
    // there is no specific linethrough information, mock it up from other font fields
    return {
      underline_position: this.#underline_position,
      underline_thickness: this.#underline_thickness,
      linethrough_position: this.#linethrough_position,
      linethrough_thickness: this.#underline_thickness,
    };
  }

  /** For generating slanted cursors for oblique fonts: { run, rise }. */
  FontSlope(): { run: number; rise: number } {
    if (this.synthetic_slant) return { run: this.synthetic_slant, rise: 1 };
    return { run: this.#caret_slope_run, rise: this.#caret_slope_rise };
  }

  has_vertical(): boolean {
    return this._has_vertical;
  }
  is_fixed_width(): boolean {
    return this._fixed_width;
  }
  is_oblique(): boolean {
    return this._oblique || this.synthetic_slant !== 0;
  }
  family_class(): number {
    return this._family_class;
  }
  get_descr() {
    return this.descr;
  }

  /** The GSUB features and the characters they substitute (upstream get_opentype_tables). */
  get_opentype_tables(): Map<string, OTSubstitution> {
    if (!this.#openTypeTables) {
      this.#openTypeTables = new Map();
      for (const line of (this.face?.gsubTables() ?? '').split('\n')) {
        if (!line) continue;
        const [tag, before = '', input = '', after = '', output = ''] = line.split('\t');
        this.#openTypeTables.set(tag!, { before, input, after, output });
      }
    }
    return this.#openTypeTables;
  }

  /** The variation axes of the font (upstream get_opentype_varaxes). */
  get_opentype_varaxes(): OTVarAxis[] {
    if (!this.#openTypeVarAxes) {
      this.#openTypeVarAxes = [];
      for (const line of (this.face?.varAxes() ?? '').split('\n')) {
        if (!line) continue;
        const [tag, name, min, def, max, val] = line.split('\t');
        this.#openTypeVarAxes.push({
          tag: tag!,
          name: name!,
          minimum: Number(min),
          def: Number(def),
          maximum: Number(max),
          set_val: Number(val),
        });
      }
    }
    return this.#openTypeVarAxes;
  }

  /** All characters of the font with their glyphs, in [from, to] (upstream find_all_characters). */
  find_all_characters(from = 0, to = 0xffff): { unicode: number; glyph_index: number }[] {
    const out: { unicode: number; glyph_index: number }[] = [];
    for (let c = from; c <= to; c++) {
      const g = this.MapUnicodeChar(c);
      if (g) out.push({ unicode: c, glyph_index: g });
    }
    return out;
  }
}
