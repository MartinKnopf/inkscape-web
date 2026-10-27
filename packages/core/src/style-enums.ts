// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/style-enums.h
/*
 * SPStyle enums: named public enums that correspond to SVG property values.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2010 Jon A. Cruz
 * Copyright (C) 2001-2002 Lauris Kaplinski
 * Copyright (C) 2001 Ximian, Inc.
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

export enum SPWindRule {
  SP_WIND_RULE_NONZERO,
  SP_WIND_RULE_INTERSECT,
  SP_WIND_RULE_EVENODD,
  SP_WIND_RULE_POSITIVE,
}

export enum SPStrokeJoinType {
  SP_STROKE_LINEJOIN_MITER,
  SP_STROKE_LINEJOIN_ROUND,
  SP_STROKE_LINEJOIN_BEVEL,
}

export enum SPStrokeCapType {
  SP_STROKE_LINECAP_BUTT,
  SP_STROKE_LINECAP_ROUND,
  SP_STROKE_LINECAP_SQUARE,
}

export enum SPCSSFontSize {
  SP_CSS_FONT_SIZE_XX_SMALL,
  SP_CSS_FONT_SIZE_X_SMALL,
  SP_CSS_FONT_SIZE_SMALL,
  SP_CSS_FONT_SIZE_MEDIUM,
  SP_CSS_FONT_SIZE_LARGE,
  SP_CSS_FONT_SIZE_X_LARGE,
  SP_CSS_FONT_SIZE_XX_LARGE,
  SP_CSS_FONT_SIZE_SMALLER,
  SP_CSS_FONT_SIZE_LARGER,
}

export enum SPCSSFontStyle {
  SP_CSS_FONT_STYLE_NORMAL,
  SP_CSS_FONT_STYLE_ITALIC,
  SP_CSS_FONT_STYLE_OBLIQUE,
}

export enum SPCSSFontVariant {
  SP_CSS_FONT_VARIANT_NORMAL,
  SP_CSS_FONT_VARIANT_SMALL_CAPS,
}

export enum SPCSSFontWeight {
  SP_CSS_FONT_WEIGHT_100 = 100,
  SP_CSS_FONT_WEIGHT_200 = 200,
  SP_CSS_FONT_WEIGHT_300 = 300,
  SP_CSS_FONT_WEIGHT_400 = 400,
  SP_CSS_FONT_WEIGHT_500 = 500,
  SP_CSS_FONT_WEIGHT_600 = 600,
  SP_CSS_FONT_WEIGHT_700 = 700,
  SP_CSS_FONT_WEIGHT_800 = 800,
  SP_CSS_FONT_WEIGHT_900 = 900,
  SP_CSS_FONT_WEIGHT_NORMAL = -1,
  SP_CSS_FONT_WEIGHT_BOLD = -2,
  SP_CSS_FONT_WEIGHT_LIGHTER = -3,
  SP_CSS_FONT_WEIGHT_BOLDER = -4,
}

export enum SPCSSFontStretch {
  SP_CSS_FONT_STRETCH_ULTRA_CONDENSED,
  SP_CSS_FONT_STRETCH_EXTRA_CONDENSED,
  SP_CSS_FONT_STRETCH_CONDENSED,
  SP_CSS_FONT_STRETCH_SEMI_CONDENSED,
  SP_CSS_FONT_STRETCH_NORMAL,
  SP_CSS_FONT_STRETCH_SEMI_EXPANDED,
  SP_CSS_FONT_STRETCH_EXPANDED,
  SP_CSS_FONT_STRETCH_EXTRA_EXPANDED,
  SP_CSS_FONT_STRETCH_ULTRA_EXPANDED,
  SP_CSS_FONT_STRETCH_NARROWER,
  SP_CSS_FONT_STRETCH_WIDER,
}

export enum SPCSSFontVariantLigatures {
  SP_CSS_FONT_VARIANT_LIGATURES_NONE = 0,
  SP_CSS_FONT_VARIANT_LIGATURES_COMMON = 1,
  SP_CSS_FONT_VARIANT_LIGATURES_DISCRETIONARY = 2,
  SP_CSS_FONT_VARIANT_LIGATURES_HISTORICAL = 4,
  SP_CSS_FONT_VARIANT_LIGATURES_CONTEXTUAL = 8,
  SP_CSS_FONT_VARIANT_LIGATURES_NORMAL = 9,
  SP_CSS_FONT_VARIANT_LIGATURES_NOCOMMON = 16,
  SP_CSS_FONT_VARIANT_LIGATURES_NODISCRETIONARY = 32,
  SP_CSS_FONT_VARIANT_LIGATURES_NOHISTORICAL = 64,
  SP_CSS_FONT_VARIANT_LIGATURES_NOCONTEXTUAL = 128,
}

export enum SPCSSFontVariantPosition {
  SP_CSS_FONT_VARIANT_POSITION_NORMAL = 1,
  SP_CSS_FONT_VARIANT_POSITION_SUB = 2,
  SP_CSS_FONT_VARIANT_POSITION_SUPER = 4,
}

export enum SPCSSFontVariantCaps {
  SP_CSS_FONT_VARIANT_CAPS_NORMAL = 1,
  SP_CSS_FONT_VARIANT_CAPS_SMALL = 2,
  SP_CSS_FONT_VARIANT_CAPS_ALL_SMALL = 4,
  SP_CSS_FONT_VARIANT_CAPS_PETITE = 8,
  SP_CSS_FONT_VARIANT_CAPS_ALL_PETITE = 16,
  SP_CSS_FONT_VARIANT_CAPS_UNICASE = 32,
  SP_CSS_FONT_VARIANT_CAPS_TITLING = 64,
}

export enum SPCSSFontVariantNumeric {
  SP_CSS_FONT_VARIANT_NUMERIC_NORMAL = 0,
  SP_CSS_FONT_VARIANT_NUMERIC_LINING_NUMS = 1,
  SP_CSS_FONT_VARIANT_NUMERIC_OLDSTYLE_NUMS = 2,
  SP_CSS_FONT_VARIANT_NUMERIC_PROPORTIONAL_NUMS = 4,
  SP_CSS_FONT_VARIANT_NUMERIC_TABULAR_NUMS = 8,
  SP_CSS_FONT_VARIANT_NUMERIC_DIAGONAL_FRACTIONS = 16,
  SP_CSS_FONT_VARIANT_NUMERIC_STACKED_FRACTIONS = 32,
  SP_CSS_FONT_VARIANT_NUMERIC_ORDINAL = 64,
  SP_CSS_FONT_VARIANT_NUMERIC_SLASHED_ZERO = 128,
}

export enum SPCSSFontVariantAlternates {
  SP_CSS_FONT_VARIANT_ALTERNATES_NORMAL,
  SP_CSS_FONT_VARIANT_ALTERNATES_HISTORICAL_FORMS,
  SP_CSS_FONT_VARIANT_ALTERNATES_STYLISTIC,
  SP_CSS_FONT_VARIANT_ALTERNATES_STYLESET,
  SP_CSS_FONT_VARIANT_ALTERNATES_CHARACTER_VARIANT,
  SP_CSS_FONT_VARIANT_ALTERNATES_SWASH,
  SP_CSS_FONT_VARIANT_ALTERNATES_ORNAMENTS,
  SP_CSS_FONT_VARIANT_ALTERNATES_ANNOTATION,
}

export enum SPCSSFontVariantEastAsian {
  SP_CSS_FONT_VARIANT_EAST_ASIAN_NORMAL = 0,
  SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS78 = 1,
  SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS83 = 2,
  SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS90 = 4,
  SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS04 = 8,
  SP_CSS_FONT_VARIANT_EAST_ASIAN_SIMPLIFIED = 16,
  SP_CSS_FONT_VARIANT_EAST_ASIAN_TRADITIONAL = 32,
  SP_CSS_FONT_VARIANT_EAST_ASIAN_FULL_WIDTH = 64,
  SP_CSS_FONT_VARIANT_EAST_ASIAN_PROPORTIONAL_WIDTH = 128,
  SP_CSS_FONT_VARIANT_EAST_ASIAN_RUBY = 256,
}

export enum SPCSSTextAlign {
  SP_CSS_TEXT_ALIGN_START,
  SP_CSS_TEXT_ALIGN_END,
  SP_CSS_TEXT_ALIGN_LEFT,
  SP_CSS_TEXT_ALIGN_RIGHT,
  SP_CSS_TEXT_ALIGN_CENTER,
  SP_CSS_TEXT_ALIGN_JUSTIFY,
}

export enum SPCSSTextTransform {
  SP_CSS_TEXT_TRANSFORM_CAPITALIZE,
  SP_CSS_TEXT_TRANSFORM_UPPERCASE,
  SP_CSS_TEXT_TRANSFORM_LOWERCASE,
  SP_CSS_TEXT_TRANSFORM_NONE,
}

export enum SPCSSDirection {
  SP_CSS_DIRECTION_LTR,
  SP_CSS_DIRECTION_RTL,
}

export enum SPCSSWritingMode {
  SP_CSS_WRITING_MODE_LR_TB,
  SP_CSS_WRITING_MODE_RL_TB,
  SP_CSS_WRITING_MODE_TB_RL,
  SP_CSS_WRITING_MODE_TB_LR,
}

export enum SPCSSTextOrientation {
  SP_CSS_TEXT_ORIENTATION_MIXED,
  SP_CSS_TEXT_ORIENTATION_UPRIGHT,
  SP_CSS_TEXT_ORIENTATION_SIDEWAYS,
}

export enum SPTextAnchor {
  SP_CSS_TEXT_ANCHOR_START,
  SP_CSS_TEXT_ANCHOR_MIDDLE,
  SP_CSS_TEXT_ANCHOR_END,
}

export enum SPWhiteSpace {
  SP_CSS_WHITE_SPACE_NORMAL,
  SP_CSS_WHITE_SPACE_PRE,
  SP_CSS_WHITE_SPACE_NOWRAP,
  SP_CSS_WHITE_SPACE_PREWRAP,
  SP_CSS_WHITE_SPACE_PRELINE,
}

export enum SPCSSBaseline {
  SP_CSS_BASELINE_AUTO,
  SP_CSS_BASELINE_ALPHABETIC,
  SP_CSS_BASELINE_IDEOGRAPHIC,
  SP_CSS_BASELINE_HANGING,
  SP_CSS_BASELINE_MATHEMATICAL,
  SP_CSS_BASELINE_CENTRAL,
  SP_CSS_BASELINE_MIDDLE,
  SP_CSS_BASELINE_TEXT_BEFORE_EDGE,
  SP_CSS_BASELINE_TEXT_AFTER_EDGE,
  SP_CSS_BASELINE_SIZE,
}

export enum SPCSSBaselineShift {
  SP_CSS_BASELINE_SHIFT_BASELINE,
  SP_CSS_BASELINE_SHIFT_SUB,
  SP_CSS_BASELINE_SHIFT_SUPER,
}

export enum SPVisibility {
  SP_CSS_VISIBILITY_HIDDEN,
  SP_CSS_VISIBILITY_COLLAPSE,
  SP_CSS_VISIBILITY_VISIBLE,
}

export enum SPOverflow {
  SP_CSS_OVERFLOW_VISIBLE,
  SP_CSS_OVERFLOW_HIDDEN,
  SP_CSS_OVERFLOW_SCROLL,
  SP_CSS_OVERFLOW_AUTO,
}

export enum SPCSSDisplay {
  SP_CSS_DISPLAY_NONE,
  SP_CSS_DISPLAY_INLINE,
  SP_CSS_DISPLAY_BLOCK,
  SP_CSS_DISPLAY_LIST_ITEM,
  SP_CSS_DISPLAY_RUN_IN,
  SP_CSS_DISPLAY_COMPACT,
  SP_CSS_DISPLAY_MARKER,
  SP_CSS_DISPLAY_TABLE,
  SP_CSS_DISPLAY_INLINE_TABLE,
  SP_CSS_DISPLAY_TABLE_ROW_GROUP,
  SP_CSS_DISPLAY_TABLE_HEADER_GROUP,
  SP_CSS_DISPLAY_TABLE_FOOTER_GROUP,
  SP_CSS_DISPLAY_TABLE_ROW,
  SP_CSS_DISPLAY_TABLE_COLUMN_GROUP,
  SP_CSS_DISPLAY_TABLE_COLUMN,
  SP_CSS_DISPLAY_TABLE_CELL,
  SP_CSS_DISPLAY_TABLE_CAPTION,
}

export enum SPIsolation {
  SP_CSS_ISOLATION_AUTO,
  SP_CSS_ISOLATION_ISOLATE,
}

export enum SPBlendMode {
  SP_CSS_BLEND_NORMAL,
  SP_CSS_BLEND_MULTIPLY,
  SP_CSS_BLEND_SCREEN,
  SP_CSS_BLEND_DARKEN,
  SP_CSS_BLEND_LIGHTEN,
  SP_CSS_BLEND_OVERLAY,
  SP_CSS_BLEND_COLORDODGE,
  SP_CSS_BLEND_COLORBURN,
  SP_CSS_BLEND_HARDLIGHT,
  SP_CSS_BLEND_SOFTLIGHT,
  SP_CSS_BLEND_DIFFERENCE,
  SP_CSS_BLEND_EXCLUSION,
  SP_CSS_BLEND_HUE,
  SP_CSS_BLEND_SATURATION,
  SP_CSS_BLEND_COLOR,
  SP_CSS_BLEND_LUMINOSITY,
  SP_CSS_BLEND_ENDMODE,
}

export enum SPEnableBackground {
  SP_CSS_BACKGROUND_ACCUMULATE,
  SP_CSS_BACKGROUND_NEW,
}

export enum SPColorRendering {
  SP_CSS_COLOR_RENDERING_AUTO,
  SP_CSS_COLOR_RENDERING_OPTIMIZESPEED,
  SP_CSS_COLOR_RENDERING_OPTIMIZEQUALITY,
}

export enum SPImageRendering {
  SP_CSS_IMAGE_RENDERING_AUTO,
  SP_CSS_IMAGE_RENDERING_OPTIMIZESPEED,
  SP_CSS_IMAGE_RENDERING_OPTIMIZEQUALITY,
  SP_CSS_IMAGE_RENDERING_CRISPEDGES,
  SP_CSS_IMAGE_RENDERING_PIXELATED,
}

export enum SPShapeRendering {
  SP_CSS_SHAPE_RENDERING_AUTO,
  SP_CSS_SHAPE_RENDERING_OPTIMIZESPEED,
  SP_CSS_SHAPE_RENDERING_CRISPEDGES,
  SP_CSS_SHAPE_RENDERING_GEOMETRICPRECISION,
}

export enum SPTextRendering {
  SP_CSS_TEXT_RENDERING_AUTO,
  SP_CSS_TEXT_RENDERING_OPTIMIZESPEED,
  SP_CSS_TEXT_RENDERING_OPTIMIZELEGIBILITY,
  SP_CSS_TEXT_RENDERING_GEOMETRICPRECISION,
}

export enum SPVectorEffect {
  SP_VECTOR_EFFECT_NONE = 0,
  SP_VECTOR_EFFECT_NON_SCALING_STROKE = 1,
  SP_VECTOR_EFFECT_NON_SCALING_SIZE = 2,
  SP_VECTOR_EFFECT_NON_ROTATION = 4,
  SP_VECTOR_EFFECT_FIXED_POSITION = 8,
}

export enum SPStrokeExtensions {
  SP_STROKE_EXTENSIONS_NONE,
  SP_STROKE_EXTENSIONS_HAIRLINE,
}

export enum SPPaintOrigin {
  SP_CSS_PAINT_ORIGIN_NORMAL,
  SP_CSS_PAINT_ORIGIN_CURRENT_COLOR,
  SP_CSS_PAINT_ORIGIN_CONTEXT_FILL,
  SP_CSS_PAINT_ORIGIN_CONTEXT_STROKE,
}

export enum SPPaintOrderLayer {
  SP_CSS_PAINT_ORDER_NORMAL,
  SP_CSS_PAINT_ORDER_FILL,
  SP_CSS_PAINT_ORDER_STROKE,
  SP_CSS_PAINT_ORDER_MARKER,
}

/** A keyword of a property and its value. */
export interface SPStyleEnum {
  key: string;
  value: number;
}

