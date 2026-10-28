// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/style.cpp, src/style.h
/*
 * SVG stylesheets implementation.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Peter Moulder <pmoulder@mail.csse.monash.edu.au>
 *   bulia byak <buliabyak@users.sf.net>
 *   Abhishek Sharma
 *   Tavmjong Bah <tavmjong@free.fr>
 *   Kris De Gussem <Kris.DeGussem@gmail.com>
 *
 * Copyright (C) 2001-2002 Lauris Kaplinski
 * Copyright (C) 2001 Ximian, Inc.
 * Copyright (C) 2005 Monash University
 * Copyright (C) 2012 Kris De Gussem
 * Copyright (C) 2014-2015 Tavmjong Bah
 * Copyright (C) 2014 Tavmjong Bah
 * Copyright (C) 2010 Jon A. Cruz
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { parseDeclarationList } from './3rdparty/libcroco/cr-declaration.ts';
import { attributeLookup, SPAttr } from './attributes.ts';
import type { SPDocument } from './document.ts';
import type { SPFilter } from './object/sp-filter.ts';
import {
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  type SPObject,
} from './object/sp-object.ts';
import type { SPPaintServer } from './object/sp-paint-server.ts';
import { BadURIException } from './object/uri-references.ts';
import {
  enum_baseline,
  enum_blend_mode,
  enum_clip_rule,
  enum_color_rendering,
  enum_direction,
  enum_display,
  enum_enable_background,
  enum_fill_rule,
  enum_font_style,
  enum_font_variant,
  enum_font_variant_alternates,
  enum_font_variant_caps,
  enum_font_variant_position,
  enum_image_rendering,
  enum_isolation,
  enum_overflow,
  enum_shape_rendering,
  enum_stroke_linecap,
  enum_stroke_linejoin,
  enum_text_align,
  enum_text_anchor,
  enum_text_orientation,
  enum_text_rendering,
  enum_text_transform,
  enum_visibility,
  enum_white_space,
  enum_writing_mode,
  SPBlendMode,
  SPColorRendering,
  SPCSSBaseline,
  SPCSSDirection,
  SPCSSDisplay,
  SPCSSFontStretch,
  SPCSSFontStyle,
  SPCSSFontVariant,
  SPCSSFontVariantAlternates,
  SPCSSFontVariantCaps,
  SPCSSFontVariantEastAsian,
  SPCSSFontVariantLigatures,
  SPCSSFontVariantNumeric,
  SPCSSFontVariantPosition,
  SPCSSFontWeight,
  SPCSSTextAlign,
  SPCSSTextOrientation,
  SPCSSTextTransform,
  SPCSSWritingMode,
  SPEnableBackground,
  SPImageRendering,
  SPIsolation,
  SPOverflow,
  SPShapeRendering,
  SPStrokeCapType,
  SPStrokeJoinType,
  SPTextAnchor,
  SPTextRendering,
  SPVisibility,
  SPWhiteSpace,
  SPWindRule,
} from './style-enums.ts';
import {
  FONT_SIZE_DEFAULT,
  font_size_unit_ratios,
  SP_STYLE_FLAG_ALWAYS,
  SP_STYLE_FLAG_IFDIFF,
  SP_STYLE_FLAG_IFSET,
  SP_STYLE_FLAG_IFSRC,
  SPCSSUnit,
  SPFilterReference,
  type SPIBase,
  SPIBaselineShift,
  SPIColor,
  SPIColorInterpolation,
  SPIDashArray,
  SPIEastAsian,
  SPIEnum,
  SPIEnumFontStretch,
  SPIEnumFontWeight,
  SPIFilter,
  SPIFloat,
  SPIFont,
  SPIFontSize,
  SPIFontVariationSettings,
  SPILength,
  SPILengthOrNormal,
  SPILigatures,
  SPIMarker,
  SPINumeric,
  SPIPaint,
  SPIPaintOrder,
  SPIScale24,
  SPIShapes,
  SPIString,
  SPIStrokeExtensions,
  SPITextDecoration,
  type SPITextDecorationData,
  SPITextDecorationLine,
  SPITextDecorationStyle,
  SPIVectorEffect,
  SPPaintServerReference,
  SPStyleSrc,
} from './style-internal.ts';
import { cssNumber } from './svg/css-ostringstream.ts';
import { convertUnit, readNumberPrefix } from './svg/svg-length.ts';
import { Signal } from './util/signal.ts';
import type { Node } from './xml/node.ts';
import {
  type SPCSSAttr,
  spReprCssAttrAddFromString,
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssChangeRecursive,
  spReprCssProperty,
  spReprCssSetProperty,
  spReprCssUnsetProperty,
  spReprCssWriteString,
} from './xml/repr-css.ts';

export {
  SP_STYLE_FLAG_ALWAYS,
  SP_STYLE_FLAG_IFDIFF,
  SP_STYLE_FLAG_IFSET,
  SP_STYLE_FLAG_IFSRC,
  SPStyleSrc,
} from './style-internal.ts';

/** Upstream: SPMarkerLoc in object/sp-marker-loc.h */
export enum SPMarkerLoc {
  SP_MARKER_LOC,
  SP_MARKER_LOC_START,
  SP_MARKER_LOC_MID,
  SP_MARKER_LOC_END,
  SP_MARKER_LOC_QTY,
}

type Disconnect = () => void;

const warned = new Set<string>();
/** Upstream: g_warning_once */
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

// Reference callbacks ---------------------------------------------------------------------------

/** Emit style modified signal on style's object if the filter changed. */
function spStyleFilterRefModified(_obj: SPObject | null, flags: number, style: SPStyle): void {
  if (flags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
    if (style.object) {
      // FIXME: This line results in now-unnecessary filter recreation.
      style.object.requestModified(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
      if (!style.block_filter_bbox_updates) {
        style.object.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG); // To update bbox.
      }
    }
  }
}

/** Gets called when the filter is (re)attached to the style. */
export function spStyleFilterRefChanged(oldRef: SPObject | null, ref: SPObject | null, style: SPStyle): void {
  if (oldRef) {
    // TODO: oldRef._refcount--
    style.filter_modified_connection?.();
    style.filter_modified_connection = null;
  }
  if (ref) {
    // The reference accepts only filters. TODO: ref._refcount++ (SPFilter.getRefCount).
    style.filter_modified_connection = ref.modifiedSignal.connect((obj, flags) =>
      spStyleFilterRefModified(obj, flags, style),
    );
  }
  style.signal_filter_changed.emit(oldRef, ref);
  spStyleFilterRefModified(ref, 0xff /* SP_OBJECT_FLAGS_ALL */, style);
}

