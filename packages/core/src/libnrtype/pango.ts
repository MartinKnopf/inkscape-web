// SPDX-License-Identifier: GPL-2.0-or-later
// The parts of Pango that libnrtype (Layout-TNG-Compute) calls: pango_itemize_with_base_dir(),
// pango_get_log_attrs() and pango_shape_full(), on the text module (HarfBuzz, FriBidi,
// libunibreak) with the same results as Pango where libnrtype depends on them.
// Values are in em units (Pango units divided by PANGO_SCALE and the font size).

import type { TextBackend } from './font-factory.ts';
import type { FontInstance } from './font-instance.ts';
import { PANGO_GLYPH_EMPTY } from './font-instance.ts';

/** Pango gravities that the vertical layout distinguishes (PangoGravity). */
export enum PangoGravity {
  PANGO_GRAVITY_SOUTH,
  PANGO_GRAVITY_EAST,
  PANGO_GRAVITY_NORTH,
  PANGO_GRAVITY_WEST,
  PANGO_GRAVITY_AUTO,
}

/** Pango gravity hints (PangoGravityHint). */
export enum PangoGravityHint {
  PANGO_GRAVITY_HINT_NATURAL,
  PANGO_GRAVITY_HINT_STRONG,
  PANGO_GRAVITY_HINT_LINE,
}

/** The character attributes of pango_get_log_attrs() (PangoLogAttr). */
export interface PangoLogAttr {
  is_line_break: boolean;
  is_mandatory_break: boolean;
  is_char_break: boolean;
  is_white: boolean;
  is_cursor_position: boolean;
  is_word_start: boolean;
  is_word_end: boolean;
  is_sentence_boundary: boolean;
  is_sentence_start: boolean;
  is_sentence_end: boolean;
  backspace_deletes_character: boolean;
  is_expandable_space: boolean;
  is_word_boundary: boolean;
}

export function emptyLogAttr(): PangoLogAttr {
  return {
    is_line_break: false,
    is_mandatory_break: false,
    is_char_break: false,
    is_white: false,
    is_cursor_position: false,
    is_word_start: false,
    is_word_end: false,
    is_sentence_boundary: false,
    is_sentence_start: false,
    is_sentence_end: false,
    backspace_deletes_character: false,
    is_expandable_space: false,
    is_word_boundary: false,
  };
}

/** Pango's PangoAnalysis subset. */
export interface PangoAnalysis {
  font: FontInstance;
  /** Bidi embedding level: odd is right to left. */
  level: number;
  gravity: PangoGravity;
  /** ISO 15924 script tag ("Latn"). */
  script: string;
  language: string;
  /** OpenType features in HarfBuzz syntax, comma separated. */
  features: string;
}

/** A run of text with constant analysis (PangoItem); offset and length in code points. */
export interface PangoItem {
  offset: number;
  length: number;
  analysis: PangoAnalysis;
}

/** One glyph of a shaped run (PangoGlyphInfo), in em units. */
export interface PangoGlyphInfo {
  glyph: number;
  width: number;
  x_offset: number;
  y_offset: number;
  is_cluster_start: boolean;
}

/** A shaped run (PangoGlyphString); log_clusters are code point indices relative to the run. */
export interface PangoGlyphString {
  glyphs: PangoGlyphInfo[];
  log_clusters: number[];
  num_glyphs: number;
}

/** The attributes of a range of the paragraph text (Pango attribute list). */
export interface PangoAttrRange {
  start: number;
  end: number;
  font: FontInstance;
  /** Faces for characters that font does not have (the fontset). */
  fallbacks: readonly FontInstance[];
  features: string;
  language: string;
}

/** Text orientation of vertical text (the gravity settings of the Pango context). */
export interface PangoGravitySettings {
  base_gravity: PangoGravity;
  gravity_hint: PangoGravityHint;
}

const HB_DIRECTION_LTR = 4;
const HB_DIRECTION_RTL = 5;
const HB_DIRECTION_TTB = 6;

function tagToString(tag: number): string {
  return String.fromCharCode((tag >>> 24) & 0xff, (tag >>> 16) & 0xff, (tag >>> 8) & 0xff, tag & 0xff);
}

/** Scripts whose natural orientation in vertical text is upright (pango_gravity_get_for_script). */
const VERTICAL_SCRIPTS = new Set(['Hani', 'Hira', 'Kana', 'Hang', 'Bopo', 'Yiii', 'Mong']);

/** East Asian Wide and Fullwidth characters (upright in mixed vertical text). */
function isWide(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0x303e) ||
    (c >= 0x3041 && c <= 0x33ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xa000 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x20000 && c <= 0x3fffd)
  );
}

const reWhite = /^\s$/u;
const reMark = /^\p{M}$/u;
const reControl = /^[\p{Cc}\p{Cf}]$/u;
const reWord = /^[\p{L}\p{N}\p{M}]$/u;
const reSentenceEnd = /^[.!?。！？]$/u;

