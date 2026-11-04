// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/font-lister.cpp, src/libnrtype/font-lister.h
/*
 * Font selection widgets
 *
 * Authors:
 *   Chris Lahey <clahey@ximian.com>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Tavmjong Bah <tavmjong@free.fr>
 *   See Git history
 *
 * Copyright (C) 1999-2001 Ximian, Inc.
 * Copyright (C) 2002 Lauris Kaplinski
 * Copyright (C) 2013 Tavmjong Bah
 */
import {
  FontFactory,
  PangoStyle,
  pango_font_description_from_string,
  Signal,
  type SPCSSAttr,
  SPCSSFontStyle,
  type SPDocument,
  SPFlowtext,
  type SPObject,
  type SPStyle,
  SPText,
  spReprCssSetProperty,
} from '@inkscape-web/core';

/** The styles of a family without information from the system (upstream default_styles). */
const DEFAULT_STYLES = ['Normal', 'Italic', 'Bold', 'Bold Italic'];

/**
 * The fonts that every browser has: the CSS generic families and common
 * web-safe families. Upstream lists the fonts of the system (fontconfig).
 */
const WEB_FONTS = [
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'Arial',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];

/** Weight names of Pango font descriptions, by CSS weight. */
const WEIGHTS: readonly [number, string][] = [
  [100, 'Thin'],
  [200, 'Ultra-Light'],
  [300, 'Light'],
  [350, 'Semi-Light'],
  [380, 'Book'],
  [500, 'Medium'],
  [600, 'Semi-Bold'],
  [700, 'Bold'],
  [800, 'Ultra-Bold'],
  [900, 'Heavy'],
];

const STRETCHES = [
  'ultra-condensed',
  'extra-condensed',
  'condensed',
  'semi-condensed',
  'semi-expanded',
  'expanded',
  'extra-expanded',
  'ultra-expanded',
];

/** "Ultra-Condensed" for the CSS keyword "ultra-condensed". */
function stretchName(css: string): string {
  return css.replace(/(^|-)([a-z])/g, (_m, dash: string, c: string) => dash + c.toUpperCase());
}

/** A face of a local font (window.queryLocalFonts(), Local Font Access API). */
interface LocalFontData {
  family: string;
  style: string;
  blob(): Promise<Blob>;
}

/**
 * The font families and styles for the text toolbar and the Text and Font
 * dialog (upstream FontLister): the families used in the document first,
 * then the faces of the FontFactory (bundled fonts, font files), the web
 * fonts and, after loadLocalFonts(), the fonts of the system, which are
 * registered in the FontFactory for text layout.
 * Styles are Pango style strings ("Bold Italic") as upstream.
 * TODO: font collections, variable font named instances.
 */
export class FontLister {
  static #instance: FontLister | null = null;

  static get_instance(): FontLister {
    FontLister.#instance ??= new FontLister();
    return FontLister.#instance;
  }

  /** Emitted when the list of families changes. */
  readonly changedSignal = new Signal<[]>();
  #system_families = [...WEB_FONTS];
  #document_families: string[] = [];
  readonly #local_styles = new Map<string, string[]>();
  #local_loaded = false;

  constructor() {
    FontFactory.get().changedSignal.connect(() => this.changedSignal.emit());
  }

