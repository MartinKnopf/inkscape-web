// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/font-factory.cpp, src/libnrtype/font-factory.h
/*
 * Authors:
 *   fred
 *   bulia byak <buliabyak@users.sf.net>
 *
 * Copyright (C) 2018 Authors
 */
import { Signal } from '../util/signal.ts';
import { type FontFaceBackend, FontInstance } from './font-instance.ts';

/** Pango font styles (PangoStyle). */
export enum PangoStyle {
  PANGO_STYLE_NORMAL,
  PANGO_STYLE_OBLIQUE,
  PANGO_STYLE_ITALIC,
}

/** Pango font stretches (PangoStretch). */
export enum PangoStretch {
  PANGO_STRETCH_ULTRA_CONDENSED,
  PANGO_STRETCH_EXTRA_CONDENSED,
  PANGO_STRETCH_CONDENSED,
  PANGO_STRETCH_SEMI_CONDENSED,
  PANGO_STRETCH_NORMAL,
  PANGO_STRETCH_SEMI_EXPANDED,
  PANGO_STRETCH_EXPANDED,
  PANGO_STRETCH_EXTRA_EXPANDED,
  PANGO_STRETCH_ULTRA_EXPANDED,
}

/** The fields of a PangoFontDescription that libnrtype uses. */
export interface PangoFontDescription {
  /** Family list as in CSS font-family ("'DejaVu Sans', sans-serif"). */
  family: string;
  style: PangoStyle;
  /** 1 to 1000. */
  weight: number;
  stretch: PangoStretch;
  /** 0 normal, 1 small-caps (PangoVariant). */
  variant: number;
  /** Font variations ("wght=700,wdth=80"), '' for none. */
  variations: string;
}

export function pango_font_description_new(family = 'sans-serif'): PangoFontDescription {
  return {
    family,
    style: PangoStyle.PANGO_STYLE_NORMAL,
    weight: 400,
    stretch: PangoStretch.PANGO_STRETCH_NORMAL,
    variant: 0,
    variations: '',
  };
}

/** The family of a font description (upstream sp_font_description_get_family). */
export function sp_font_description_get_family(descr: PangoFontDescription): string {
  return descr.family;
}

/**
 * Text processing that upstream gets from Pango, FriBidi, HarfBuzz and
 * FreeType: font faces from font file data, and Unicode properties of code
 * points. Implemented by the text module of @inkscape-web/wasm (loadText()).
 */
export interface TextBackend {
  /** Number of faces in a font file (collections have more than one). */
  faceCount(bytes: Uint8Array): number;
  /** A face of a font file, null if the data is not a font. */
  createFace(bytes: Uint8Array, index: number): FontFaceBackend | null;
  /** hb_script_t of each code point (ISO 15924 tags as HarfBuzz tags). */
  scripts(codepoints: Uint32Array): Uint32Array;
  /** FriBidi embedding level of each code point for a paragraph of the given base direction. */
  bidiLevels(codepoints: Uint32Array, rtl: boolean): Uint8Array;
  /** libunibreak line breaks after each code point (0 must, 1 allow, 2 no). */
  lineBreaks(codepoints: Uint32Array, language: string): Uint8Array;
  /** libunibreak word breaks after each code point (0 break, 1 no break). */
  wordBreaks(codepoints: Uint32Array, language: string): Uint8Array;
  /** libunibreak grapheme breaks after each code point (0 break, 1 no break). */
  graphemeBreaks(codepoints: Uint32Array): Uint8Array;
}

/** A font face that can be loaded (a bundled font, a system font or a font file). */
export interface FontSource {
  /** CSS family name. */
  family: string;
  style: PangoStyle;
  weight: number;
  stretch: PangoStretch;
  /** The style as the font designer named it (upstream StyleNames.display_name). */
  display_name: string;
  /** Face index in a font collection. */
  index?: number;
  /** The font file data. */
  load(): Promise<Uint8Array>;
}

/** Style names of a face (upstream StyleNames). */
export interface StyleNames {
  /** Style as Pango/CSS would write it. */
  css_name: string;
  /** Style as Font designer named it. */
  display_name: string;
}

