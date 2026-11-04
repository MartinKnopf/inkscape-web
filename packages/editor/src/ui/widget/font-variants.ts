// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/font-variants.cpp, src/ui/widget/font-variants.h, src/ui/widget/font-variations.cpp, src/ui/widget/font-variations.h
/*
 * Author:
 *   Tavmjong Bah <tavmjong@free.fr>
 *
 * Copyright (C) 2015, 2018 Tavmong Bah
 */
import {
  type FontInstance,
  type SPCSSAttr,
  SPCSSFontVariantCaps,
  SPCSSFontVariantLigatures,
  SPCSSFontVariantNumeric,
  SPCSSFontVariantPosition,
  type SPStyle,
  spReprCssSetProperty,
  spReprCssUnsetProperty,
} from '@inkscape-web/core';

/** The settings of the Features tab of the Text and Font dialog (upstream FontVariants widgets). */
export interface FontVariantsState {
  ligatures_common: boolean;
  ligatures_discretionary: boolean;
  ligatures_historical: boolean;
  ligatures_contextual: boolean;
  position: 'normal' | 'sub' | 'super';
  caps: 'normal' | 'small' | 'all_small' | 'petite' | 'all_petite' | 'unicase' | 'titling';
  numeric_style: 'default' | 'lining' | 'old_style';
  numeric_width: 'default' | 'proportional' | 'tabular';
  numeric_fractions: 'default' | 'diagonal' | 'stacked';
  numeric_ordinal: boolean;
  numeric_slashed_zero: boolean;
  /** Values of the OpenType tables that have their own control (ss01, salt, ...), 0 is off. */
  features: Record<string, number>;
  /** Feature settings in CSS form of the other tables (e.g. "wxyz" or "wxyz" 3). */
  feature_entry: string;
  /** font-variation-settings axis values (upstream FontVariations). */
  variations: Record<string, number>;
}

/** Whether the OpenType tables of a style feature exist, and the tables that get their own control. */
export interface FontVariantsAvailable {
  ligatures_common: boolean;
  ligatures_discretionary: boolean;
  ligatures_historical: boolean;
  ligatures_contextual: boolean;
  position_sub: boolean;
  position_super: boolean;
  caps_small: boolean;
  caps_all_small: boolean;
  caps_petite: boolean;
  caps_all_petite: boolean;
  caps_unicase: boolean;
  caps_titling: boolean;
  numeric_lining: boolean;
  numeric_old_style: boolean;
  numeric_proportional: boolean;
  numeric_tabular: boolean;
  numeric_diagonal: boolean;
  numeric_stacked: boolean;
  numeric_ordinal: boolean;
  numeric_slashed_zero: boolean;
  /** Style tables (stylistic sets, alternates, swashes...) with the characters they change. */
  tables: { tag: string; input: string; output: string }[];
  /** Variation axes of the font. */
  axes: { tag: string; name: string; minimum: number; def: number; maximum: number }[];
}

