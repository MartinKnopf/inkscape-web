// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/style-text.cpp, src/style-text.h
/*
 * Style interactions with libnrtype
 *
 * Copyright (C) 2018-2026 Authors
 */
import {
  FontFactory,
  type PangoFontDescription,
  PangoStretch,
  PangoStyle,
  pango_font_description_new,
} from './libnrtype/font-factory.ts';
import type { FontInstance } from './libnrtype/font-instance.ts';
import type { SPStyle } from './style.ts';
import { SPCSSFontStretch, SPCSSFontStyle, SPCSSFontVariant } from './style-enums.ts';

/** The font description of a computed style (upstream ink_font_description_from_style). */
export function ink_font_description_from_style(style: SPStyle): PangoFontDescription {
  const descr = pango_font_description_new(style.font_family.value() ?? 'sans-serif');

  switch (style.font_style.computed) {
    case SPCSSFontStyle.SP_CSS_FONT_STYLE_ITALIC:
      descr.style = PangoStyle.PANGO_STYLE_ITALIC;
      break;
    case SPCSSFontStyle.SP_CSS_FONT_STYLE_OBLIQUE:
      descr.style = PangoStyle.PANGO_STYLE_OBLIQUE;
      break;
    default:
      descr.style = PangoStyle.PANGO_STYLE_NORMAL;
      break;
  }

  // CSS now allows any value between 1 and 1000, including 1000.
  const weight = style.font_weight.computed;
  descr.weight = weight > 0 && weight <= 1000 ? weight : 400;

  switch (style.font_stretch.computed) {
    case SPCSSFontStretch.SP_CSS_FONT_STRETCH_ULTRA_CONDENSED:
      descr.stretch = PangoStretch.PANGO_STRETCH_ULTRA_CONDENSED;
      break;
    case SPCSSFontStretch.SP_CSS_FONT_STRETCH_EXTRA_CONDENSED:
      descr.stretch = PangoStretch.PANGO_STRETCH_EXTRA_CONDENSED;
      break;
    case SPCSSFontStretch.SP_CSS_FONT_STRETCH_CONDENSED:
      descr.stretch = PangoStretch.PANGO_STRETCH_CONDENSED;
      break;
    case SPCSSFontStretch.SP_CSS_FONT_STRETCH_SEMI_CONDENSED:
      descr.stretch = PangoStretch.PANGO_STRETCH_SEMI_CONDENSED;
      break;
    case SPCSSFontStretch.SP_CSS_FONT_STRETCH_SEMI_EXPANDED:
      descr.stretch = PangoStretch.PANGO_STRETCH_SEMI_EXPANDED;
      break;
    case SPCSSFontStretch.SP_CSS_FONT_STRETCH_EXPANDED:
      descr.stretch = PangoStretch.PANGO_STRETCH_EXPANDED;
      break;
    case SPCSSFontStretch.SP_CSS_FONT_STRETCH_EXTRA_EXPANDED:
      descr.stretch = PangoStretch.PANGO_STRETCH_EXTRA_EXPANDED;
      break;
    case SPCSSFontStretch.SP_CSS_FONT_STRETCH_ULTRA_EXPANDED:
      descr.stretch = PangoStretch.PANGO_STRETCH_ULTRA_EXPANDED;
      break;
    default:
      descr.stretch = PangoStretch.PANGO_STRETCH_NORMAL;
      break;
  }

  descr.variant = style.font_variant.computed === SPCSSFontVariant.SP_CSS_FONT_VARIANT_SMALL_CAPS ? 1 : 0;

  // Check if not empty as Pango will add @ to string even if empty (bug in Pango?).
  if (style.font_variation_settings.axes.size) {
    descr.variations = [...style.font_variation_settings.axes]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([tag, value]) => `${tag}=${value}`)
      .join(',');
  }
  return descr;
}

/** The face of a computed style (upstream ink_font_from_style). */
export function ink_font_from_style(style: SPStyle): FontInstance {
  // First try to use the font specification if it is set
  const spec = style.font_specification.set ? style.font_specification.value() : null;
  if (spec) return FontFactory.get().FaceFromFontSpecification(spec.replace(/^(['"])(.*)\1$/, '$2'));
  // If that failed, try using the CSS information in the style
  return FontFactory.get().Face(ink_font_description_from_style(style));
}