interface SourceState {
  source: FontSource;
  face: FontFaceBackend | null;
  loading: Promise<void> | null;
  failed: boolean;
}

/**
 * Families that are replaced when they are not installed, as fontconfig
 * does on Linux: the CSS generic families and common Windows/Mac fonts map
 * to the bundled DejaVu fonts.
 */
const SUBSTITUTES: Record<string, string> = {
  'sans-serif': 'DejaVu Sans',
  sans: 'DejaVu Sans',
  'system-ui': 'DejaVu Sans',
  cursive: 'DejaVu Sans',
  fantasy: 'DejaVu Sans',
  arial: 'DejaVu Sans',
  helvetica: 'DejaVu Sans',
  verdana: 'DejaVu Sans',
  tahoma: 'DejaVu Sans',
  'trebuchet ms': 'DejaVu Sans',
  'bitstream vera sans': 'DejaVu Sans',
  serif: 'DejaVu Serif',
  times: 'DejaVu Serif',
  'times new roman': 'DejaVu Serif',
  georgia: 'DejaVu Serif',
  'bitstream vera serif': 'DejaVu Serif',
  monospace: 'DejaVu Sans Mono',
  mono: 'DejaVu Sans Mono',
  courier: 'DejaVu Sans Mono',
  'courier new': 'DejaVu Sans Mono',
  'bitstream vera sans mono': 'DejaVu Sans Mono',
};

/** The shear of a synthesized oblique face (the fontconfig matrix for synthetic italics). */
const SYNTHETIC_SLANT = 0.2;