export const enum_fill_rule: readonly SPStyleEnum[] = [
  { key: 'nonzero', value: SPWindRule.SP_WIND_RULE_NONZERO },
  { key: 'evenodd', value: SPWindRule.SP_WIND_RULE_EVENODD },
];

export const enum_stroke_linejoin: readonly SPStyleEnum[] = [
  { key: 'miter', value: SPStrokeJoinType.SP_STROKE_LINEJOIN_MITER },
  { key: 'round', value: SPStrokeJoinType.SP_STROKE_LINEJOIN_ROUND },
  { key: 'bevel', value: SPStrokeJoinType.SP_STROKE_LINEJOIN_BEVEL },
];

export const enum_stroke_linecap: readonly SPStyleEnum[] = [
  { key: 'butt', value: SPStrokeCapType.SP_STROKE_LINECAP_BUTT },
  { key: 'round', value: SPStrokeCapType.SP_STROKE_LINECAP_ROUND },
  { key: 'square', value: SPStrokeCapType.SP_STROKE_LINECAP_SQUARE },
];

export const enum_font_style: readonly SPStyleEnum[] = [
  { key: 'normal', value: SPCSSFontStyle.SP_CSS_FONT_STYLE_NORMAL },
  { key: 'italic', value: SPCSSFontStyle.SP_CSS_FONT_STYLE_ITALIC },
  { key: 'oblique', value: SPCSSFontStyle.SP_CSS_FONT_STYLE_OBLIQUE },
];