function charOf(c: number): string {
  return String.fromCodePoint(c);
}

/**
 * Split a paragraph into items of constant direction, script, gravity and
 * font (pango_itemize_with_base_dir). A character the font of its range does
 * not have gets the first fallback face that has it.
 */
export function pango_itemize(
  backend: TextBackend | null,
  text: Uint32Array,
  rtl: boolean,
  attrs: readonly PangoAttrRange[],
  gravity: PangoGravitySettings,
): PangoItem[] {
  const n = text.length;
  if (!n) return [];
  const levels = backend ? backend.bidiLevels(text, rtl) : new Uint8Array(n).fill(rtl ? 1 : 0);

  // Scripts: Common and Inherited take the script of the text around them (Pango's script iterator).
  const scripts: string[] = backend
    ? Array.from(backend.scripts(text), tagToString)
    : new Array<string>(n).fill('Zyyy');
  let last = '';
  for (let i = 0; i < n; i++) {
    const s = scripts[i]!;
    if (s === 'Zyyy' || s === 'Zinh' || s === 'Zzzz') {
      if (last) scripts[i] = last;
    } else last = s;
  }
  const firstReal = scripts.find((s) => s !== 'Zyyy' && s !== 'Zinh' && s !== 'Zzzz') ?? 'Zyyy';
  for (let i = 0; i < n && (scripts[i] === 'Zyyy' || scripts[i] === 'Zinh' || scripts[i] === 'Zzzz'); i++) {
    scripts[i] = firstReal;
  }

  const gravities: PangoGravity[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (gravity.base_gravity === PangoGravity.PANGO_GRAVITY_AUTO) {
      gravities[i] = PangoGravity.PANGO_GRAVITY_SOUTH;
    } else if (gravity.gravity_hint === PangoGravityHint.PANGO_GRAVITY_HINT_STRONG) {
      gravities[i] = gravity.base_gravity;
    } else {
      // Natural: upright for the scripts that are written vertically and wide characters, sideways else.
      gravities[i] =
        VERTICAL_SCRIPTS.has(scripts[i]!) || isWide(text[i]!)
          ? gravity.base_gravity
          : PangoGravity.PANGO_GRAVITY_SOUTH;
    }
  }

  // Fonts, with fallback for missing glyphs.
  const fonts: FontInstance[] = new Array(n);
  const attrIndex: number[] = new Array(n);
  let a = 0;
  for (let i = 0; i < n; i++) {
    while (a < attrs.length - 1 && i >= attrs[a]!.end) a++;
    const attr = attrs[a]!;
    attrIndex[i] = a;
    const c = text[i]!;
    const ch = charOf(c);
    let font = attr.font;
    if (reMark.test(ch) || reControl.test(ch) || reWhite.test(ch)) {
      // Marks, joiners and spaces stay with the preceding character when it is in the same range.
      if (i > 0 && attrIndex[i - 1] === a && fonts[i - 1]!.MapUnicodeChar(c)) font = fonts[i - 1]!;
    } else if (font.face && !font.MapUnicodeChar(c)) {
      font = attr.fallbacks.find((f) => f.MapUnicodeChar(c)) ?? font;
    }
    fonts[i] = font;
  }

  const items: PangoItem[] = [];
  for (let i = 0; i < n; i++) {
    const prev = items.at(-1);
    const attr = attrs[attrIndex[i]!]!;
    if (
      prev &&
      prev.analysis.level === levels[i] &&
      prev.analysis.script === scripts[i] &&
      prev.analysis.gravity === gravities[i] &&
      prev.analysis.font === fonts[i] &&
      prev.analysis.features === attr.features &&
      prev.analysis.language === attr.language
    ) {
      prev.length++;
    } else {
      items.push({
        offset: i,
        length: 1,
        analysis: {
          font: fonts[i]!,
          level: levels[i]!,
          gravity: gravities[i]!,
          script: scripts[i]!,
          language: attr.language,
          features: attr.features,
        },
      });
    }
  }
  return items;
}

/**
 * The character attributes of a paragraph (pango_get_log_attrs): n + 1
 * entries, entry i describes the position before character i. Line breaks
 * from libunibreak (UAX #14), cursor positions from grapheme clusters and
 * words from UAX #29 word boundaries.
 */