/** Split a CSS font-family list into unquoted names. */
export function split_font_family_list(family: string): string[] {
  return family
    .split(',')
    .map((f) => f.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter(Boolean);
}

/**
 * Finds and creates the fonts of text (upstream FontFactory). Upstream asks
 * fontconfig through Pango; here the faces are registered FontSources (the
 * bundled fonts, the system fonts of the Local Font Access API and font
 * files) and the font data is loaded on demand. Face() is synchronous: a
 * face that is not loaded yet starts loading and a loaded face of the same
 * family (or the fallback) is used meanwhile; changedSignal tells when the
 * text must be laid out again.
 */
export class FontFactory {
  static #instance: FontFactory | null = null;

  static get(): FontFactory {
    FontFactory.#instance ??= new FontFactory();
    return FontFactory.#instance;
  }

  /** Upstream creates all fonts at this size to stop hinting; here all values are in em units. */
  static readonly fontSize = 512;

  backend: TextBackend | null = null;
  /** Emitted when faces were loaded or added: text must be laid out again. */
  readonly changedSignal = new Signal<[]>();
  readonly #sources: SourceState[] = [];
  readonly #loaded = new Map<string, FontInstance>();
  readonly #pending = new Set<Promise<void>>();
  #emitScheduled = false;

  /** Set the text module; existing layouts must be recalculated. */
  setBackend(backend: TextBackend | null): void {
    this.backend = backend;
    for (const s of this.#sources) s.face = null;
    this.#loaded.clear();
  }

  /** Register a face. Sources with the same family and style replace each other. */
  addFontSource(source: FontSource): void {
    const i = this.#sources.findIndex(
      (s) =>
        s.source.family.toLowerCase() === source.family.toLowerCase() &&
        s.source.style === source.style &&
        s.source.weight === source.weight &&
        s.source.stretch === source.stretch,
    );
    const state: SourceState = { source, face: null, loading: null, failed: false };
    if (i >= 0) this.#sources[i] = state;
    else this.#sources.push(state);
    this.#loaded.clear();
    this.#scheduleChanged();
  }

  /**
   * Add all faces of a font file (upstream AddFontFile), with family and
   * style from its name table. Returns the families.
   */
  addFontFile(bytes: Uint8Array): string[] {
    const backend = this.backend;
    if (!backend) return [];
    const families = new Set<string>();
    const count = Math.max(1, backend.faceCount(bytes));
    for (let index = 0; index < count; index++) {
      const face = backend.createFace(bytes, index);
      if (!face) continue;
      const tmp = new FontInstance(pango_font_description_new(), face);
      const family = face.name(16) || face.name(1);
      const subfamily = face.name(17) || face.name(2) || 'Regular';
      const os2 = face.table('OS/2');
      const weight = os2.length >= 6 ? (os2[4]! << 8) | os2[5]! : 400;
      const width = os2.length >= 8 ? (os2[6]! << 8) | os2[7]! : 5;
      const style = /italic/i.test(subfamily)
        ? PangoStyle.PANGO_STYLE_ITALIC
        : tmp.is_oblique()
          ? PangoStyle.PANGO_STYLE_OBLIQUE
          : PangoStyle.PANGO_STYLE_NORMAL;
      const state: SourceState = {
        source: {
          family,
          style,
          weight: weight || 400,
          stretch: Math.min(8, Math.max(0, width - 1)) as PangoStretch,
          display_name: subfamily,
          index,
          load: async () => bytes,
        },
        face,
        loading: null,
        failed: false,
      };
      this.#sources.push(state);
      families.add(family);
    }
    this.#loaded.clear();
    this.#scheduleChanged();
    return [...families];
  }

  /** Wait for the faces that are loading. */
  async whenLoaded(): Promise<void> {
    while (this.#pending.size) await Promise.all([...this.#pending]);
  }

  /** Load the face that matches descr now (for example before the first document is shown). */
  async preload(descr: PangoFontDescription): Promise<void> {
    const state = this.#match(descr, false);
    if (state) await this.#load(state);
  }

  /** Whether a family is available, without substitution (upstream hasFontFamily). */
  hasFontFamily(family: string): boolean {
    const f = family.toLowerCase();
    return this.#sources.some((s) => s.source.family.toLowerCase() === f);
  }

  /** The families of the registered faces, sorted (upstream GetUIFamilies). */
  GetUIFamilies(): string[] {
    return [...new Set(this.#sources.map((s) => s.source.family))].sort((a, b) => a.localeCompare(b));
  }

  /** The styles of a family (upstream GetUIStyles). */
  GetUIStyles(family: string): StyleNames[] {
    const f = family.toLowerCase();
    const styles = this.#sources
      .filter((s) => s.source.family.toLowerCase() === f)
      .map((s) => s.source)
      .sort((a, b) => a.stretch - b.stretch || a.weight - b.weight || a.style - b.style);
    return styles.map((s) => ({ css_name: pango_style_string(s), display_name: s.display_name }));
  }

  /** The face of a font description (upstream Face). Falls back to sans-serif. */
  Face(descr: PangoFontDescription): FontInstance {
    const key = font_description_key(descr);
    const cached = this.#loaded.get(key);
    if (cached) return cached;
    const wanted = this.#match(descr, false);
    let state = wanted;
    if (wanted && !wanted.face) {
      void this.#load(wanted);
      state = this.#match(descr, true);
    }
    const synthetic =
      descr.style !== PangoStyle.PANGO_STYLE_NORMAL && state?.source.style === PangoStyle.PANGO_STYLE_NORMAL
        ? SYNTHETIC_SLANT
        : 0;
    let face = state?.face ?? null;
    if (face && descr.variations) face = face.withVariations(descr.variations);
    const font = new FontInstance(descr, face, synthetic);
    // Only cache final results: a face that is still loading replaces the stand-in later.
    if (!wanted || wanted === state) this.#loaded.set(key, font);
    return font;
  }

  /** The face of a family and a Pango style string ("Bold Italic") (upstream FaceFromDescr). */
  FaceFromDescr(family: string, style: string): FontInstance {
    const descr = pango_font_description_from_string(style);
    descr.family = family;
    return this.Face(descr);
  }

  /** The face of a font specification ("DejaVu Sans Bold") (upstream FaceFromFontSpecification). */
  FaceFromFontSpecification(fontSpecification: string): FontInstance {
    return this.Face(pango_font_description_from_string(fontSpecification));
  }

  /**
   * Faces to use for characters that the face of descr does not have, in
   * order (Pango's fontset): the faces of the other families of the list,
   * then the bundled families.
   */
  fallbackFaces(descr: PangoFontDescription): FontInstance[] {
    const out: FontInstance[] = [];
    const families = [
      ...split_font_family_list(descr.family),
      'DejaVu Sans',
      'DejaVu Serif',
      'DejaVu Sans Mono',
    ];
    const seen = new Set<string>();
    for (const family of families) {
      const resolved = this.#resolveFamily(family);
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      const f = this.Face({ ...descr, family: resolved });
      if (f.face) out.push(f);
    }
    return out;
  }

  /** The family of the registered faces for a name, with substitution; null if none. */
  #resolveFamily(name: string): string | null {
    const lower = name.toLowerCase();
    const direct = this.#sources.find((s) => s.source.family.toLowerCase() === lower);
    if (direct) return direct.source.family;
    const substitute = SUBSTITUTES[lower];
    if (substitute && this.hasFontFamily(substitute)) return substitute;
    return null;
  }

  /**
   * The best face for descr (fontconfig / CSS font matching): the first
   * available family of the list (else sans-serif), then style, stretch and
   * weight. loadedOnly: only faces that are loaded.
   */
  #match(descr: PangoFontDescription, loadedOnly: boolean): SourceState | null {
    const usable = (s: SourceState) => !s.failed && (!loadedOnly || !!s.face);
    let family: string | null = null;
    for (const name of split_font_family_list(descr.family)) {
      family = this.#resolveFamily(name);
      if (family && this.#sources.some((s) => s.source.family === family && usable(s))) break;
      family = null;
    }
    family ??= this.#resolveFamily('sans-serif');
    let candidates = family ? this.#sources.filter((s) => s.source.family === family && usable(s)) : [];
    if (!candidates.length) candidates = this.#sources.filter(usable);
    if (!candidates.length) return null;

    // Style: italic → italic, oblique, normal; oblique → oblique, italic, normal; normal → normal, oblique, italic.
    const styleOrder =
      descr.style === PangoStyle.PANGO_STYLE_ITALIC
        ? [PangoStyle.PANGO_STYLE_ITALIC, PangoStyle.PANGO_STYLE_OBLIQUE, PangoStyle.PANGO_STYLE_NORMAL]
        : descr.style === PangoStyle.PANGO_STYLE_OBLIQUE
          ? [PangoStyle.PANGO_STYLE_OBLIQUE, PangoStyle.PANGO_STYLE_ITALIC, PangoStyle.PANGO_STYLE_NORMAL]
          : [PangoStyle.PANGO_STYLE_NORMAL, PangoStyle.PANGO_STYLE_OBLIQUE, PangoStyle.PANGO_STYLE_ITALIC];
    for (const st of styleOrder) {
      const byStyle = candidates.filter((s) => s.source.style === st);
      if (byStyle.length) {
        candidates = byStyle;
        break;
      }
    }
    // Stretch: the nearest.
    const bestStretch = Math.min(...candidates.map((s) => Math.abs(s.source.stretch - descr.stretch)));
    candidates = candidates.filter((s) => Math.abs(s.source.stretch - descr.stretch) === bestStretch);
    // Weight (CSS Fonts 4 font matching).
    const w = descr.weight;
    const rank = (sw: number): number => {
      if (sw === w) return 0;
      if (w >= 400 && w <= 500) {
        if (sw > w && sw <= 500) return sw - w;
        if (sw < w) return 1000 + (w - sw);
        return 2000 + sw;
      }
      if (w < 400) return sw < w ? w - sw : 1000 + sw;
      return sw > w ? sw - w : 1000 + (w - sw);
    };
    candidates.sort((a, b) => rank(a.source.weight) - rank(b.source.weight));
    return candidates[0] ?? null;
  }

  /** Load the data of a face. */
  #load(state: SourceState): Promise<void> {
    if (state.face || state.failed) return Promise.resolve();
    if (!state.loading) {
      const p: Promise<void> = state.source
        .load()
        .then((bytes) => {
          const face = this.backend?.createFace(bytes, state.source.index ?? 0) ?? null;
          if (!face) state.failed = true;
          state.face = face;
        })
        .catch(() => {
          state.failed = true;
        })
        .finally(() => {
          state.loading = null;
          this.#pending.delete(p);
          this.#loaded.clear();
          this.#scheduleChanged();
        });
      state.loading = p;
      this.#pending.add(p);
    }
    return state.loading;
  }

  #scheduleChanged(): void {
    if (this.#emitScheduled) return;
    this.#emitScheduled = true;
    queueMicrotask(() => {
      this.#emitScheduled = false;
      this.changedSignal.emit();
    });
  }
}

/** A stable key of the fields that select a face. */
function font_description_key(d: PangoFontDescription): string {
  return [d.family, d.style, d.weight, d.stretch, d.variant, d.variations].join('|');
}

/** Pango weight names (pango_font_description_to_string), by weight. */
export const PANGO_WEIGHT_NAMES: readonly [number, string][] = [
  [100, 'Thin'],
  [200, 'Ultra-Light'],
  [300, 'Light'],
  [350, 'Semi-Light'],
  [380, 'Book'],
  [400, 'Normal'],
  [500, 'Medium'],
  [600, 'Semi-Bold'],
  [700, 'Bold'],
  [800, 'Ultra-Bold'],
  [900, 'Heavy'],
  [1000, 'Ultra-Heavy'],
];

const STRETCH_NAMES = [
  'Ultra-Condensed',
  'Extra-Condensed',
  'Condensed',
  'Semi-Condensed',
  'Normal',
  'Semi-Expanded',
  'Expanded',
  'Extra-Expanded',
  'Ultra-Expanded',
];

/** The style part of pango_font_description_to_string ("Semi-Condensed Bold Italic", or "Normal"). */
export function pango_style_string(d: Pick<PangoFontDescription, 'style' | 'weight' | 'stretch'>): string {
  const parts: string[] = [];
  if (d.stretch !== PangoStretch.PANGO_STRETCH_NORMAL) parts.push(STRETCH_NAMES[d.stretch]!);
  if (d.weight !== 400) {
    parts.push(PANGO_WEIGHT_NAMES.find(([w]) => w === d.weight)?.[1] ?? `${d.weight}`);
  }
  if (d.style === PangoStyle.PANGO_STYLE_ITALIC) parts.push('Italic');
  else if (d.style === PangoStyle.PANGO_STYLE_OBLIQUE) parts.push('Oblique');
  return parts.length ? parts.join(' ') : 'Normal';
}

/**
 * Parse a Pango font description string ("DejaVu Sans Bold Italic",
 * "Sans, Condensed 12"): style words at the end, the rest is the family.
 */
export function pango_font_description_from_string(str: string): PangoFontDescription {
  const descr = pango_font_description_new('');
  const words = str.trim().split(/\s+/).filter(Boolean);
  // A trailing size is ignored.
  if (words.length && /^\d+(\.\d+)?(px)?$/.test(words.at(-1)!)) words.pop();
  while (words.length) {
    const w = words.at(-1)!.replace(/,$/, '');
    const lower = w.toLowerCase();
    const weight = PANGO_WEIGHT_NAMES.find(([, n]) => n.toLowerCase() === lower);
    const stretch = STRETCH_NAMES.findIndex((n) => n.toLowerCase() === lower);
    if (lower === 'italic') descr.style = PangoStyle.PANGO_STYLE_ITALIC;
    else if (lower === 'oblique') descr.style = PangoStyle.PANGO_STYLE_OBLIQUE;
    else if (lower === 'small-caps') descr.variant = 1;
    else if (lower === 'regular' || lower === 'roman') {
      // normal
    } else if (weight) descr.weight = weight[0];
    else if (lower === 'semibold' || lower === 'demibold') descr.weight = 600;
    else if (lower === 'extrabold' || lower === 'ultrabold') descr.weight = 800;
    else if (lower === 'extralight' || lower === 'ultralight') descr.weight = 200;
    else if (lower === 'black') descr.weight = 900;
    else if (stretch >= 0 && lower !== 'normal') descr.stretch = stretch as PangoStretch;
    else if (lower === 'normal') {
      // normal
    } else break;
    words.pop();
  }
  descr.family = words.join(' ').replace(/,$/, '') || 'sans-serif';
  return descr;
}
