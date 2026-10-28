// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/font-instance.h interim: an injected measurer replaces FreeType/Pango metrics
/*
 * Authors:
 *   fred
 *   bulia byak <buliabyak@users.sf.net>
 *
 * Copyright (C) 2018 Authors
 */

import type { SPStyle } from '../style.ts';
import { SPCSSFontStyle } from '../style-enums.ts';

/** The font of a run of text, from the computed style (the CSS font properties). */
export interface FontDescription {
  /** CSS font-family list, as in the style ("'DejaVu Sans', sans-serif"). */
  family: string;
  /** Font size in px. */
  size: number;
  /** Numeric weight, 100 to 900. */
  weight: number;
  style: 'normal' | 'italic' | 'oblique';
  /** CSS font-stretch keyword ("normal", "condensed", ...). */
  stretch: string;
  /** CSS font-variant keyword ("normal", "small-caps"). */
  variant: string;
}

/** Ink box of a cluster relative to its origin on the baseline, in px (y up). */
export interface InkBox {
  left: number;
  right: number;
  ascent: number;
  descent: number;
}

/**
 * Measures text for the interim layout (see Layout-TNG-Compute.ts). The
 * editor sets a measurer based on Canvas 2D measureText; tests and Node use
 * FixedWidthTextMeasurer. The planned HarfBuzz port of Layout-TNG replaces it.
 */
export interface TextMeasurer {
  /** Typographic ascent and descent of the font in px (descent positive). */
  fontMetrics(font: FontDescription): { ascent: number; descent: number; xheight: number };
  /** Advance width of a cluster (one or more code points) in px. */
  advance(text: string, font: FontDescription): number;
  /** Ink box of a cluster, or null if the measurer cannot tell (the em box is used then). */
  inkBox(text: string, font: FontDescription): InkBox | null;
}

/**
 * A measurer without fonts: each cluster is half an em wide, ascent 0.8 em,
 * descent 0.2 em (the defaults of upstream FontInstance). For tests and
 * environments without Canvas 2D.
 */
export class FixedWidthTextMeasurer implements TextMeasurer {
  constructor(readonly advance_em = 0.5) {}
  fontMetrics(font: FontDescription): { ascent: number; descent: number; xheight: number } {
    return { ascent: 0.8 * font.size, descent: 0.2 * font.size, xheight: 0.5 * font.size };
  }
  advance(_text: string, font: FontDescription): number {
    return this.advance_em * font.size;
  }
  inkBox(): InkBox | null {
    return null;
  }
}

let measurer: TextMeasurer = new FixedWidthTextMeasurer();

/** The measurer used by text layout. */
export function getTextMeasurer(): TextMeasurer {
  return measurer;
}

/** Set the measurer used by text layout (the editor installs a Canvas 2D measurer). */
export function setTextMeasurer(m: TextMeasurer): void {
  measurer = m;
}

/** The font of a computed style (upstream ink_font_from_style, with a description instead of a FontInstance). */
export function ink_font_from_style(style: SPStyle): FontDescription {
  const fontStyle = style.font_style.computed;
  return {
    family: style.font_family.getValue() || 'sans-serif',
    size: style.font_size.computed,
    weight: style.font_weight.computed,
    style:
      fontStyle === SPCSSFontStyle.SP_CSS_FONT_STYLE_ITALIC
        ? 'italic'
        : fontStyle === SPCSSFontStyle.SP_CSS_FONT_STYLE_OBLIQUE
          ? 'oblique'
          : 'normal',
    stretch: enumKey(style.font_stretch.enums, style.font_stretch.computed),
    variant: enumKey(style.font_variant.enums, style.font_variant.computed),
  };
}

function enumKey(enums: readonly { key: string; value: number }[], value: number): string {
  return enums.find((e) => e.value === value)?.key ?? 'normal';
}