/** Read the feature settings of a (queried) style (upstream FontVariants::update). */
export function font_variants_from_style(query: SPStyle, font: FontInstance | null): FontVariantsState {
  const lig = query.font_variant_ligatures.computed;
  const pos = query.font_variant_position.computed;
  const caps = query.font_variant_caps.computed;
  const num = query.font_variant_numeric.computed;
  const state: FontVariantsState = {
    ligatures_common: !!(lig & SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_COMMON),
    ligatures_discretionary: !!(lig & SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_DISCRETIONARY),
    ligatures_historical: !!(lig & SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_HISTORICAL),
    ligatures_contextual: !!(lig & SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_CONTEXTUAL),
    position:
      pos & SPCSSFontVariantPosition.SP_CSS_FONT_VARIANT_POSITION_SUB
        ? 'sub'
        : pos & SPCSSFontVariantPosition.SP_CSS_FONT_VARIANT_POSITION_SUPER
          ? 'super'
          : 'normal',
    caps:
      caps & SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_SMALL
        ? 'small'
        : caps & SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_ALL_SMALL
          ? 'all_small'
          : caps & SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_PETITE
            ? 'petite'
            : caps & SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_ALL_PETITE
              ? 'all_petite'
              : caps & SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_UNICASE
                ? 'unicase'
                : caps & SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_TITLING
                  ? 'titling'
                  : 'normal',
    numeric_style:
      num & SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_LINING_NUMS
        ? 'lining'
        : num & SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_OLDSTYLE_NUMS
          ? 'old_style'
          : 'default',
    numeric_width:
      num & SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_PROPORTIONAL_NUMS
        ? 'proportional'
        : num & SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_TABULAR_NUMS
          ? 'tabular'
          : 'default',
    numeric_fractions:
      num & SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_DIAGONAL_FRACTIONS
        ? 'diagonal'
        : num & SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_STACKED_FRACTIONS
          ? 'stacked'
          : 'default',
    numeric_ordinal: !!(num & SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_ORDINAL),
    numeric_slashed_zero: !!(num & SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_SLASHED_ZERO),
    features: {},
    feature_entry: '',
    variations: Object.fromEntries(query.font_variation_settings.axes),
  };

  // Set feature checkbox (if it exists) or add to the feature entry string.
  const tables = new Set(font ? font_variants_available(font).tables.map((t) => t.tag) : []);
  const settings: string[] = [];
  const val = query.font_feature_settings.value();
  if (val && val !== 'normal') {
    for (const token of val.split(/\s*,\s*/)) {
      const m = /["'](\w{4})["']\s*([0-9]+|on|off|)/.exec(token);
      if (!m) continue;
      const table = m[1]!;
      if (tables.has(table)) {
        const value = m[2]!;
        state.features[table] =
          value === '0' || value === 'off' ? 0 : value === '' || value === 'on' ? 1 : Number(value);
      } else {
        settings.push(token);
      }
    }
  }
  state.feature_entry = settings.join(', ');
  return state;
}

/** Which features the OpenType tables of font support (upstream FontVariants::update_opentype). */
export function font_variants_available(font: FontInstance): FontVariantsAvailable {
  const tab = font.get_opentype_tables();
  const has = (t: string) => tab.has(t);
  const tables: FontVariantsAvailable['tables'] = [];
  for (const [tag, sub] of tab) {
    // Only look at style substitution tables ('salt', 'ss01', etc. but not 'ssty').
    // Also look at character substitution tables ('cv01', etc.).
    const style =
      tag === 'case' ||
      tag === 'salt' ||
      tag === 'swsh' ||
      tag === 'cwsh' ||
      tag === 'ornm' ||
      tag === 'nalt' ||
      tag === 'hist' ||
      (tag.startsWith('ss') && tag[2] !== 't') ||
      tag.startsWith('cv');
    if (style) tables.push({ tag, input: sub.input, output: sub.output });
  }
  return {
    ligatures_common: has('liga') || has('clig'),
    ligatures_discretionary: has('dlig'),
    ligatures_historical: has('hlig'),
    ligatures_contextual: has('calt'),
    position_sub: has('subs'),
    position_super: has('sups'),
    caps_small: has('smcp'),
    caps_all_small: has('c2sc') && has('smcp'),
    caps_petite: has('pcap'),
    caps_all_petite: has('c2sc') && has('pcap'),
    caps_unicase: has('unic'),
    caps_titling: has('titl'),
    numeric_lining: has('lnum'),
    numeric_old_style: has('onum'),
    numeric_proportional: has('pnum'),
    numeric_tabular: has('tnum'),
    numeric_diagonal: has('frac'),
    numeric_stacked: has('afrac'),
    numeric_ordinal: has('ordn'),
    numeric_slashed_zero: has('zero'),
    tables,
    axes: font.get_opentype_varaxes().map(({ tag, name, minimum, def, maximum }) => ({
      tag,
      name,
      minimum,
      def,
      maximum,
    })),
  };
}

/** Write the settings to css (upstream FontVariants::fill_css and FontVariations::fill_css). */
export function font_variants_fill_css(state: FontVariantsState, css: SPCSSAttr): void {
  // Ligatures
  const common = state.ligatures_common;
  const discretionary = state.ligatures_discretionary;
  const historical = state.ligatures_historical;
  const contextual = state.ligatures_contextual;
  if (!common && !discretionary && !historical && !contextual) {
    spReprCssSetProperty(css, 'font-variant-ligatures', 'none');
  } else if (common && !discretionary && !historical && contextual) {
    spReprCssSetProperty(css, 'font-variant-ligatures', 'normal');
  } else {
    let css_string = '';
    if (!common) css_string += 'no-common-ligatures ';
    if (discretionary) css_string += 'discretionary-ligatures ';
    if (historical) css_string += 'historical-ligatures ';
    if (!contextual) css_string += 'no-contextual ';
    spReprCssSetProperty(css, 'font-variant-ligatures', css_string.trim());
  }

  // Position
  spReprCssSetProperty(css, 'font-variant-position', state.position);

  // Caps
  const caps: Record<FontVariantsState['caps'], string> = {
    normal: 'normal',
    small: 'small-caps',
    all_small: 'all-small-caps',
    // Upstream writes "petite", "all-petite" and "titling", which CSS does not know.
    petite: 'petite-caps',
    all_petite: 'all-petite-caps',
    unicase: 'unicase',
    titling: 'titling-caps',
  };
  spReprCssSetProperty(css, 'font-variant-caps', caps[state.caps]);

  // Numeric
  if (
    state.numeric_style === 'default' &&
    state.numeric_width === 'default' &&
    state.numeric_fractions === 'default' &&
    !state.numeric_ordinal &&
    !state.numeric_slashed_zero
  ) {
    spReprCssSetProperty(css, 'font-variant-numeric', 'normal');
  } else {
    let css_string = '';
    if (state.numeric_style === 'lining') css_string += 'lining-nums ';
    if (state.numeric_style === 'old_style') css_string += 'oldstyle-nums ';
    if (state.numeric_width === 'proportional') css_string += 'proportional-nums ';
    if (state.numeric_width === 'tabular') css_string += 'tabular-nums ';
    if (state.numeric_fractions === 'diagonal') css_string += 'diagonal-fractions ';
    if (state.numeric_fractions === 'stacked') css_string += 'stacked-fractions ';
    if (state.numeric_ordinal) css_string += 'ordinal ';
    if (state.numeric_slashed_zero) css_string += 'slashed-zero ';
    spReprCssSetProperty(css, 'font-variant-numeric', css_string.trim());
  }

  // Feature settings
  const feature_string = [
    ...Object.entries(state.features)
      .filter(([, v]) => v > 0)
      .map(([tag, v]) => (v === 1 ? `"${tag}"` : `"${tag}" ${v}`)),
    ...(state.feature_entry.trim() ? [state.feature_entry.trim()] : []),
  ].join(', ');
  if (feature_string) spReprCssSetProperty(css, 'font-feature-settings', feature_string);
  else spReprCssUnsetProperty(css, 'font-feature-settings');

  // Variations
  const axes = Object.entries(state.variations);
  if (axes.length) {
    spReprCssSetProperty(
      css,
      'font-variation-settings',
      axes.map(([tag, v]) => `'${tag}' ${Number(v.toFixed(3))}`).join(', '),
    );
  }
}

/** The settings as a CSS font-feature-settings value, for the preview (upstream FontVariants::get_markup). */
export function font_variants_get_markup(state: FontVariantsState): string {
  const markup: string[] = [];
  if (!state.ligatures_common) markup.push('"liga" 0', '"clig" 0'); // On by default.
  if (state.ligatures_discretionary) markup.push('"dlig" 1');
  if (state.ligatures_historical) markup.push('"hlig" 1');
  if (!state.ligatures_contextual) markup.push('"calt" 0');
  if (state.position === 'sub') markup.push('"subs" 1');
  else if (state.position === 'super') markup.push('"sups" 1');
  const caps: Record<FontVariantsState['caps'], string[]> = {
    normal: [],
    small: ['"smcp" 1'],
    all_small: ['"c2sc" 1', '"smcp" 1'],
    petite: ['"pcap" 1'],
    all_petite: ['"c2pc" 1', '"pcap" 1'],
    unicase: ['"unic" 1'],
    titling: ['"titl" 1'],
  };
  markup.push(...caps[state.caps]);
  if (state.numeric_style === 'lining') markup.push('"lnum" 1');
  if (state.numeric_style === 'old_style') markup.push('"onum" 1');
  if (state.numeric_width === 'proportional') markup.push('"pnum" 1');
  if (state.numeric_width === 'tabular') markup.push('"tnum" 1');
  if (state.numeric_fractions === 'diagonal') markup.push('"frac" 1');
  if (state.numeric_fractions === 'stacked') markup.push('"afrc" 1');
  if (state.numeric_ordinal) markup.push('"ordn" 1');
  if (state.numeric_slashed_zero) markup.push('"zero" 1');
  for (const [tag, v] of Object.entries(state.features)) if (v > 0) markup.push(`"${tag}" ${v}`);
  if (state.feature_entry.trim()) markup.push(state.feature_entry.trim());
  return markup.join(', ');
}