/** Emit style modified signal on style's object if server is style's fill or stroke paint server. */
function spStylePaintServerRefModified(_obj: SPObject | null, _flags: number, style: SPStyle): void {
  if (style.object) {
    // TODO: fixme: I do not know, whether it is optimal - we are forcing reread of everything (Lauris)
    // fixme: We have to use object_modified flag, because parent flag is only available downstreams.
    // FIXME: For patterns and hatches, this line results in now-unnecessary pattern recreation.
    style.object.requestModified(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
  }
}

/** Gets called when the paintserver is (re)attached to the style. */
export function spStyleFillPaintServerRefChanged(
  oldRef: SPObject | null,
  ref: SPObject | null,
  style: SPStyle,
): void {
  if (oldRef) {
    style.fill_ps_modified_connection?.();
    style.fill_ps_modified_connection = null;
  }
  if (ref) {
    // The reference accepts only paint servers (SPPaintServerReference._acceptObject).
    style.fill_ps_modified_connection = ref.modifiedSignal.connect((obj, flags) =>
      spStylePaintServerRefModified(obj, flags, style),
    );
  }
  style.signal_fill_ps_changed.emit(oldRef, ref);
  spStylePaintServerRefModified(ref, 0, style);
}

/** Gets called when the paintserver is (re)attached to the style. */
export function spStyleStrokePaintServerRefChanged(
  oldRef: SPObject | null,
  ref: SPObject | null,
  style: SPStyle,
): void {
  if (oldRef) {
    style.stroke_ps_modified_connection?.();
    style.stroke_ps_modified_connection = null;
  }
  if (ref) {
    style.stroke_ps_modified_connection = ref.modifiedSignal.connect((obj, flags) =>
      spStylePaintServerRefModified(obj, flags, style),
    );
  }
  style.signal_stroke_ps_changed.emit(oldRef, ref);
  spStylePaintServerRefModified(ref, 0, style);
}

// SPStyle ---------------------------------------------------------------------------------------

/** An SVG style object. */
export class SPStyle {
  /** Object we are attached to */
  object: SPObject | null;
  /** Document we are associated with */
  document: SPDocument | null;

  /** Pointers to all the properties (for looping through them), in the order of writing. */
  readonly #properties: SPIBase[] = [];
  readonly #byId = new Map<SPAttr, SPIBase>();

  /* ----------------------- THE PROPERTIES ------------------------- */
  /*                    Match order in the constructor.               */

  /* SVG 2 attributes promoted to properties. */

  /** Path data */
  readonly d = new SPIString(SPAttr.D, false);

  /* Font ---------------------------- */

  /** Font style */
  readonly font_style = new SPIEnum<SPCSSFontStyle>(
    SPAttr.FONT_STYLE,
    enum_font_style,
    SPCSSFontStyle.SP_CSS_FONT_STYLE_NORMAL,
  );
  /** Which substyle of the font (CSS 2. CSS 3 redefines as shorthand) */
  readonly font_variant = new SPIEnum<SPCSSFontVariant>(
    SPAttr.FONT_VARIANT,
    enum_font_variant,
    SPCSSFontVariant.SP_CSS_FONT_VARIANT_NORMAL,
  );
  /** Weight of the font */
  readonly font_weight = new SPIEnumFontWeight(SPAttr.FONT_WEIGHT, SPCSSFontWeight.SP_CSS_FONT_WEIGHT_NORMAL);
  /** Stretch of the font */
  readonly font_stretch = new SPIEnumFontStretch(
    SPAttr.FONT_STRETCH,
    SPCSSFontStretch.SP_CSS_FONT_STRETCH_NORMAL,
  );
  /** Size of the font */
  readonly font_size = new SPIFontSize(SPAttr.FONT_SIZE);
  /** Line height (css2 10.8.1) */
  readonly line_height = new SPILengthOrNormal(SPAttr.LINE_HEIGHT, 1.25);
  /** Font family */
  readonly font_family = new SPIString(SPAttr.FONT_FAMILY);
  /** Font shorthand */
  readonly font = new SPIFont(SPAttr.FONT);
  /** Full font name, as pango_font_description_to_string() would give, for internal use. */
  readonly font_specification = new SPIString(SPAttr.INKSCAPE_FONT_SPEC);

  /* Font variants -------------------- */
  /** Font variant ligatures */
  readonly font_variant_ligatures = new SPILigatures(SPAttr.FONT_VARIANT_LIGATURES);
  /** Font variant position (subscript/superscript) */
  readonly font_variant_position = new SPIEnum<SPCSSFontVariantPosition>(
    SPAttr.FONT_VARIANT_POSITION,
    enum_font_variant_position,
    SPCSSFontVariantPosition.SP_CSS_FONT_VARIANT_POSITION_NORMAL,
  );
  /** Font variant caps (small caps) */
  readonly font_variant_caps = new SPIEnum<SPCSSFontVariantCaps>(
    SPAttr.FONT_VARIANT_CAPS,
    enum_font_variant_caps,
    SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_NORMAL,
  );
  /** Font variant numeric (numerical formatting) */
  readonly font_variant_numeric = new SPINumeric(SPAttr.FONT_VARIANT_NUMERIC);
  /** Font variant alternates (alternates/swatches) */
  readonly font_variant_alternates = new SPIEnum<SPCSSFontVariantAlternates>(
    SPAttr.FONT_VARIANT_ALTERNATES,
    enum_font_variant_alternates,
    SPCSSFontVariantAlternates.SP_CSS_FONT_VARIANT_ALTERNATES_NORMAL,
  );
  /** Font variant East Asian */
  readonly font_variant_east_asian = new SPIEastAsian(SPAttr.FONT_VARIANT_EAST_ASIAN);
  /** Font feature settings (Low level access to TrueType tables) */
  readonly font_feature_settings = new SPIString(SPAttr.FONT_FEATURE_SETTINGS);

  /** Font variation settings (Low level access to OpenType variable font design-coordinate values) */
  readonly font_variation_settings = new SPIFontVariationSettings(SPAttr.FONT_VARIATION_SETTINGS);

  /* Text ----------------------------- */

  /** First line indent of paragraphs (css2 16.1) */
  readonly text_indent = new SPILength(SPAttr.TEXT_INDENT);
  /** text alignment (css2 16.2) (not to be confused with text-anchor) */
  readonly text_align = new SPIEnum<SPCSSTextAlign>(
    SPAttr.TEXT_ALIGN,
    enum_text_align,
    SPCSSTextAlign.SP_CSS_TEXT_ALIGN_START,
  );

  /** letter spacing (css2 16.4) */
  readonly letter_spacing = new SPILengthOrNormal(SPAttr.LETTER_SPACING);
  /** word spacing (also css2 16.4) */
  readonly word_spacing = new SPILengthOrNormal(SPAttr.WORD_SPACING);
  /** capitalization (css2 16.5) */
  readonly text_transform = new SPIEnum<SPCSSTextTransform>(
    SPAttr.TEXT_TRANSFORM,
    enum_text_transform,
    SPCSSTextTransform.SP_CSS_TEXT_TRANSFORM_NONE,
  );

  /* CSS3 Text */
  /** text direction (svg1.1) */
  readonly direction = new SPIEnum<SPCSSDirection>(
    SPAttr.DIRECTION,
    enum_direction,
    SPCSSDirection.SP_CSS_DIRECTION_LTR,
  );
  /** Writing mode (svg1.1 10.7.2, CSS Writing Modes 3) */
  readonly writing_mode = new SPIEnum<SPCSSWritingMode>(
    SPAttr.WRITING_MODE,
    enum_writing_mode,
    SPCSSWritingMode.SP_CSS_WRITING_MODE_LR_TB,
  );
  /** Text orientation (CSS Writing Modes 3) */
  readonly text_orientation = new SPIEnum<SPCSSTextOrientation>(
    SPAttr.TEXT_ORIENTATION,
    enum_text_orientation,
    SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_MIXED,
  );
  /** Dominant baseline (svg1.1) */
  readonly dominant_baseline = new SPIEnum<SPCSSBaseline>(
    SPAttr.DOMINANT_BASELINE,
    enum_baseline,
    SPCSSBaseline.SP_CSS_BASELINE_AUTO,
  );
  /** Baseline shift (svg1.1 10.9.2) */
  readonly baseline_shift = new SPIBaselineShift(SPAttr.BASELINE_SHIFT);

  /* SVG */
  /** Anchor of the text (svg1.1 10.9.1) */
  readonly text_anchor = new SPIEnum<SPTextAnchor>(
    SPAttr.TEXT_ANCHOR,
    enum_text_anchor,
    SPTextAnchor.SP_CSS_TEXT_ANCHOR_START,
  );

  /** white space (svg2) */
  readonly white_space = new SPIEnum<SPWhiteSpace>(
    SPAttr.WHITE_SPACE,
    enum_white_space,
    SPWhiteSpace.SP_CSS_WHITE_SPACE_NORMAL,
  );

  /** SVG2 Text Wrapping */
  readonly shape_inside = new SPIShapes(SPAttr.SHAPE_INSIDE);
  readonly shape_subtract = new SPIShapes(SPAttr.SHAPE_SUBTRACT);
  readonly shape_padding = new SPILength(SPAttr.SHAPE_PADDING);
  readonly shape_margin = new SPILength(SPAttr.SHAPE_MARGIN);
  readonly inline_size = new SPILength(SPAttr.INLINE_SIZE);

  /* Text Decoration ----------------------- */

  /** text decoration (css2 16.3.1) */
  readonly text_decoration = new SPITextDecoration(SPAttr.TEXT_DECORATION);
  /** CSS 3 2.1, 2.2, 2.3 */
  /** Not done yet, test_decoration3        = css3 2.4*/
  readonly text_decoration_line = new SPITextDecorationLine(SPAttr.TEXT_DECORATION_LINE);
  /** SPIEnum? Only one can be set at time. */
  readonly text_decoration_style = new SPITextDecorationStyle(SPAttr.TEXT_DECORATION_STYLE);
  readonly text_decoration_color = new SPIColor(SPAttr.TEXT_DECORATION_COLOR);
  readonly text_decoration_fill = new SPIPaint(SPAttr.TEXT_DECORATION_FILL);
  readonly text_decoration_stroke = new SPIPaint(SPAttr.TEXT_DECORATION_STROKE);
  /** used to implement text_decoration, not saved to or read from SVG file */
  text_decoration_data: SPITextDecorationData = {
    phase_length: 0,
    tspan_line_start: false,
    tspan_line_end: false,
    tspan_width: 0,
    ascender: 0,
    descender: 0,
    underline_thickness: 0,
    underline_position: 0,
    line_through_thickness: 0,
    line_through_position: 0,
  };

  // 16.3.2 is text-shadow. That's complicated.

  /* General visual properties ------------- */

  /** clip-rule: 0 nonzero, 1 evenodd */
  readonly clip_rule = new SPIEnum<SPWindRule>(
    SPAttr.CLIP_RULE,
    enum_clip_rule,
    SPWindRule.SP_WIND_RULE_NONZERO,
  );

  /** display */
  readonly display = new SPIEnum<SPCSSDisplay>(
    SPAttr.DISPLAY,
    enum_display,
    SPCSSDisplay.SP_CSS_DISPLAY_INLINE,
    false,
  );

  /** overflow */
  readonly overflow = new SPIEnum<SPOverflow>(
    SPAttr.OVERFLOW_,
    enum_overflow,
    SPOverflow.SP_CSS_OVERFLOW_VISIBLE,
    false,
  );

  /** visibility */
  readonly visibility = new SPIEnum<SPVisibility>(
    SPAttr.VISIBILITY,
    enum_visibility,
    SPVisibility.SP_CSS_VISIBILITY_VISIBLE,
  );

  /** opacity */
  readonly opacity = new SPIScale24(SPAttr.OPACITY, false);

  /** mix-blend-mode:  CSS Compositing and Blending Level 1 */
  readonly isolation = new SPIEnum<SPIsolation>(
    SPAttr.ISOLATION,
    enum_isolation,
    SPIsolation.SP_CSS_ISOLATION_AUTO,
  );
  readonly mix_blend_mode = new SPIEnum<SPBlendMode>(
    SPAttr.MIX_BLEND_MODE,
    enum_blend_mode,
    SPBlendMode.SP_CSS_BLEND_NORMAL,
  );

  readonly paint_order = new SPIPaintOrder(SPAttr.PAINT_ORDER);

  /** color */
  readonly color = new SPIColor(SPAttr.COLOR);
  /** color-interpolation */
  readonly color_interpolation = new SPIColorInterpolation(SPAttr.COLOR_INTERPOLATION);
  /** color-interpolation-filters */
  readonly color_interpolation_filters = new SPIColorInterpolation(SPAttr.COLOR_INTERPOLATION_FILTERS);

  /** solid-color */
  readonly solid_color = new SPIColor(SPAttr.SOLID_COLOR);
  /** solid-opacity */
  readonly solid_opacity = new SPIScale24(SPAttr.SOLID_OPACITY);

  /** vector effect */
  readonly vector_effect = new SPIVectorEffect(SPAttr.VECTOR_EFFECT);

  /** fill */
  readonly fill = new SPIPaint(SPAttr.FILL);
  /** fill-opacity */
  readonly fill_opacity = new SPIScale24(SPAttr.FILL_OPACITY);
  /** fill-rule: 0 nonzero, 1 evenodd */
  readonly fill_rule = new SPIEnum<SPWindRule>(
    SPAttr.FILL_RULE,
    enum_fill_rule,
    SPWindRule.SP_WIND_RULE_NONZERO,
  );

  /** stroke */
  readonly stroke = new SPIPaint(SPAttr.STROKE);
  /** stroke-width */
  readonly stroke_width = new SPILength(SPAttr.STROKE_WIDTH, 1.0);
  /** stroke-linecap */
  readonly stroke_linecap = new SPIEnum<SPStrokeCapType>(
    SPAttr.STROKE_LINECAP,
    enum_stroke_linecap,
    SPStrokeCapType.SP_STROKE_LINECAP_BUTT,
  );
  /** stroke-linejoin */
  readonly stroke_linejoin = new SPIEnum<SPStrokeJoinType>(
    SPAttr.STROKE_LINEJOIN,
    enum_stroke_linejoin,
    SPStrokeJoinType.SP_STROKE_LINEJOIN_MITER,
  );
  /** stroke-miterlimit */
  readonly stroke_miterlimit = new SPIFloat(SPAttr.STROKE_MITERLIMIT, 4);
  /** stroke-dasharray */
  readonly stroke_dasharray = new SPIDashArray(SPAttr.STROKE_DASHARRAY);
  /** stroke-dashoffset */
  readonly stroke_dashoffset = new SPILength(SPAttr.STROKE_DASHOFFSET);
  /** stroke-opacity */
  readonly stroke_opacity = new SPIScale24(SPAttr.STROKE_OPACITY);
  /** -inkscape-stroke */
  readonly stroke_extensions = new SPIStrokeExtensions(SPAttr.STROKE_EXTENSIONS);

  /** Marker list */
  readonly marker = new SPIMarker(SPAttr.MARKER);
  readonly marker_start = new SPIMarker(SPAttr.MARKER_START);
  readonly marker_mid = new SPIMarker(SPAttr.MARKER_MID);
  readonly marker_end = new SPIMarker(SPAttr.MARKER_END);
  /** Indexed by SPMarkerLoc. */
  readonly marker_ptrs: SPIMarker[];

  /* Filter effects ------------------------ */

  /** Filter effect */
  readonly filter = new SPIFilter(SPAttr.FILTER);
  /**
   * normally not used, but duplicates the Gaussian blur deviation (if any) from the attached
   * filter when the style is used for querying
   */
  // TODO remove, find other logic for querying
  readonly filter_gaussianBlur_deviation = new SPILength(SPAttr.INVALID);
  /** enable-background, used for defining where filter effects get their background image */
  readonly enable_background = new SPIEnum<SPEnableBackground>(
    SPAttr.ENABLE_BACKGROUND,
    enum_enable_background,
    SPEnableBackground.SP_CSS_BACKGROUND_ACCUMULATE,
    false,
  );

  /** gradient-stop */
  readonly stop_color = new SPIColor(SPAttr.STOP_COLOR, false);
  readonly stop_opacity = new SPIScale24(SPAttr.STOP_OPACITY, false);

  /* Rendering hints ----------------------- */

  /**
   * hints on how to render: e.g. speed vs. accuracy.
   * As of April, 2013, only image_rendering used.
   */
  readonly color_rendering = new SPIEnum<SPColorRendering>(
    SPAttr.COLOR_RENDERING,
    enum_color_rendering,
    SPColorRendering.SP_CSS_COLOR_RENDERING_AUTO,
  );
  readonly image_rendering = new SPIEnum<SPImageRendering>(
    SPAttr.IMAGE_RENDERING,
    enum_image_rendering,
    SPImageRendering.SP_CSS_IMAGE_RENDERING_AUTO,
  );
  readonly shape_rendering = new SPIEnum<SPShapeRendering>(
    SPAttr.SHAPE_RENDERING,
    enum_shape_rendering,
    SPShapeRendering.SP_CSS_SHAPE_RENDERING_AUTO,
  );
  readonly text_rendering = new SPIEnum<SPTextRendering>(
    SPAttr.TEXT_RENDERING,
    enum_text_rendering,
    SPTextRendering.SP_CSS_TEXT_RENDERING_AUTO,
  );

  /* ----------------------- END PROPERTIES ------------------------- */

  /** style belongs to a cloned object */
  cloned: boolean;

  /**
   * (hack) Temporarily set to true to block filter changes from updating
   * the object's bbox in situations where this update is undesirable.
   */
  block_filter_bbox_updates = false;

  release_connection: Disconnect | null = null;

  filter_modified_connection: Disconnect | null = null;
  fill_ps_modified_connection: Disconnect | null = null;
  stroke_ps_modified_connection: Disconnect | null = null;

  filter_changed_connection: Disconnect | null = null;
  fill_ps_changed_connection: Disconnect | null = null;
  stroke_ps_changed_connection: Disconnect | null = null;

  /**
   * Emitted when the fill paint server changes, meaning it starts pointing
   * to a different object.
   *
   * Note that this is different from the fill_ps_modified signal, which happens
   * when some of its attributes or children have changed.
   */
  readonly signal_fill_ps_changed = new Signal<[SPObject | null, SPObject | null]>();

  /** Emitted when the stroke paint server changes, meaning it starts pointing to a different object. */
  readonly signal_stroke_ps_changed = new Signal<[SPObject | null, SPObject | null]>();

  /** Emitted when the filter changes, meaning it starts pointing to a different object. */
  readonly signal_filter_changed = new Signal<[SPObject | null, SPObject | null]>();

  /* ----------------------- EXTENDED PROPERTIES ------------------------- */
  extended_properties = new Map<string, string>();

  /** `document` is ignored if a valid object is given. */
  constructor(document: SPDocument | null = null, object: SPObject | null = null) {
    // Unimplemented SVG 1.1: alignment-baseline, clip, clip-path, color-profile, cursor,
    // dominant-baseline, flood-color, flood-opacity, font-size-adjust,
    // glyph-orientation-horizontal, glyph-orientation-vertical, kerning, lighting-color,
    // pointer-events, unicode-bidi

    // 'font', 'font-size', and 'font-family' must come first as other properties depend on them
    // for calculated values (through 'em' and 'ex'). ('ex' is currently not read.)
    // The following properties can depend on 'em' and 'ex':
    //   baseline-shift, kerning, letter-spacing, stroke-dash-offset, stroke-width, word-spacing,
    //   Non-SVG 1.1: text-indent, line-spacing

    this.cloned = false;
    this.object = object;
    if (object) {
      this.document = object.document ?? null;
      this.release_connection = object.releaseSignal.connect(() => {
        this.object = null;
      });
      this.cloned = object.cloned;
    } else {
      this.document = document;
    }

    // 'font' shorthand requires access to included properties.
    this.font.setStylePointer(this);

    // Properties that depend on 'font-size' for calculating lengths.
    this.baseline_shift.setStylePointer(this);
    this.text_indent.setStylePointer(this);
    this.line_height.setStylePointer(this);
    this.letter_spacing.setStylePointer(this);
    this.word_spacing.setStylePointer(this);
    this.stroke_width.setStylePointer(this);
    this.stroke_dashoffset.setStylePointer(this);
    this.shape_padding.setStylePointer(this);
    this.shape_margin.setStylePointer(this);
    this.inline_size.setStylePointer(this);

    // Properties that depend on 'color'
    this.text_decoration_color.setStylePointer(this);
    this.fill.setStylePointer(this);
    this.stroke.setStylePointer(this);
    this.color.setStylePointer(this);
    this.stop_color.setStylePointer(this);
    this.solid_color.setStylePointer(this);
    this.color_interpolation.setStylePointer(this);
    this.color_interpolation_filters.setStylePointer(this);

    // 'text_decoration' shorthand requires access to included properties.
    this.text_decoration.setStylePointer(this);

    // SPIPaint, SPIFilter needs access to 'this' (SPStyle) for setting up signals...  'fill', 'stroke' already done
    this.filter.setStylePointer(this);
    this.shape_inside.setStylePointer(this);
    this.shape_subtract.setStylePointer(this);

    // Markers need style pointer to be connecting to references in the style
    this.marker.setStylePointer(this);
    this.marker_start.setStylePointer(this);
    this.marker_mid.setStylePointer(this);
    this.marker_end.setStylePointer(this);

    // Used to iterate over markers
    this.marker_ptrs = [];
    this.marker_ptrs[SPMarkerLoc.SP_MARKER_LOC] = this.marker;
    this.marker_ptrs[SPMarkerLoc.SP_MARKER_LOC_START] = this.marker_start;
    this.marker_ptrs[SPMarkerLoc.SP_MARKER_LOC_MID] = this.marker_mid;
    this.marker_ptrs[SPMarkerLoc.SP_MARKER_LOC_END] = this.marker_end;

    // The properties in the order of SPStylePropHelper (the order of writing).
    const register = (...props: SPIBase[]) => {
      for (const p of props) {
        this.#properties.push(p);
        if (p.id !== SPAttr.INVALID) this.#byId.set(p.id, p);
      }
    };
    // SVG 2: Attributes promoted to properties
    register(this.d);
    // 'color' must be before 'fill', 'stroke', 'text-decoration-color', ...
    register(this.color);
    // 'font-size'/'font' must be before properties that need to know em, ex size (SPILength, SPILengthOrNormal)
    register(
      this.font_style,
      this.font_variant,
      this.font_weight,
      this.font_stretch,
      this.font_size,
      this.line_height,
      this.font_family,
      this.font,
      this.font_specification,
      // Font variants
      this.font_variant_ligatures,
      this.font_variant_position,
      this.font_variant_caps,
      this.font_variant_numeric,
      this.font_variant_alternates,
      this.font_variant_east_asian,
      this.font_feature_settings,
      // Variable Fonts
      this.font_variation_settings,
      this.text_indent,
      this.text_align,
      this.text_decoration,
      this.text_decoration_line,
      this.text_decoration_style,
      this.text_decoration_color,
      this.text_decoration_fill,
      this.text_decoration_stroke,
      this.letter_spacing,
      this.word_spacing,
      this.text_transform,
      this.writing_mode,
      this.direction,
      this.text_orientation,
      this.dominant_baseline,
      this.baseline_shift,
      this.text_anchor,
      this.white_space,
      this.shape_inside,
      this.shape_subtract,
      this.shape_padding,
      this.shape_margin,
      this.inline_size,
      this.clip_rule,
      this.display,
      this.overflow,
      this.visibility,
      this.opacity,
      this.isolation,
      this.mix_blend_mode,
      this.color_interpolation,
      this.color_interpolation_filters,
      this.solid_color,
      this.solid_opacity,
      this.vector_effect,
      this.fill,
      this.fill_opacity,
      this.fill_rule,
      this.stroke,
      this.stroke_width,
      this.stroke_linecap,
      this.stroke_linejoin,
      this.stroke_miterlimit,
      this.stroke_dasharray,
      this.stroke_dashoffset,
      this.stroke_opacity,
      this.stroke_extensions,
      this.marker,
      this.marker_start,
      this.marker_mid,
      this.marker_end,
      this.paint_order,
      this.filter,
      this.color_rendering,
      this.image_rendering,
      this.shape_rendering,
      this.text_rendering,
      this.enable_background,
      this.stop_color,
      this.stop_opacity,
    );
  }

  /** Release the connections of the style. Upstream: the destructor. */
  dispose(): void {
    this.release_connection?.();
    this.fill_ps_changed_connection?.();
    this.stroke_ps_changed_connection?.();
    this.filter_changed_connection?.();
    this.fill_ps_modified_connection?.();
    this.stroke_ps_modified_connection?.();
    this.filter_modified_connection?.();
  }

  properties(): readonly SPIBase[] {
    return this.#properties;
  }

  /** The property with the given id, or undefined. */
  getProperty(id: SPAttr): SPIBase | undefined {
    return this.#byId.get(id);
  }

  /** Clear one property, or all (and recreate the references) if id is not given. */
  clear(id?: SPAttr): void {
    if (id !== undefined) {
      const p = this.#byId.get(id);
      if (p) p.clear();
      else console.warn(`Unimplemented style property ${id}`);
      return;
    }

    for (const p of this.#properties) p.clear();

    // Release connection to object, created in constructor.
    this.release_connection?.();
    this.release_connection = null;

    this.fill_ps_modified_connection?.();
    this.fill_ps_modified_connection = null;
    this.stroke_ps_modified_connection?.();
    this.stroke_ps_modified_connection = null;

    this.filter_modified_connection?.();
    this.filter_modified_connection = null;
    this.filter_changed_connection?.();
    this.filter_changed_connection = null;
    this.filter.href = null;

    // Prioritize 'object' over 'document' when recreating the filter reference.
    if (this.object) {
      this.filter.href = new SPFilterReference(this.object);
    } else if (this.document) {
      this.filter.href = new SPFilterReference(this.document);
    }

    if (this.filter.href) {
      this.filter_changed_connection = this.filter.href.changedSignal.connect((old, ref) =>
        spStyleFilterRefChanged(old, ref, this),
      );
    }

    if (this.document) {
      this.fill_ps_changed_connection?.();
      this.fill.href = new SPPaintServerReference(this.document);
      this.fill_ps_changed_connection = this.fill.href.changedSignal.connect((old, ref) =>
        spStyleFillPaintServerRefChanged(old, ref, this),
      );

      this.stroke_ps_changed_connection?.();
      this.stroke.href = new SPPaintServerReference(this.document);
      this.stroke_ps_changed_connection = this.stroke.href.changedSignal.connect((old, ref) =>
        spStyleStrokePaintServerRefChanged(old, ref, this),
      );
    }

    this.cloned = false;
  }

  /** Matches sp_style_read(SPStyle *style, SPObject *object, Inkscape::XML::Node *repr). */
  read(object: SPObject | null, repr: Node): void {
    if (object && object.getRepr() !== repr) throw new Error('SPStyle.read: repr is not the repr of object');

    this.clear(); // FIXME, If this isn't here, EVERYTHING stops working! Why?

    if (!this.document && object) this.document = object.document ?? null;
    if (object?.cloned) this.cloned = true;

    /* 1. Style attribute */
    const val = repr.attribute('style');
    if (val) this.#mergeString(val);

    /* 2 Style sheet */
    if (object) this.#mergeObjectStylesheet(object);

    /* 3 Presentation attributes */
    for (const p of this.#properties) {
      // Shorthands are not allowed as presentation properties. Note: text-decoration and
      // font-variant are converted to shorthands in CSS 3 but can still be read as a
      // non-shorthand for compatibility with older renders, so they should not be in this list.
      if (p.id !== SPAttr.FONT && p.id !== SPAttr.MARKER) p.readAttribute(repr);
    }

    /* 4 Cascade from parent */
    if (object) {
      if (object.parent) this.cascade(object.parent.style);
    } else if (repr.parent()) {
      // When does this happen?
      const parent = new SPStyle(this.document);
      parent.read(null, repr.parent()!);
      this.cascade(parent);
      parent.dispose();
    }
  }

  /**
   * Read style properties from object's repr.
   *
   * 1. Reset existing object style
   * 2. Load current effective object style
   * 3. Load i attributes from immediate parent (which has to be up-to-date)
   */
  readFromObject(object: SPObject): void {
    this.read(object, object.getRepr());
  }

  // TODO: readFromPrefs(path) reads the style from the preferences, which are not ported.

  /** Matches sp_style_merge_property(SPStyle *style, gint id, gchar const *val). */
  readIfUnset(id: SPAttr, val: string, source: SPStyleSrc = SPStyleSrc.STYLE_PROP): void {
    switch (id) {
      /* SVG */
      /* Clip/Mask */
      case SPAttr.CLIP_PATH:
        // TODO: This is a workaround. Inkscape only supports 'clip-path' as SVG attribute, not as
        // style property. By having both CSS and SVG attribute set, editing of clip-path
        // will fail, since CSS always overwrites SVG attributes.
        // Fixes Bug #324849
        warnOnce("attribute 'clip-path' given as CSS");
        // XML Tree being directly used here.
        this.object?.setAttribute('clip-path', val);
        return;
      case SPAttr.MASK:
        // See comment for SPAttr::CLIP_PATH
        warnOnce("attribute 'mask' given as CSS");
        // XML Tree being directly used here.
        this.object?.setAttribute('mask', val);
        return;
      case SPAttr.FILTER:
        if (!this.filter.inherit) this.filter.readIfUnset(val, source);
        return;
    }

    const p = this.#byId.get(id);
    if (p) p.readIfUnset(val, source);
    else warnOnce(`Unimplemented style property ${id}`);
  }

  /** Whether the property is set. */
  isSet(id: SPAttr): boolean {
    switch (id) {
      case SPAttr.CLIP_PATH:
      case SPAttr.MASK:
        return false;
      case SPAttr.FILTER:
        return this.filter.inherit ? false : this.filter.set;
    }
    const p = this.#byId.get(id);
    if (p) return p.set;
    warnOnce(`Unimplemented style property ${id}`);
    return false;
  }

  /**
   * Outputs the style to a CSS string.
   *
   * Use with SP_STYLE_FLAG_ALWAYS for copying an object's complete cascaded style to
   * style_clipboard.
   *
   * Use with SP_STYLE_FLAG_IFDIFF and a base style (the parent) when you need a CSS string for
   * an object in the document tree.
   */
  #write(flags: number, styleSrcReq: SPStyleSrc, base: SPStyle | null = null): string {
    // If not excluding this case, we'd end up writing all non-inheritable properties.
    // Can happen when adding fallback <tspan>s to text like this:
    // <text style="shape-inside:url(#x)">Hello</text>
    if (base === this) {
      if (!(flags & SP_STYLE_FLAG_IFDIFF) || flags & SP_STYLE_FLAG_ALWAYS) {
        throw new Error('SPStyle.write: base is this, but flags are not IFDIFF');
      }
      return '';
    }

    let styleString = '';
    for (let i = 0; i < this.#properties.length; ++i) {
      styleString += this.#properties[i]!.write(flags, styleSrcReq, base ? base.#properties[i]! : null);
    }

    // Extended properties. Cascading not supported.
    for (const [key, value] of this.extended_properties) styleString += `${key}:${value};`;

    // Remove trailing ';'
    return styleString.slice(0, -1);
  }

  /** Get CSS string for set properties, or with SP_STYLE_FLAG_ALWAYS, for all properties. */
  write(flags: number = SP_STYLE_FLAG_IFSET): string {
    if (!(flags & (SP_STYLE_FLAG_IFSET | SP_STYLE_FLAG_ALWAYS)))
      throw new Error('SPStyle.write: invalid flags');
    return this.#write(flags, SPStyleSrc.UNSET);
  }

  /** Get CSS string for set properties from the requested source. Upstream: write(SPStyleSrc). */
  writeSrc(styleSrcReq: SPStyleSrc): string {
    if (styleSrcReq === SPStyleSrc.UNSET) throw new Error('SPStyle.writeSrc: source is UNSET');
    return this.#write(SP_STYLE_FLAG_IFSRC | SP_STYLE_FLAG_IFSET, styleSrcReq);
  }

  /**
   * Get CSS string for set properties which are different from the given
   * base style. If base is null, all set flags are considered different.
   */
  writeIfDiff(base: SPStyle | null): string {
    return this.#write(SP_STYLE_FLAG_IFDIFF, SPStyleSrc.UNSET, base);
  }

  /**
   * Sets computed values in this style, which may involve inheriting from (or in some other way
   * calculating from) corresponding computed values of parent.
   *
   * References: http://www.w3.org/TR/SVG11/propidx.html shows what properties inherit by default.
   * http://www.w3.org/TR/SVG11/styling.html#Inheritance gives general rules as to what it means to
   * inherit a value.  http://www.w3.org/TR/REC-CSS2/cascade.html#computed-value is more precise
   * about what the computed value is (not obvious for lengths).
   *
   * Precondition: parent's computed values are already up-to-date.
   */
  cascade(parent: SPStyle): void {
    for (let i = 0; i < this.#properties.length; ++i) {
      this.#properties[i]!.cascade(parent.#properties[i]!);
    }
  }

  /**
   * Combine this style and parent style specifications into a single style specification that
   * preserves (as much as possible) the effect of the existing style being a child of parent.
   *
   * Called when the parent repr is to be removed (e.g. the parent is a <use> element that is being
   * unlinked), in which case we copy/adapt property values that are explicitly set in parent,
   * trying to retain the same visual appearance once the parent is removed. Interesting cases are
   * when there is unusual interaction with the parent's value (opacity, display) or when the value
   * can be specified as relative to the parent computed value (font-size, font-weight etc.).
   *
   * Doesn't update computed values of this style. For correctness, you should subsequently call
   * cascade against the new parent (presumably parent's parent) even if the style was previously
   * up-to-date wrt parent.
   *
   * Precondition: parent's computed values are already up-to-date. (The computed values of this
   * style needn't be up-to-date.)
   */
  merge(parent: SPStyle): void {
    for (let i = 0; i < this.#properties.length; ++i) {
      this.#properties[i]!.merge(parent.#properties[i]!);
    }
  }

  /** Parses a style="..." string and merges it with an existing SPStyle. */
  mergeString(p: string): void {
    this.#mergeString(p);
  }

  mergeCSS(css: SPCSSAttr): void {
    this.#mergeString(spReprCssWriteString(css));
  }

  // TODO: mergeStatement(CRStatement) appends a statement of a stylesheet as STYLE_SHEET declarations.

  /** Mostly for unit testing. Upstream: operator==. */
  equals(rhs: SPStyle): boolean {
    for (let i = 0; i < this.#properties.length; ++i) {
      if (!this.#properties[i]!.equals(rhs.#properties[i]!)) return false;
    }
    return true;
  }

  #mergeString(p: string): void {
    this.#mergeDeclList(parseDeclarationList(p), SPStyleSrc.STYLE_PROP);
  }

  #mergeDeclList(declList: ReturnType<typeof parseDeclarationList>, source: SPStyleSrc): void {
    // In reverse order, as later declarations to take precedence over earlier ones.
    // (Properties are only set if not previously set. See:
    // Ref: http://www.w3.org/TR/REC-CSS2/cascade.html#cascading-order point 4.)
    for (let i = declList.length - 1; i >= 0; --i) this.#mergeDecl(declList[i]!, source);
  }

  #mergeDecl(decl: ReturnType<typeof parseDeclarationList>[number], source: SPStyleSrc): void {
    const propIdx = attributeLookup(decl.property);
    if (propIdx !== SPAttr.INVALID) {
      // TODO: effic: Test whether the property is already set before trying to convert to string.
      // Alternatively, set from the term directly rather than converting to string.
      if (!this.isSet(propIdx) || decl.important) {
        // Add "!important" rule if necessary as this is not handled by the term printer.
        this.readIfUnset(propIdx, decl.value + (decl.important ? ' !important' : ''), source);
      }
    } else if (decl.property.startsWith('--')) {
      console.warn(`Ignoring CSS variable: ${decl.property}`);
    } else if (decl.property.startsWith('-')) {
      this.extended_properties.set(decl.property, decl.value);
    } else {
      console.warn(`Ignoring unrecognized CSS property: ${decl.property}`);
    }
  }

  #mergeObjectStylesheet(_object: SPObject): void {
    // TODO: Stylesheets (svg:style elements, selectors) are not ported. Upstream merges here the
    // properties that match the object in the cascade of the document and of its parent and
    // reference documents (as STYLE_SHEET), between the style attribute and the presentation attributes.
  }

  /** Used for input into Pango. Must be computed value! */
  getFontFeatureString(): string {
    const features: string[] = [];
    const lig = this.font_variant_ligatures.computed;
    const L = SPCSSFontVariantLigatures;
    if (!(lig & L.SP_CSS_FONT_VARIANT_LIGATURES_COMMON)) features.push('liga 0', 'clig 0');
    if (lig & L.SP_CSS_FONT_VARIANT_LIGATURES_DISCRETIONARY) features.push('dlig');
    if (lig & L.SP_CSS_FONT_VARIANT_LIGATURES_HISTORICAL) features.push('hlig');
    if (!(lig & L.SP_CSS_FONT_VARIANT_LIGATURES_CONTEXTUAL)) features.push('calt 0');

    switch (this.font_variant_position.computed) {
      case SPCSSFontVariantPosition.SP_CSS_FONT_VARIANT_POSITION_SUB:
        features.push('subs');
        break;
      case SPCSSFontVariantPosition.SP_CSS_FONT_VARIANT_POSITION_SUPER:
        features.push('sups');
    }

    switch (this.font_variant_caps.computed) {
      case SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_SMALL:
        features.push('smcp');
        break;
      case SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_ALL_SMALL:
        features.push('smcp', 'c2sc');
        break;
      case SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_PETITE:
        features.push('pcap');
        break;
      case SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_ALL_PETITE:
        features.push('pcap', 'c2pc');
        break;
      case SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_UNICASE:
        features.push('unic');
        break;
      case SPCSSFontVariantCaps.SP_CSS_FONT_VARIANT_CAPS_TITLING:
        features.push('titl');
    }

    const num = this.font_variant_numeric.computed;
    const N = SPCSSFontVariantNumeric;
    if (num & N.SP_CSS_FONT_VARIANT_NUMERIC_LINING_NUMS) features.push('lnum');
    if (num & N.SP_CSS_FONT_VARIANT_NUMERIC_OLDSTYLE_NUMS) features.push('onum');
    if (num & N.SP_CSS_FONT_VARIANT_NUMERIC_PROPORTIONAL_NUMS) features.push('pnum');
    if (num & N.SP_CSS_FONT_VARIANT_NUMERIC_TABULAR_NUMS) features.push('tnum');
    if (num & N.SP_CSS_FONT_VARIANT_NUMERIC_DIAGONAL_FRACTIONS) features.push('frac');
    if (num & N.SP_CSS_FONT_VARIANT_NUMERIC_STACKED_FRACTIONS) features.push('afrc');
    if (num & N.SP_CSS_FONT_VARIANT_NUMERIC_ORDINAL) features.push('ordn');
    if (num & N.SP_CSS_FONT_VARIANT_NUMERIC_SLASHED_ZERO) features.push('zero');

    const ea = this.font_variant_east_asian.computed;
    const E = SPCSSFontVariantEastAsian;
    if (ea & E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS78) features.push('jp78');
    if (ea & E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS83) features.push('jp83');
    if (ea & E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS90) features.push('jp90');
    if (ea & E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS04) features.push('jp04');
    if (ea & E.SP_CSS_FONT_VARIANT_EAST_ASIAN_SIMPLIFIED) features.push('smpl');
    if (ea & E.SP_CSS_FONT_VARIANT_EAST_ASIAN_TRADITIONAL) features.push('trad');
    if (ea & E.SP_CSS_FONT_VARIANT_EAST_ASIAN_FULL_WIDTH) features.push('fwid');
    if (ea & E.SP_CSS_FONT_VARIANT_EAST_ASIAN_PROPORTIONAL_WIDTH) features.push('pwid');
    if (ea & E.SP_CSS_FONT_VARIANT_EAST_ASIAN_RUBY) features.push('ruby');

    const val = this.font_feature_settings.value();
    if (val && val !== 'normal') {
      // We do no sanity checking...
      features.push(val);
    }

    return features.length === 0 ? 'normal' : features.join(', ');
  }

  // The references.
  getFilter(): SPFilter | null {
    // The reference accepts only filters (SPFilterReference._acceptObject).
    return this.filter.href ? (this.filter.href.getObject() as SPFilter | null) : null;
  }
  getFilterURI(): string | null {
    return this.filter.href ? this.filter.href.getURI() : null;
  }
  getFillPaintServer(): SPPaintServer | null {
    return this.fill.href ? this.fill.href.getObject() : null;
  }
  getFillURI(): string | null {
    return this.fill.href ? this.fill.href.getURI() : null;
  }
  getStrokePaintServer(): SPPaintServer | null {
    return this.stroke.href ? this.stroke.href.getObject() : null;
  }
  getStrokeURI(): string | null {
    return this.stroke.href ? this.stroke.href.getURI() : null;
  }

  /** Get either the fill or the stroke property. */
  getFillOrStroke(fill: boolean): SPIPaint {
    return fill ? this.fill : this.stroke;
  }
}