  /** The families: those of the document, then the system ones. */
  families(): string[] {
    const doc = new Set(this.#document_families);
    const system = [...new Set([...this.#system_families, ...FontFactory.get().GetUIFamilies()])].sort(
      (a, b) => a.localeCompare(b),
    );
    return [...this.#document_families, ...system.filter((f) => !doc.has(f))];
  }

  /** The number of document families at the start of families(). */
  documentFamilyCount(): number {
    return this.#document_families.length;
  }

  /** The styles of family (the local font faces if known, else the default styles). */
  styles(family: string): string[] {
    const faces = FontFactory.get().GetUIStyles(family);
    if (faces.length) return [...new Set(faces.map((s) => s.css_name))];
    return this.#local_styles.get(family) ?? DEFAULT_STYLES;
  }

  /** Collect the families used by the text in document (upstream update_font_list). */
  add_document_fonts_at_top(document: SPDocument | null): void {
    const found = new Set<string>();
    const walk = (o: SPObject) => {
      if (o.style.font_family.set) {
        const family = o.style.font_family.value();
        if (family) found.add(family);
      }
      for (const child of o.children) walk(child);
    };
    if (document) walk(document.getRoot());
    const list = [...found].sort((a, b) => a.localeCompare(b));
    if (list.join('\n') !== this.#document_families.join('\n')) {
      this.#document_families = list;
      this.changedSignal.emit();
    }
  }

  /**
   * Add the fonts of the system with the Local Font Access API, if the
   * browser has it and the user allows it. Needs a user gesture the first
   * time. Returns whether fonts were loaded.
   */
  async loadLocalFonts(): Promise<boolean> {
    if (this.#local_loaded) return true;
    const query = (globalThis as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
    if (!query) return false;
    try {
      const fonts = await query();
      const factory = FontFactory.get();
      for (const f of fonts) {
        const styles = this.#local_styles.get(f.family) ?? [];
        const style = f.style === 'Regular' ? 'Normal' : f.style;
        if (!styles.includes(style)) styles.push(style);
        this.#local_styles.set(f.family, styles);
        // The face for text layout: its data is read when a text uses it.
        const descr = pango_font_description_from_string(style);
        factory.addFontSource({
          family: f.family,
          style: descr.style,
          weight: descr.weight,
          stretch: descr.stretch,
          display_name: f.style,
          load: async () => new Uint8Array(await (await f.blob()).arrayBuffer()),
        });
      }
      const families = new Set([...WEB_FONTS, ...this.#local_styles.keys()]);
      this.#system_families = [...families].sort((a, b) => a.localeCompare(b));
      this.#local_loaded = true;
      this.changedSignal.emit();
      return true;
    } catch {
      return false; // not allowed
    }
  }

  /**
   * Add the faces of a font file to the FontFactory (for text layout) and to
   * document.fonts (FontFace API, for the font list and the preview).
   * Returns the families of the file.
   */
  async addFontFile(bytes: Uint8Array): Promise<string[]> {
    const factory = FontFactory.get();
    const families = factory.addFontFile(bytes);
    const fonts = (globalThis as { document?: Document }).document?.fonts;
    if (fonts) {
      for (const family of families) {
        for (const style of factory.GetUIStyles(family)) {
          const d = pango_font_description_from_string(style.css_name);
          const face = new FontFace(family, bytes.slice().buffer, {
            weight: String(d.weight),
            style:
              d.style === PangoStyle.PANGO_STYLE_ITALIC
                ? 'italic'
                : d.style === PangoStyle.PANGO_STYLE_OBLIQUE
                  ? 'oblique'
                  : 'normal',
          });
          fonts.add(face);
          void face.load().catch(() => {});
        }
      }
    }
    this.changedSignal.emit();
    return families;
  }

  /**
   * The style string of a computed style (upstream fontspec_from_style
   * without the family): weight, stretch and slant names, or "Normal".
   */
  style_from_style(style: SPStyle): string {
    const parts: string[] = [];
    const stretch =
      style.font_stretch.enums.find((e) => e.value === style.font_stretch.computed)?.key ?? 'normal';
    if (stretch !== 'normal') parts.push(stretchName(stretch));
    const weight = style.font_weight.computed;
    const name = WEIGHTS.find(([w]) => w === weight)?.[1];
    if (name) parts.push(name);
    if (style.font_style.computed === SPCSSFontStyle.SP_CSS_FONT_STYLE_ITALIC) parts.push('Italic');
    else if (style.font_style.computed === SPCSSFontStyle.SP_CSS_FONT_STYLE_OBLIQUE) parts.push('Oblique');
    return parts.length ? parts.join(' ') : 'Normal';
  }

  /** The family of a computed style, unquoted ("DejaVu Sans, sans-serif"). */
  family_from_style(style: SPStyle): string {
    return style.font_family.value() ?? 'sans-serif';
  }

  /**
   * Set font-family, font-weight, font-style, font-stretch, font-variant and
   * -inkscape-font-specification of css for family and style (upstream fill_css).
   */
  fill_css(css: SPCSSAttr, family: string, style: string): void {
    const fontspec = style && style !== 'Normal' ? `${family} ${style}` : family;
    spReprCssSetProperty(css, '-inkscape-font-specification', `'${fontspec.replace(/'/g, "\\'")}'`);
    spReprCssSetProperty(css, 'font-family', css_font_family_quote(family));

    const words = style.split(/[\s,]+/).map((w) => w.toLowerCase());
    let weight = 'normal';
    for (const [w, name] of WEIGHTS) if (words.includes(name.toLowerCase())) weight = String(w);
    if (weight === '700') weight = 'bold';
    spReprCssSetProperty(css, 'font-weight', weight);
    spReprCssSetProperty(
      css,
      'font-style',
      words.includes('italic') ? 'italic' : words.includes('oblique') ? 'oblique' : 'normal',
    );
    spReprCssSetProperty(css, 'font-stretch', STRETCHES.find((s) => words.includes(s)) ?? 'normal');
    spReprCssSetProperty(css, 'font-variant', words.includes('small-caps') ? 'small-caps' : 'normal');
  }
}

/** Quote the family names of a font-family list that need it (upstream css_font_family_quote). */
export function css_font_family_quote(family: string): string {
  const generic = new Set([
    'serif',
    'sans-serif',
    'cursive',
    'fantasy',
    'monospace',
    'system-ui',
    'math',
    'emoji',
  ]);
  return family
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => (/^['"]/.test(f) || generic.has(f) || /^[A-Za-z_-][\w-]*$/.test(f) ? f : `'${f}'`))
    .join(', ');
}

/** Whether item is a text or flowed text (for the text toolbar and dialog). */
export function isTextObject(item: SPObject | null): item is SPText | SPFlowtext {
  return item instanceof SPText || item instanceof SPFlowtext;
}