export const enum_font_size: readonly SPStyleEnum[] = [
  { key: 'xx-small', value: SPCSSFontSize.SP_CSS_FONT_SIZE_XX_SMALL },
  { key: 'x-small', value: SPCSSFontSize.SP_CSS_FONT_SIZE_X_SMALL },
  { key: 'small', value: SPCSSFontSize.SP_CSS_FONT_SIZE_SMALL },
  { key: 'medium', value: SPCSSFontSize.SP_CSS_FONT_SIZE_MEDIUM },
  { key: 'large', value: SPCSSFontSize.SP_CSS_FONT_SIZE_LARGE },
  { key: 'x-large', value: SPCSSFontSize.SP_CSS_FONT_SIZE_X_LARGE },
  { key: 'xx-large', value: SPCSSFontSize.SP_CSS_FONT_SIZE_XX_LARGE },
  { key: 'smaller', value: SPCSSFontSize.SP_CSS_FONT_SIZE_SMALLER },
  { key: 'larger', value: SPCSSFontSize.SP_CSS_FONT_SIZE_LARGER },
];

export const enum_font_variant: readonly SPStyleEnum[] = [
  { key: 'normal', value: SPCSSFontVariant.SP_CSS_FONT_VARIANT_NORMAL },
  { key: 'small-caps', value: SPCSSFontVariant.SP_CSS_FONT_VARIANT_SMALL_CAPS },
];