export function pango_get_log_attrs(
  backend: TextBackend | null,
  text: Uint32Array,
  language: string,
): PangoLogAttr[] {
  const n = text.length;
  const attrs: PangoLogAttr[] = [];
  for (let i = 0; i <= n; i++) attrs.push(emptyLogAttr());
  let lines: Uint8Array;
  let graphemes: Uint8Array;
  let words: Uint8Array;
  if (backend) {
    lines = backend.lineBreaks(text, language);
    graphemes = backend.graphemeBreaks(text);
    words = backend.wordBreaks(text, language);
  } else {
    // Without the text module: breaks after white space and at every code point.
    lines = new Uint8Array(n);
    graphemes = new Uint8Array(n);
    words = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const ch = charOf(text[i]!);
      lines[i] = ch === '\n' ? 0 : reWhite.test(ch) && !reWhite.test(charOf(text[i + 1] ?? 0x41)) ? 1 : 2;
      words[i] = reWord.test(ch) === reWord.test(charOf(text[i + 1] ?? 0x20)) ? 1 : 0;
    }
    if (n) lines[n - 1] = 0;
  }
  for (let i = 0; i <= n; i++) {
    const at = attrs[i]!;
    const ch = i < n ? charOf(text[i]!) : '';
    const boundary = i === 0 || i === n || graphemes[i - 1] === 0;
    at.is_cursor_position = boundary;
    at.is_char_break = boundary;
    if (i > 0) {
      const brk = lines[i - 1]!;
      at.is_line_break = brk === 0 || brk === 1;
      at.is_mandatory_break = brk === 0;
    }
    at.is_white = ch !== '' && reWhite.test(ch);
    at.is_expandable_space = text[i] === 0x20 || text[i] === 0xa0;
    at.backspace_deletes_character = true;
    // Words: a word boundary where the following (preceding) segment is a word.
    const word_boundary = i === 0 || i === n || words[i - 1] === 0;
    at.is_word_boundary = word_boundary;
    if (word_boundary) {
      at.is_word_start = i < n && reWord.test(ch);
      at.is_word_end = i > 0 && reWord.test(charOf(text[i - 1]!));
    }
    // Sentences: at the start and end of the text and after sentence-final punctuation.
    const prev = i > 0 ? charOf(text[i - 1]!) : '';
    at.is_sentence_boundary = i === 0 || i === n || (reWhite.test(ch) && reSentenceEnd.test(prev));
    at.is_sentence_start = i === 0;
    at.is_sentence_end = i === n;
  }
  // Characters inside a grapheme cluster are not word starts (Pango requires cursor positions).
  for (let i = 0; i <= n; i++) {
    const at = attrs[i]!;
    if (!at.is_cursor_position) {
      at.is_word_start = false;
      at.is_word_end = false;
    }
  }
  return attrs;
}

/**
 * Shape the code points [start, start + length) of the paragraph text of an
 * item (pango_shape_full). Glyphs are in visual order (right to left text is
 * reversed by the caller as upstream does); log_clusters are relative to
 * start. Vertical (EAST gravity) runs are shaped top to bottom and rotated
 * as Pango does.
 */
export function pango_shape(
  text: Uint32Array,
  start: number,
  length: number,
  analysis: PangoAnalysis,
): PangoGlyphString {
  const font = analysis.font;
  const face = font.face;
  const glyphs: PangoGlyphInfo[] = [];
  const log_clusters: number[] = [];
  const vertical =
    analysis.gravity === PangoGravity.PANGO_GRAVITY_EAST ||
    analysis.gravity === PangoGravity.PANGO_GRAVITY_WEST;
  if (!face) {
    // Without a font: one glyph per code point.
    for (let i = 0; i < length; i++) {
      const c = text[start + i]!;
      glyphs.push({
        glyph: c === 0x0a ? PANGO_GLYPH_EMPTY : c,
        width: vertical ? font.Advance(c, true) : font.Advance(c, false),
        x_offset: 0,
        y_offset: 0,
        is_cluster_start: true,
      });
      log_clusters.push(i);
    }
    if (analysis.level & 1) {
      glyphs.reverse();
      log_clusters.reverse();
    }
    return { glyphs, log_clusters, num_glyphs: glyphs.length };
  }
  const direction = vertical ? HB_DIRECTION_TTB : analysis.level & 1 ? HB_DIRECTION_RTL : HB_DIRECTION_LTR;
  const out = face.shape(
    text,
    start,
    length,
    direction,
    analysis.script,
    analysis.language,
    analysis.features,
  );
  const scale = 1 / face.upem;
  let prevCluster = -1;
  for (let i = 0; i + 5 < out.length; i += 6) {
    const cluster = out[i + 1]! - start;
    const c = text[out[i + 1]!]!;
    const g: PangoGlyphInfo = {
      glyph: c === 0x0a || c === 0x0d ? PANGO_GLYPH_EMPTY : out[i]!,
      width: 0,
      x_offset: 0,
      y_offset: 0,
      is_cluster_start: cluster !== prevCluster,
    };
    if (vertical) {
      // 90 degrees rotation counter-clockwise.
      g.width = -out[i + 3]! * scale;
      g.x_offset = -out[i + 5]! * scale;
      g.y_offset = -out[i + 4]! * scale;
    } else {
      g.width = out[i + 2]! * scale;
      g.x_offset = out[i + 4]! * scale;
      g.y_offset = -out[i + 5]! * scale;
    }
    prevCluster = cluster;
    glyphs.push(g);
    log_clusters.push(cluster);
  }
  return { glyphs, log_clusters, num_glyphs: glyphs.length };
}