// The following functions should be incorporated into SPIPaint. FIXME
// Called in: style.cpp, style-internal.cpp
export function spStyleSetIpaintToUri(
  style: SPStyle,
  paint: SPIPaint,
  uri: string | null,
  document: SPDocument | null,
): void {
  if (!paint.href) {
    if (style.object) {
      // Should not happen as href should have been created in SPIPaint. (TODO: Removed code duplication.)
      paint.href = new SPPaintServerReference(style.object);
    } else if (document || style.document) {
      // Used by desktop style (no object to attach to!).
      paint.href = new SPPaintServerReference((document ?? style.document) as SPDocument);
    } else {
      console.error('sp_style_set_ipaint_to_uri: No valid object or document!');
      return;
    }

    const href = paint.href;
    if (paint === style.fill) {
      style.fill_ps_changed_connection = href.changedSignal.connect((old, ref) =>
        spStyleFillPaintServerRefChanged(old, ref, style),
      );
    } else {
      style.stroke_ps_changed_connection = href.changedSignal.connect((old, ref) =>
        spStyleStrokePaintServerRefChanged(old, ref, style),
      );
    }
  }

  if (paint.href) {
    if (paint.href.getObject()) paint.href.detach();
    if (uri !== null) {
      try {
        paint.href.attach(uri);
      } catch (e) {
        if (!(e instanceof BadURIException)) throw e;
        console.warn(e.message);
        paint.href.detach();
      }
    }
  }
}