export const enum_font_weight: readonly SPStyleEnum[] = [
  { key: '100', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_100 },
  { key: '200', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_200 },
  { key: '300', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_300 },
  { key: '400', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_400 },
  { key: '500', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_500 },
  { key: '600', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_600 },
  { key: '700', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_700 },
  { key: '800', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_800 },
  { key: '900', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_900 },
  { key: 'normal', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_NORMAL },
  { key: 'bold', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_BOLD },
  { key: 'lighter', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_LIGHTER },
  { key: 'bolder', value: SPCSSFontWeight.SP_CSS_FONT_WEIGHT_BOLDER },
];

export const enum_font_stretch: readonly SPStyleEnum[] = [
  { key: 'ultra-condensed', value: SPCSSFontStretch.SP_CSS_FONT_STRETCH_ULTRA_CONDENSED },
  { key: 'extra-condensed', value: SPCSSFontStretch.SP_CSS_FONT_STRETCH_EXTRA_CONDENSED },
  { key: 'condensed', value: SPCSSFontStretch.SP_CSS_FONT_STRETCH_CONDENSED },
  { key: 'semi-condensed', value: SPCSSFontStretch.SP_CSS_FONT_STRETCH_SEMI_CONDENSED },
  { key: 'normal', value: SPCSSFontStretch.SP_CSS_FONT_STRETCH_NORMAL },
  { key: 'semi-expanded', value: SPCSSFontStretch.SP_CSS_FONT_STRETCH_SEMI_EXPANDED },
  { key: 'expanded', value: SPCSSFontStretch.SP_CSS_FONT_STRETCH_EXPANDED },
  { key: 'extra-expanded', value: SPCSSFontStretch.SP_CSS_FONT_STRETCH_EXTRA_EXPANDED },
  { key: 'ultra-expanded', value: SPCSSFontStretch.SP_CSS_FONT_STRETCH_ULTRA_EXPANDED },
  { key: 'narrower', value: SPCSSFontStretch.SP_CSS_FONT_STRETCH_NARROWER },
  { key: 'wider', value: SPCSSFontStretch.SP_CSS_FONT_STRETCH_WIDER },
];

export const enum_font_variant_ligatures: readonly SPStyleEnum[] = [
  { key: 'none', value: SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NONE },
  { key: 'common-ligatures', value: SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_COMMON },
  {
    key: 'discretionary-ligatures',
    value: SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_DISCRETIONARY,
  },
  { key: 'historical-ligatures', value: SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_HISTORICAL },
  { key: 'contextual', value: SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_CONTEXTUAL },
  { key: 'normal', value: SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NORMAL },
  { key: 'no-common-ligatures', value: SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NOCOMMON },
  {
    key: 'no-discretionary-ligatures',
    value: SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NODISCRETIONARY,
  },
  {
    key: 'no-historical-ligatures',
    value: SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NOHISTORICAL,
  },
  { key: 'no-contextual', value: SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NOCONTEXTUAL },
];

export const enum_font_variant_position: readonly SPStyleEnum[] = [
  { key: 'normal', value: SPCSSFontVariantPosition.SP_CSS_FONT_VARIANT_POSITION_NORMAL },
  { key: 'sub', value: SPCSSFontVariantPosition.SP_CSS_FONT_VARIANT_POSITION_SUB },
  { key: 'super', value: SPCSSFontVariantPosition.SP_CSS_FONT_VARIANT_POSITION_SUPER },
];

export const enum_font_variant_caps: readonly SPStyleEnum[] = [
  { key: 'normal', value: SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_NORMAL },
  { key: 'small-caps', value: SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_SMALL },
  { key: 'all-small-caps', value: SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_ALL_SMALL },
  { key: 'petite-caps', value: SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_PETITE },
  { key: 'all-petite-caps', value: SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_ALL_PETITE },
  { key: 'unicase', value: SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_UNICASE },
  { key: 'titling-caps', value: SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_TITLING },
];

export const enum_font_variant_numeric: readonly SPStyleEnum[] = [
  { key: 'normal', value: SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_NORMAL },
  { key: 'lining-nums', value: SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_LINING_NUMS },
  { key: 'oldstyle-nums', value: SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_OLDSTYLE_NUMS },
  { key: 'proportional-nums', value: SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_PROPORTIONAL_NUMS },
  { key: 'tabular-nums', value: SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_TABULAR_NUMS },
  {
    key: 'diagonal-fractions',
    value: SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_DIAGONAL_FRACTIONS,
  },
  { key: 'stacked-fractions', value: SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_STACKED_FRACTIONS },
  { key: 'ordinal', value: SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_ORDINAL },
  { key: 'slashed-zero', value: SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_SLASHED_ZERO },
];

export const enum_font_variant_alternates: readonly SPStyleEnum[] = [
  { key: 'normal', value: SPCSSFontVariantAlternates.SP_CSS_FONT_VARIANT_ALTERNATES_NORMAL },
  {
    key: 'historical-forms',
    value: SPCSSFontVariantAlternates.SP_CSS_FONT_VARIANT_ALTERNATES_HISTORICAL_FORMS,
  },
  { key: 'stylistic', value: SPCSSFontVariantAlternates.SP_CSS_FONT_VARIANT_ALTERNATES_STYLISTIC },
  { key: 'styleset', value: SPCSSFontVariantAlternates.SP_CSS_FONT_VARIANT_ALTERNATES_STYLESET },
  {
    key: 'character_variant',
    value: SPCSSFontVariantAlternates.SP_CSS_FONT_VARIANT_ALTERNATES_CHARACTER_VARIANT,
  },
  { key: 'swash', value: SPCSSFontVariantAlternates.SP_CSS_FONT_VARIANT_ALTERNATES_SWASH },
  { key: 'ornaments', value: SPCSSFontVariantAlternates.SP_CSS_FONT_VARIANT_ALTERNATES_ORNAMENTS },
  { key: 'annotation', value: SPCSSFontVariantAlternates.SP_CSS_FONT_VARIANT_ALTERNATES_ANNOTATION },
];