// Called in: style.cpp, style-internal.cpp
export function spStyleSetIpaintToUriString(style: SPStyle, paint: SPIPaint, uri: string): void {
  spStyleSetIpaintToUri(style, paint, uri, style.document);
}

// Called in: desktop-style.cpp
export function spStyleSetToUri(style: SPStyle, isfill: boolean, uri: string | null): void {
  spStyleSetIpaintToUri(style, style.getFillOrStroke(isfill), uri, style.document);
}

// Called in: widgets/font-selector.cpp, widgets/text-toolbar.cpp, ui/dialog/text-edit.cpp
export function spStyleGetCssUnitString(unit: number): string {
  // specify px by default, see inkscape bug 1221626, mozilla bug 234789
  // This is a problematic fix as some properties (e.g. 'line-height') have
  // different behaviour if there is no unit.
  switch (unit) {
    case SPCSSUnit.SP_CSS_UNIT_NONE:
      return 'px';
    case SPCSSUnit.SP_CSS_UNIT_PX:
      return 'px';
    case SPCSSUnit.SP_CSS_UNIT_PT:
      return 'pt';
    case SPCSSUnit.SP_CSS_UNIT_PC:
      return 'pc';
    case SPCSSUnit.SP_CSS_UNIT_MM:
      return 'mm';
    case SPCSSUnit.SP_CSS_UNIT_CM:
      return 'cm';
    case SPCSSUnit.SP_CSS_UNIT_IN:
      return 'in';
    case SPCSSUnit.SP_CSS_UNIT_EM:
      return 'em';
    case SPCSSUnit.SP_CSS_UNIT_EX:
      return 'ex';
    case SPCSSUnit.SP_CSS_UNIT_PERCENT:
      return '%';
    default:
      return 'px';
  }
}

/** Convert a size in pixels into another CSS unit size. */
export function spStyleCssSizePxToUnits(size: number, unit: number, fontSize = FONT_SIZE_DEFAULT): number {
  let unitSize = size;

  if (fontSize === 0) {
    console.warn('sp_style_get_css_font_size_units: passed in zero font_size');
    fontSize = FONT_SIZE_DEFAULT;
  }

  switch (unit) {
    case SPCSSUnit.SP_CSS_UNIT_NONE:
    case SPCSSUnit.SP_CSS_UNIT_PX:
      unitSize = size;
      break;
    case SPCSSUnit.SP_CSS_UNIT_PT:
      unitSize = convertUnit(size, 'px', 'pt');
      break;
    case SPCSSUnit.SP_CSS_UNIT_PC:
      unitSize = convertUnit(size, 'px', 'pc');
      break;
    case SPCSSUnit.SP_CSS_UNIT_MM:
      unitSize = convertUnit(size, 'px', 'mm');
      break;
    case SPCSSUnit.SP_CSS_UNIT_CM:
      unitSize = convertUnit(size, 'px', 'cm');
      break;
    case SPCSSUnit.SP_CSS_UNIT_IN:
      unitSize = convertUnit(size, 'px', 'in');
      break;
    case SPCSSUnit.SP_CSS_UNIT_EM:
      unitSize = size / fontSize;
      break;
    case SPCSSUnit.SP_CSS_UNIT_EX:
      unitSize = (size * 2.0) / fontSize;
      break;
    case SPCSSUnit.SP_CSS_UNIT_PERCENT:
      unitSize = (size * 100.0) / fontSize;
      break;
    default:
      console.warn(`sp_style_get_css_font_size_units conversion to ${unit} not implemented.`);
      break;
  }

  return unitSize;
}