export const enum_font_variant_east_asian: readonly SPStyleEnum[] = [
  { key: 'normal', value: SPCSSFontVariantEastAsian.SP_CSS_FONT_VARIANT_EAST_ASIAN_NORMAL },
  { key: 'jis78', value: SPCSSFontVariantEastAsian.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS78 },
  { key: 'jis83', value: SPCSSFontVariantEastAsian.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS83 },
  { key: 'jis90', value: SPCSSFontVariantEastAsian.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS90 },
  { key: 'jis04', value: SPCSSFontVariantEastAsian.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS04 },
  { key: 'simplified', value: SPCSSFontVariantEastAsian.SP_CSS_FONT_VARIANT_EAST_ASIAN_SIMPLIFIED },
  { key: 'traditional', value: SPCSSFontVariantEastAsian.SP_CSS_FONT_VARIANT_EAST_ASIAN_TRADITIONAL },
  { key: 'full-width', value: SPCSSFontVariantEastAsian.SP_CSS_FONT_VARIANT_EAST_ASIAN_FULL_WIDTH },
  {
    key: 'proportional-width',
    value: SPCSSFontVariantEastAsian.SP_CSS_FONT_VARIANT_EAST_ASIAN_PROPORTIONAL_WIDTH,
  },
  { key: 'ruby', value: SPCSSFontVariantEastAsian.SP_CSS_FONT_VARIANT_EAST_ASIAN_RUBY },
];

export const enum_text_align: readonly SPStyleEnum[] = [
  { key: 'start', value: SPCSSTextAlign.SP_CSS_TEXT_ALIGN_START },
  { key: 'end', value: SPCSSTextAlign.SP_CSS_TEXT_ALIGN_END },
  { key: 'left', value: SPCSSTextAlign.SP_CSS_TEXT_ALIGN_LEFT },
  { key: 'right', value: SPCSSTextAlign.SP_CSS_TEXT_ALIGN_RIGHT },
  { key: 'center', value: SPCSSTextAlign.SP_CSS_TEXT_ALIGN_CENTER },
  { key: 'justify', value: SPCSSTextAlign.SP_CSS_TEXT_ALIGN_JUSTIFY },
];

export const enum_text_transform: readonly SPStyleEnum[] = [
  { key: 'capitalize', value: SPCSSTextTransform.SP_CSS_TEXT_TRANSFORM_CAPITALIZE },
  { key: 'uppercase', value: SPCSSTextTransform.SP_CSS_TEXT_TRANSFORM_UPPERCASE },
  { key: 'lowercase', value: SPCSSTextTransform.SP_CSS_TEXT_TRANSFORM_LOWERCASE },
  { key: 'none', value: SPCSSTextTransform.SP_CSS_TEXT_TRANSFORM_NONE },
];

export const enum_text_anchor: readonly SPStyleEnum[] = [
  { key: 'start', value: SPTextAnchor.SP_CSS_TEXT_ANCHOR_START },
  { key: 'middle', value: SPTextAnchor.SP_CSS_TEXT_ANCHOR_MIDDLE },
  { key: 'end', value: SPTextAnchor.SP_CSS_TEXT_ANCHOR_END },
];

export const enum_white_space: readonly SPStyleEnum[] = [
  { key: 'normal', value: SPWhiteSpace.SP_CSS_WHITE_SPACE_NORMAL },
  { key: 'pre', value: SPWhiteSpace.SP_CSS_WHITE_SPACE_PRE },
  { key: 'nowrap', value: SPWhiteSpace.SP_CSS_WHITE_SPACE_NOWRAP },
  { key: 'pre-wrap', value: SPWhiteSpace.SP_CSS_WHITE_SPACE_PREWRAP },
  { key: 'pre-line', value: SPWhiteSpace.SP_CSS_WHITE_SPACE_PRELINE },
];

export const enum_direction: readonly SPStyleEnum[] = [
  { key: 'ltr', value: SPCSSDirection.SP_CSS_DIRECTION_LTR },
  { key: 'rtl', value: SPCSSDirection.SP_CSS_DIRECTION_RTL },
];

export const enum_writing_mode: readonly SPStyleEnum[] = [
  { key: 'lr-tb', value: SPCSSWritingMode.SP_CSS_WRITING_MODE_LR_TB },
  { key: 'rl-tb', value: SPCSSWritingMode.SP_CSS_WRITING_MODE_RL_TB },
  { key: 'tb-rl', value: SPCSSWritingMode.SP_CSS_WRITING_MODE_TB_RL },
  { key: 'lr', value: SPCSSWritingMode.SP_CSS_WRITING_MODE_LR_TB },
  { key: 'rl', value: SPCSSWritingMode.SP_CSS_WRITING_MODE_RL_TB },
  { key: 'tb', value: SPCSSWritingMode.SP_CSS_WRITING_MODE_TB_RL },
  { key: 'horizontal-tb', value: SPCSSWritingMode.SP_CSS_WRITING_MODE_LR_TB },
  { key: 'vertical-rl', value: SPCSSWritingMode.SP_CSS_WRITING_MODE_TB_RL },
  { key: 'vertical-lr', value: SPCSSWritingMode.SP_CSS_WRITING_MODE_TB_LR },
];

export const enum_text_orientation: readonly SPStyleEnum[] = [
  { key: 'mixed', value: SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_MIXED },
  { key: 'upright', value: SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_UPRIGHT },
  { key: 'sideways', value: SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_SIDEWAYS },
];