/** Convert a size in a CSS unit size to pixels. */
export function spStyleCssSizeUnitsToPx(size: number, unit: number, fontSize = FONT_SIZE_DEFAULT): number {
  if (unit === SPCSSUnit.SP_CSS_UNIT_PX) return size;
  return size * (size / spStyleCssSizePxToUnits(size, unit, fontSize));
}

/**
 * Avoid rounding errors when, say, converting stored 'px' values to displayed 'pt' values.
 * We just don't want to confuse the user when they see 12.999 instead of 13.
 */
export function spStyleCssSizeRoundForUserDisplay(size: number): number {
  const roundedSize = Math.round(size);
  if (Math.abs((size - roundedSize) / size) < 0.0001) return roundedSize;
  return size;
}

const fontSizeLists: number[][] = [];

/** Create a list containing the default list of font sizes scaled for the given unit. */
export function spStyleGetDefaultFontSizeList(unit: number): readonly number[] {
  // List of font sizes for dropdown menu
  const sizes = [4, 6, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 144];

  let ratio = 1;
  if (unit >= SPCSSUnit.SP_CSS_UNIT_NONE && unit <= SPCSSUnit.SP_CSS_UNIT_PERCENT) {
    ratio = font_size_unit_ratios[unit]!;
  } else {
    console.warn(`Unexpected font size unit ${unit}`);
    unit = SPCSSUnit.SP_CSS_UNIT_PX;
  }

  let list = fontSizeLists[unit];
  if (!list || list.length === 0) {
    list = sizes.map((n) => n / ratio);
    fontSizeLists[unit] = list;
  }
  return list;
}

// FIXME: Everything below this line belongs in a different file - css-chemistry?

export function spStyleSetPropertyUrl(
  item: SPObject,
  property: string,
  linked: SPObject | null,
  recursive: boolean,
): void {
  spStyleSetPropertyUrlOnRepr(item.getRepr(), property, linked, recursive);
}

export function spStyleSetPropertyUrlOnRepr(
  repr: Node | null,
  property: string,
  linked: SPObject | null,
  recursive: boolean,
): void {
  if (repr === null) return;

  const css = spReprCssAttrNew();
  if (linked) {
    spReprCssSetProperty(css, property, `url(#${linked.getId()})`);
  } else {
    spReprCssUnsetProperty(css, property);
  }

  if (recursive) spReprCssChangeRecursive(repr, css, 'style');
  else spReprCssChange(repr, css, 'style');
}

/**
 * Precondition: flags in {IFSET, ALWAYS}.
 * Only used by spCssAttrFromObject() and in splivarot.cpp - sp_item_path_outline().
 */
export function spCssAttrFromStyle(style: SPStyle, flags: number): SPCSSAttr {
  if (!(flags & SP_STYLE_FLAG_IFSET) && !(flags & SP_STYLE_FLAG_ALWAYS)) {
    throw new Error('spCssAttrFromStyle: flags must be IFSET or ALWAYS');
  }
  const css = spReprCssAttrNew();
  spReprCssAttrAddFromString(css, style.write(flags));
  return css;
}