export const enum_baseline: readonly SPStyleEnum[] = [
  { key: 'auto', value: SPCSSBaseline.SP_CSS_BASELINE_AUTO },
  { key: 'alphabetic', value: SPCSSBaseline.SP_CSS_BASELINE_ALPHABETIC },
  { key: 'ideographic', value: SPCSSBaseline.SP_CSS_BASELINE_IDEOGRAPHIC },
  { key: 'hanging', value: SPCSSBaseline.SP_CSS_BASELINE_HANGING },
  { key: 'mathematical', value: SPCSSBaseline.SP_CSS_BASELINE_MATHEMATICAL },
  { key: 'central', value: SPCSSBaseline.SP_CSS_BASELINE_CENTRAL },
  { key: 'middle', value: SPCSSBaseline.SP_CSS_BASELINE_MIDDLE },
  { key: 'text-before-edge', value: SPCSSBaseline.SP_CSS_BASELINE_TEXT_BEFORE_EDGE },
  { key: 'text-after-edge', value: SPCSSBaseline.SP_CSS_BASELINE_TEXT_AFTER_EDGE },
];

export const enum_baseline_shift: readonly SPStyleEnum[] = [
  { key: 'baseline', value: SPCSSBaselineShift.SP_CSS_BASELINE_SHIFT_BASELINE },
  { key: 'sub', value: SPCSSBaselineShift.SP_CSS_BASELINE_SHIFT_SUB },
  { key: 'super', value: SPCSSBaselineShift.SP_CSS_BASELINE_SHIFT_SUPER },
];

export const enum_visibility: readonly SPStyleEnum[] = [
  { key: 'hidden', value: SPVisibility.SP_CSS_VISIBILITY_HIDDEN },
  { key: 'collapse', value: SPVisibility.SP_CSS_VISIBILITY_COLLAPSE },
  { key: 'visible', value: SPVisibility.SP_CSS_VISIBILITY_VISIBLE },
];

export const enum_overflow: readonly SPStyleEnum[] = [
  { key: 'visible', value: SPOverflow.SP_CSS_OVERFLOW_VISIBLE },
  { key: 'hidden', value: SPOverflow.SP_CSS_OVERFLOW_HIDDEN },
  { key: 'scroll', value: SPOverflow.SP_CSS_OVERFLOW_SCROLL },
  { key: 'auto', value: SPOverflow.SP_CSS_OVERFLOW_AUTO },
];

export const enum_isolation: readonly SPStyleEnum[] = [
  { key: 'auto', value: SPIsolation.SP_CSS_ISOLATION_AUTO },
  { key: 'isolate', value: SPIsolation.SP_CSS_ISOLATION_ISOLATE },
];

export const enum_blend_mode: readonly SPStyleEnum[] = [
  { key: 'normal', value: SPBlendMode.SP_CSS_BLEND_NORMAL },
  { key: 'multiply', value: SPBlendMode.SP_CSS_BLEND_MULTIPLY },
  { key: 'screen', value: SPBlendMode.SP_CSS_BLEND_SCREEN },
  { key: 'darken', value: SPBlendMode.SP_CSS_BLEND_DARKEN },
  { key: 'lighten', value: SPBlendMode.SP_CSS_BLEND_LIGHTEN },
  { key: 'overlay', value: SPBlendMode.SP_CSS_BLEND_OVERLAY },
  { key: 'color-dodge', value: SPBlendMode.SP_CSS_BLEND_COLORDODGE },
  { key: 'color-burn', value: SPBlendMode.SP_CSS_BLEND_COLORBURN },
  { key: 'hard-light', value: SPBlendMode.SP_CSS_BLEND_HARDLIGHT },
  { key: 'soft-light', value: SPBlendMode.SP_CSS_BLEND_SOFTLIGHT },
  { key: 'difference', value: SPBlendMode.SP_CSS_BLEND_DIFFERENCE },
  { key: 'exclusion', value: SPBlendMode.SP_CSS_BLEND_EXCLUSION },
  { key: 'hue', value: SPBlendMode.SP_CSS_BLEND_HUE },
  { key: 'saturation', value: SPBlendMode.SP_CSS_BLEND_SATURATION },
  { key: 'color', value: SPBlendMode.SP_CSS_BLEND_COLOR },
  { key: 'luminosity', value: SPBlendMode.SP_CSS_BLEND_LUMINOSITY },
];