// Called in: selection-chemistry.cpp, widgets/stroke-marker-selector.cpp, widgets/stroke-style.cpp,
// ui/tools/freehand-base.cpp, pattern-manipulation.cpp
/** Precondition: flags in {IFSET, ALWAYS}. Returns null if the object has no style. */
export function spCssAttrFromObject(object: SPObject, flags: number = SP_STYLE_FLAG_IFSET): SPCSSAttr | null {
  if (flags !== SP_STYLE_FLAG_IFSET && flags !== SP_STYLE_FLAG_ALWAYS) {
    throw new Error('spCssAttrFromObject: flags must be IFSET or ALWAYS');
  }
  return object.style ? spCssAttrFromStyle(object.style, flags) : null;
}

const unset = (css: SPCSSAttr, names: readonly string[]): SPCSSAttr => {
  for (const name of names) spReprCssSetProperty(css, name, null);
  return css;
};

// Called in: selection-chemistry.cpp, ui/dialog/inkscape-preferences.cpp
/** Unset any text-related properties. */
export function spCssAttrUnsetText(css: SPCSSAttr): SPCSSAttr {
  return unset(css, [
    'font',
    '-inkscape-font-specification',
    'font-size',
    'font-size-adjust', // not implemented yet
    'font-style',
    'font-variant',
    'font-weight',
    'font-stretch',
    'font-family',
    'text-indent',
    'text-align',
    'line-height',
    'letter-spacing',
    'word-spacing',
    'text-transform',
    'direction',
    'writing-mode',
    'text-orientation',
    'text-anchor',
    'white-space',
    'shape-inside',
    'shape-subtract',
    'shape-padding',
    'shape-margin',
    'inline-size',
    'kerning', // not implemented yet
    'dominant-baseline', // not implemented yet
    'alignment-baseline', // not implemented yet
    'baseline-shift',
    'text-decoration',
    'text-decoration-line',
    'text-decoration-color',
    'text-decoration-style',
    'font-variant-ligatures',
    'font-variant-position',
    'font-variant-caps',
    'font-variant-numeric',
    'font-variant-alternates',
    'font-variant-east-asian',
    'font-feature-settings',
  ]);
}

// ui/dialog/inkscape-preferences.cpp
/**
 * Unset properties that should not be set for default tool style.
 * This list needs to be reviewed.
 */
export function spCssAttrUnsetBlacklist(css: SPCSSAttr): SPCSSAttr {
  return unset(css, [
    'color',
    'clip-rule',
    'd',
    'display',
    'overflow',
    'visibility',
    'isolation',
    'mix-blend-mode',
    'filter',
    'color-interpolation',
    'color-interpolation-filters',
    'solid-color',
    'solid-opacity',
    'fill-rule',
    'color-rendering',
    'image-rendering',
    'shape-rendering',
    'text-rendering',
    'enable-background',
    'shape-inside', // Don't want this in a style even if it doesn't contain a uri
    'shape-subtract',
    'stop-color',
    'stop-opacity',
  ]);
}

// Called in style.cpp
// TODO: CSS2 says any URIs in property values must start with 'url('. I'm not sure if this applies to SVG as well.
function isUrl(p: string | null): boolean {
  return p !== null && p.slice(0, 4).toLowerCase() === 'url(';
}

// Called in: ui/dialog/inkscape-preferences.cpp, ui/tools/tweek-tool.cpp
/**
 * Unset any properties that contain URI values.
 *
 * Used for storing style that will be reused across documents when carrying
 * the referenced defs is impractical.
 */
export function spCssAttrUnsetUris(css: SPCSSAttr): SPCSSAttr {
  // All properties that may hold <uri> or <paint> according to SVG 1.1
  for (const name of [
    'clip-path',
    'color-profile',
    'cursor',
    'filter',
    'marker',
    'marker-start',
    'marker-mid',
    'marker-end',
    'mask',
    'fill',
    'shape-inside',
    'shape-subtract',
    'stroke',
  ]) {
    if (isUrl(spReprCssProperty(css, name, null))) spReprCssSetProperty(css, name, null);
  }
  return css;
}

// Called in style.cpp
/** Scale a single-value property. */
function spCssAttrScalePropertySingle(
  css: SPCSSAttr,
  property: string,
  ex: number,
  onlyWithUnits = false,
): void {
  const w = spReprCssProperty(css, property, null);
  if (w === null) return;
  const n = readNumberPrefix(w);
  if (!n) return; // nothing converted, non-numeric value
  const wd = n.value * ex;
  const units = n.rest;
  if (onlyWithUnits && (units === '' || units[0] === '%' || units[0] === 'e')) {
    // only_with_units, but no units found, so do nothing.
    // 'e' matches 'em' or 'ex'
    return;
  }
  spReprCssSetProperty(css, property, cssNumber(wd) + units); // reattach units
}

// Called in style.cpp for stroke-dasharray
/** Scale a list-of-values property. */
function spCssAttrScalePropertyList(css: SPCSSAttr, property: string, ex: number): void {
  const str = spReprCssProperty(css, property, null);
  if (str === null) return;
  const parts: string[] = [];
  for (const w of str.split(',')) {
    const n = readNumberPrefix(w);
    if (!n) return; // nothing converted, non-numeric value ("none" or "inherit"); do nothing
    parts.push(cssNumber(n.value * ex) + n.rest); // reattach units
  }
  spReprCssSetProperty(css, property, parts.join(','));
}

// Called in: text-editing.cpp,
/** Scale any properties that may hold <length> by ex. */
export function spCssAttrScale(css: SPCSSAttr, ex: number): SPCSSAttr {
  spCssAttrScalePropertySingle(css, 'baseline-shift', ex);
  spCssAttrScalePropertySingle(css, 'stroke-width', ex);
  spCssAttrScalePropertyList(css, 'stroke-dasharray', ex);
  spCssAttrScalePropertySingle(css, 'stroke-dashoffset', ex);
  spCssAttrScalePropertySingle(css, 'font-size', ex, true);
  spCssAttrScalePropertySingle(css, 'kerning', ex);
  spCssAttrScalePropertySingle(css, 'letter-spacing', ex);
  spCssAttrScalePropertySingle(css, 'word-spacing', ex);
  spCssAttrScalePropertySingle(css, 'line-height', ex, true);
  return css;
}

/**
 * Quote and/or escape string for writing to CSS.
 * See: http://www.w3.org/TR/CSS21/syndata.html#value-def-identifier
 */
export function cssQuote(val: string): string {
  let out = '';
  let quote = false;
  let first = true;
  for (const ch of val) {
    if (/[A-Za-z0-9]/.test(ch) || ch === '-' || ch === '_' || ch.codePointAt(0)! > 0xa0) {
      out += ch;
    } else if (ch === "'") {
      // Single quotes require escaping and quotes.
      out += `\\${ch}`;
      quote = true;
    } else {
      // Quote everything else including spaces.
      // (CSS Fonts Level 3 recommends quoting with spaces.)
      out += ch;
      quote = true;
    }
    if (first && !/[A-Za-z]/.test(ch)) {
      // A non-ASCII/non-alpha initial value on any identifier needs quotes.
      // (Actually it's a bit more complicated but as it never hurts to quote...)
      quote = true;
    }
    first = false;
  }
  return quote ? `'${out}'` : out;
}

/**
 * Quote font names in font-family lists.
 * We use unquoted names internally but some need to be quoted in CSS.
 */
export function cssFontFamilyQuote(val: string): string {
  return val
    .split(/\s*,\s*/)
    .map((token) => cssQuote(token))
    .join(', ');
}

// Called in style-internal.cpp, xml/repr-css.cpp
/** Remove paired single and double quotes from a string. */
export function cssUnquote(val: string): string {
  if (val.length > 1 && ((val[0] === '"' && val.at(-1) === '"') || (val[0] === "'" && val.at(-1) === "'"))) {
    return val.slice(1, -1);
  }
  return val;
}

// Called in style-internal.cpp, text-toolbar.cpp
/**
 * Remove paired single and double quotes from font names in font-family lists.
 * We use unquoted family names internally but CSS sometimes uses quoted names.
 */
export function cssFontFamilyUnquote(val: string): string {
  return val
    .split(/\s*,\s*/)
    .map((token) => cssUnquote(token))
    .join(', ');
}