export const enum_display: readonly SPStyleEnum[] = [
  { key: 'none', value: SPCSSDisplay.SP_CSS_DISPLAY_NONE },
  { key: 'inline', value: SPCSSDisplay.SP_CSS_DISPLAY_INLINE },
  { key: 'block', value: SPCSSDisplay.SP_CSS_DISPLAY_BLOCK },
  { key: 'list-item', value: SPCSSDisplay.SP_CSS_DISPLAY_LIST_ITEM },
  { key: 'run-in', value: SPCSSDisplay.SP_CSS_DISPLAY_RUN_IN },
  { key: 'compact', value: SPCSSDisplay.SP_CSS_DISPLAY_COMPACT },
  { key: 'marker', value: SPCSSDisplay.SP_CSS_DISPLAY_MARKER },
  { key: 'table', value: SPCSSDisplay.SP_CSS_DISPLAY_TABLE },
  { key: 'inline-table', value: SPCSSDisplay.SP_CSS_DISPLAY_INLINE_TABLE },
  { key: 'table-row-group', value: SPCSSDisplay.SP_CSS_DISPLAY_TABLE_ROW_GROUP },
  { key: 'table-header-group', value: SPCSSDisplay.SP_CSS_DISPLAY_TABLE_HEADER_GROUP },
  { key: 'table-footer-group', value: SPCSSDisplay.SP_CSS_DISPLAY_TABLE_FOOTER_GROUP },
  { key: 'table-row', value: SPCSSDisplay.SP_CSS_DISPLAY_TABLE_ROW },
  { key: 'table-column-group', value: SPCSSDisplay.SP_CSS_DISPLAY_TABLE_COLUMN_GROUP },
  { key: 'table-column', value: SPCSSDisplay.SP_CSS_DISPLAY_TABLE_COLUMN },
  { key: 'table-cell', value: SPCSSDisplay.SP_CSS_DISPLAY_TABLE_CELL },
  { key: 'table-caption', value: SPCSSDisplay.SP_CSS_DISPLAY_TABLE_CAPTION },
];

export const enum_shape_rendering: readonly SPStyleEnum[] = [
  { key: 'auto', value: SPShapeRendering.SP_CSS_SHAPE_RENDERING_AUTO },
  { key: 'optimizeSpeed', value: SPShapeRendering.SP_CSS_SHAPE_RENDERING_OPTIMIZESPEED },
  { key: 'crispEdges', value: SPShapeRendering.SP_CSS_SHAPE_RENDERING_CRISPEDGES },
  { key: 'geometricPrecision', value: SPShapeRendering.SP_CSS_SHAPE_RENDERING_GEOMETRICPRECISION },
];

export const enum_color_rendering: readonly SPStyleEnum[] = [
  { key: 'auto', value: SPColorRendering.SP_CSS_COLOR_RENDERING_AUTO },
  { key: 'optimizeSpeed', value: SPColorRendering.SP_CSS_COLOR_RENDERING_OPTIMIZESPEED },
  { key: 'optimizeQuality', value: SPColorRendering.SP_CSS_COLOR_RENDERING_OPTIMIZEQUALITY },
];

export const enum_image_rendering: readonly SPStyleEnum[] = [
  { key: 'auto', value: SPImageRendering.SP_CSS_IMAGE_RENDERING_AUTO },
  { key: 'optimizeSpeed', value: SPImageRendering.SP_CSS_IMAGE_RENDERING_OPTIMIZESPEED },
  { key: 'optimizeQuality', value: SPImageRendering.SP_CSS_IMAGE_RENDERING_OPTIMIZEQUALITY },
  { key: 'crisp-edges', value: SPImageRendering.SP_CSS_IMAGE_RENDERING_CRISPEDGES },
  { key: 'pixelated', value: SPImageRendering.SP_CSS_IMAGE_RENDERING_PIXELATED },
];

export const enum_text_rendering: readonly SPStyleEnum[] = [
  { key: 'auto', value: SPTextRendering.SP_CSS_TEXT_RENDERING_AUTO },
  { key: 'optimizeSpeed', value: SPTextRendering.SP_CSS_TEXT_RENDERING_OPTIMIZESPEED },
  { key: 'optimizeLegibility', value: SPTextRendering.SP_CSS_TEXT_RENDERING_OPTIMIZELEGIBILITY },
  { key: 'geometricPrecision', value: SPTextRendering.SP_CSS_TEXT_RENDERING_GEOMETRICPRECISION },
];

export const enum_enable_background: readonly SPStyleEnum[] = [
  { key: 'accumulate', value: SPEnableBackground.SP_CSS_BACKGROUND_ACCUMULATE },
  { key: 'new', value: SPEnableBackground.SP_CSS_BACKGROUND_NEW },
];

export const enum_clip_rule: readonly SPStyleEnum[] = [
  { key: 'nonzero', value: SPWindRule.SP_WIND_RULE_NONZERO },
  { key: 'evenodd', value: SPWindRule.SP_WIND_RULE_EVENODD },
];

export const enum_vector_effect: readonly SPStyleEnum[] = [
  { key: 'none', value: SPVectorEffect.SP_VECTOR_EFFECT_NONE },
  { key: 'non-scaling-stroke', value: SPVectorEffect.SP_VECTOR_EFFECT_NON_SCALING_STROKE },
  { key: 'non-scaling-size', value: SPVectorEffect.SP_VECTOR_EFFECT_NON_SCALING_SIZE },
  { key: 'non-rotation', value: SPVectorEffect.SP_VECTOR_EFFECT_NON_ROTATION },
  { key: 'fixed-position', value: SPVectorEffect.SP_VECTOR_EFFECT_FIXED_POSITION },
];

export const enum_stroke_extensions: readonly SPStyleEnum[] = [
  { key: 'none', value: SPStrokeExtensions.SP_STROKE_EXTENSIONS_NONE },
  { key: 'hairline', value: SPStrokeExtensions.SP_STROKE_EXTENSIONS_HAIRLINE },
];
