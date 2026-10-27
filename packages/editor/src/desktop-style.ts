// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/desktop-style.cpp, src/desktop-style.h
/*
 * Desktop style management
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2001-2005 authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  Colors,
  type ObjectSet,
  Preferences,
  type SPCSSAttr,
  SPItem,
  type SPObject,
  SPStrokeCapType,
  SPStrokeJoinType,
  type SPStyle,
  spCssAttrScale,
  spCssAttrUnsetText,
  spCssAttrUnsetUris,
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssMerge,
  spReprCssProperty,
  spReprCssSetProperty,
  spReprCssSetPropertyDouble,
  spReprCssSetPropertyString,
  spStyleSetToUri,
} from '@inkscape-web/core';
import type { SPDesktop } from './desktop.ts';

/** Result of a style query (upstream QUERY_STYLE_* in desktop-style.h). */
export enum QueryStyleResult {
  /** Nothing was queried, for example no selection. */
  QUERY_STYLE_NOTHING,
  /** A single object was queried. */
  QUERY_STYLE_SINGLE,
  /** Multiple objects were queried, the results were the same. */
  QUERY_STYLE_MULTIPLE_SAME,
  /** Multiple objects were queried, the results could not be averaged and differ. */
  QUERY_STYLE_MULTIPLE_DIFFERENT,
  /** Multiple objects were queried, the results were averaged. */
  QUERY_STYLE_MULTIPLE_AVERAGED,
}
export const {
  QUERY_STYLE_NOTHING,
  QUERY_STYLE_SINGLE,
  QUERY_STYLE_MULTIPLE_SAME,
  QUERY_STYLE_MULTIPLE_DIFFERENT,
  QUERY_STYLE_MULTIPLE_AVERAGED,
} = QueryStyleResult;

/**
 * Properties that sp_desktop_query_style() can query (upstream QUERY_STYLE_PROPERTY_*).
 * TODO: the font, text, paint order, blend, isolation and blur properties.
 */
export enum QueryStyleProperty {
  QUERY_STYLE_PROPERTY_EVERYTHING,
  /** fill, fill-opacity */
  QUERY_STYLE_PROPERTY_FILL,
  /** stroke, stroke-opacity */
  QUERY_STYLE_PROPERTY_STROKE,
  /** stroke-width */
  QUERY_STYLE_PROPERTY_STROKEWIDTH,
  /** stroke-miterlimit */
  QUERY_STYLE_PROPERTY_STROKEMITERLIMIT,
  /** stroke-linejoin */
  QUERY_STYLE_PROPERTY_STROKEJOIN,
  /** stroke-linecap */
  QUERY_STYLE_PROPERTY_STROKECAP,
  /** opacity */
  QUERY_STYLE_PROPERTY_MASTEROPACITY,
}
export const {
  QUERY_STYLE_PROPERTY_EVERYTHING,
  QUERY_STYLE_PROPERTY_FILL,
  QUERY_STYLE_PROPERTY_STROKE,
  QUERY_STYLE_PROPERTY_STROKEWIDTH,
  QUERY_STYLE_PROPERTY_STROKEMITERLIMIT,
  QUERY_STYLE_PROPERTY_STROKEJOIN,
  QUERY_STYLE_PROPERTY_STROKECAP,
  QUERY_STYLE_PROPERTY_MASTEROPACITY,
} = QueryStyleProperty;

/** Set the color of the fill or the stroke on the selection of desktop. */
export function sp_desktop_set_color(
  desktop: SPDesktop,
  color: Colors.Color,
  is_relative: boolean,
  fill: boolean,
): void {
  /// TODO: relative color setting
  if (is_relative) {
    console.warn('FIXME: relative color setting not yet implemented');
    return;
  }
  const css = spReprCssAttrNew();
  spReprCssSetPropertyString(css, fill ? 'fill' : 'stroke', color.toString(false));
  spReprCssSetPropertyDouble(css, fill ? 'fill-opacity' : 'stroke-opacity', color.getOpacity());
  sp_desktop_set_style(desktop, css);
}

/**
 * Apply css to o and its children, recursively.
 * TODO: the special cases of text, flowed text and clones in flow regions (skip_lines).
 */
export function sp_desktop_apply_css_recursive(o: SPObject, css: SPCSSAttr, skip_lines: boolean): void {
  // non-items should not have style
  if (!(o instanceof SPItem)) return;

  const css_set = spReprCssAttrNew();
  spReprCssMerge(css_set, css);

  // Scale the style by the inverse of the accumulated parent transform in the paste context.
  const ex = o.i2docAffine().descrim();
  if (ex !== 0 && ex !== 1) spCssAttrScale(css_set, 1 / ex);

  spReprCssChange(o.getRepr(), css_set, 'style');

  // Setting style on the child of a clone spills into the clone original (via shared repr), don't do it!
  if (o.getRepr().name() === 'svg:use') return;

  for (const child of o.children) {
    if (spReprCssProperty(css, 'opacity', null) !== null) {
      // Unset properties which are accumulating and thus should not be set recursively.
      // For example, setting opacity 0.5 on a group recursively would result in the
      // visible opacity of 0.25 for an item in the group.
      const css_recurse = spReprCssAttrNew();
      spReprCssMerge(css_recurse, css);
      spReprCssSetProperty(css_recurse, 'opacity', null);
      sp_desktop_apply_css_recursive(child, css_recurse, skip_lines);
    } else {
      sp_desktop_apply_css_recursive(child, css, skip_lines);
    }
  }
}

/** Names of the item types in the "/desktop/<type>/style" preferences (upstream item_type_map). */
const ITEM_TYPE_MAP: Record<string, string | null> = {
  circle: 'arc',
  polygon: 'star',
  'text-flow': 'text',
  group: null,
};

/**
 * Apply css to the selection of desktop (or to set). With write_current the style is also
 * remembered as the style for new objects (desktop.current, "/desktop/style" and
 * "/desktop/<item type>/style"). With change false nothing is applied to the objects.
 */
export function sp_desktop_set_style(
  desktop: SPDesktop,
  css: SPCSSAttr,
  change = true,
  write_current = true,
  switch_style = false,
  set: ObjectSet = desktop.getSelection(),
): void {
  if (write_current) {
    const prefs = Preferences.get();
    // 1. Set internal value
    spReprCssMerge(desktop.current, css);

    // 1a. Write to prefs; make a copy and unset any URIs first
    const css_write = spReprCssAttrNew();
    spReprCssMerge(css_write, css);
    spCssAttrUnsetUris(css_write);
    prefs.mergeStyle('/desktop/style', css_write);

    // Update the current style of all selected item types
    const selected_item_types = new Set(set.items().map((obj) => obj.typeName()));
    for (const type of selected_item_types) {
      const item_type = type in ITEM_TYPE_MAP ? ITEM_TYPE_MAP[type] : type;
      if (item_type) prefs.mergeStyle(`/desktop/${item_type}/style`, css_write);
    }
  }

  if (!change) return;

  // 2. Emit signal. See desktop.connectSetStyle.
  const intercepted = desktop.emitSetStyle(css, switch_style);

  // TODO: in set_style, compensate pattern and gradient fills, stroke width, rect corners,
  // font size for the object's own transform so that pasting fills does not depend on
  // preserve/optimize (a FIXME upstream as well).

  // 3. If nobody has intercepted the signal, apply the style to the selection
  if (!intercepted) {
    // Remove text attributes if not text. Do this once in case a zillion objects are selected.
    // TODO: text items keep the text attributes (no text objects yet).
    const css_no_text = spReprCssAttrNew();
    spReprCssMerge(css_no_text, css);
    spCssAttrUnsetText(css_no_text);
    for (const item of set.items()) sp_desktop_apply_css_recursive(item, css_no_text, true);
  }
}

/**
 * The color of the style for new objects (desktop.current) for the fill or the stroke, or
 * undefined if it is not a flat color.
 */
export function sp_desktop_get_color(desktop: SPDesktop, is_fill: boolean): Colors.Color | undefined {
  const property = spReprCssProperty(desktop.current, is_fill ? 'fill' : 'stroke', null);
  const color = Colors.Color.parse(property);
  if (!color) return undefined;
  const opacity = spReprCssProperty(desktop.current, is_fill ? 'fill-opacity' : 'stroke-opacity', null);
  const value = Number.parseFloat(opacity ?? '');
  return Number.isNaN(value) ? color : color.withOpacity(value);
}

/**
 * Write to style_res the average fill or stroke of objects, if applicable.
 * TODO: compare the paint servers (gradients, patterns, hatches) of several objects.
 */
export function objects_query_fillstroke(
  objects: readonly SPItem[],
  style_res: SPStyle,
  isfill: boolean,
): QueryStyleResult {
  if (objects.length === 0) return QUERY_STYLE_NOTHING; // No objects, set empty

  const paint_res = style_res.getFillOrStroke(isfill);
  paint_res.set = true;

  let paintImpossible = true;
  const colors = new Colors.ColorSet();

  for (const [index, obj] of objects.entries()) {
    const style = obj.style;
    const paint = style.getFillOrStroke(isfill);

    // TODO: paint is also "effectively set" within text hierarchies.
    const paint_effectively_set = paint.set;

    // 1. Bail out with QUERY_STYLE_MULTIPLE_DIFFERENT if necessary
    if (!paintImpossible && (!paint.isSameType(paint_res) || paint_res.set !== paint_effectively_set)) {
      return QUERY_STYLE_MULTIPLE_DIFFERENT; // different types of paint
    }

    // 2. Sum color, copy server from paint to paint_res
    if (paint_res.set && paint.isColor()) {
      const copy = paint.getColor();
      copy.addOpacity(isfill ? style.fill_opacity.as_double() : style.stroke_opacity.as_double());
      if (colors.isEmpty()) paint_res.setColor(copy);
      // Upstream keys the colors by object id; objects without id would be lost.
      colors.set(obj.getId() ?? `#${index}`, copy);
    }

    paintImpossible = false;
    paint_res.paintOrigin = paint.paintOrigin;
    paint_res.paintSource = paint.paintSource;
    if (paint_res.set && paint_effectively_set && paint.isPaintserver()) {
      // copy the server
      spStyleSetToUri(style_res, isfill, isfill ? style.getFillURI() : style.getStrokeURI());
    }
    paint_res.set = paint_effectively_set;
    style_res.fill_rule.computed = style.fill_rule.computed; // no averaging on this, just use the last one
  }

  if (paint_res.set && paint_res.isColor() && !colors.isEmpty()) {
    const color = colors.getAverage();
    if (isfill) style_res.fill_opacity.set_double(color.stealOpacity());
    else style_res.stroke_opacity.set_double(color.stealOpacity());
    paint_res.setColor(color);

    if (colors.size() > 1) return colors.isSame() ? QUERY_STYLE_MULTIPLE_SAME : QUERY_STYLE_MULTIPLE_AVERAGED;
    return QUERY_STYLE_SINGLE;
  }

  // Not color
  return objects.length > 1 ? QUERY_STYLE_MULTIPLE_SAME : QUERY_STYLE_SINGLE;
}

/** Write to style_res the average opacity of objects. */
export function objects_query_opacity(objects: readonly SPItem[], style_res: SPStyle): QueryStyleResult {
  if (objects.length === 0) return QUERY_STYLE_NOTHING;

  let opacity_sum = 0;
  let opacity_prev = -1;
  let same_opacity = true;
  for (const obj of objects) {
    const opacity = obj.style.opacity.as_double();
    opacity_sum += opacity;
    if (opacity_prev !== -1 && opacity !== opacity_prev) same_opacity = false;
    opacity_prev = opacity;
  }
  if (objects.length > 1) opacity_sum /= objects.length;

  style_res.opacity.set_double(opacity_sum);

  if (objects.length === 1) return QUERY_STYLE_SINGLE;
  return same_opacity ? QUERY_STYLE_MULTIPLE_SAME : QUERY_STYLE_MULTIPLE_AVERAGED;
}

/**
 * Write to style_res the average stroke width of objects, in desktop units (the item
 * transforms are applied). Only objects with a stroke width are counted.
 */
export function objects_query_strokewidth(objects: readonly SPItem[], style_res: SPStyle): QueryStyleResult {
  if (objects.length === 0) return QUERY_STYLE_NOTHING;

  let avgwidth = 0.0;
  let prev_sw = -1;
  let same_sw = true;
  let noneSet = true; // is stroke set to none?
  let prev_hairline = false;
  let n_stroked = 0;

  for (const item of objects) {
    const style = item.style;
    noneSet &&= style.stroke.isNone();

    if (style.stroke_extensions.hairline) {
      // Can't average a bool. It's true if there's any hairlines in the selection.
      style_res.stroke_extensions.hairline = true;
    }
    if (n_stroked > 0 && prev_hairline !== style.stroke_extensions.hairline) same_sw = false;
    prev_hairline = style.stroke_extensions.hairline;

    const sw = style.stroke_width.computed * item.i2dtAffine().descrim();
    if (!Number.isNaN(sw)) {
      if (prev_sw !== -1 && Math.abs(sw - prev_sw) > 1e-3) same_sw = false;
      prev_sw = sw;
      avgwidth += sw;
      n_stroked++;
    } else if (style.stroke_extensions.hairline) {
      n_stroked++;
    }
  }

  if (n_stroked > 1) avgwidth /= n_stroked;

  style_res.stroke_width.computed = avgwidth;
  style_res.stroke_width.set = true;
  style_res.stroke.noneSet = noneSet; // Will only be true if none of the selected objects has its stroke set.

  if (n_stroked === 0) return QUERY_STYLE_NOTHING;
  if (n_stroked === 1) return QUERY_STYLE_SINGLE;
  return same_sw ? QUERY_STYLE_MULTIPLE_SAME : QUERY_STYLE_MULTIPLE_AVERAGED;
}

/** Write to style_res the average miter limit of the objects that have a stroke. */
export function objects_query_miterlimit(objects: readonly SPItem[], style_res: SPStyle): QueryStyleResult {
  if (objects.length === 0) return QUERY_STYLE_NOTHING;

  let avgml = 0.0;
  let n_stroked = 0;
  let prev_ml = -1;
  let same_ml = true;

  for (const { style } of objects) {
    if (style.stroke.isNone()) continue;
    n_stroked++;
    if (prev_ml !== -1 && Math.abs(style.stroke_miterlimit.value - prev_ml) > 1e-3) same_ml = false;
    prev_ml = style.stroke_miterlimit.value;
    avgml += style.stroke_miterlimit.value;
  }
  if (n_stroked > 1) avgml /= n_stroked;

  style_res.stroke_miterlimit.value = avgml;
  style_res.stroke_miterlimit.set = true;

  if (n_stroked === 0) return QUERY_STYLE_NOTHING;
  if (n_stroked === 1) return QUERY_STYLE_SINGLE;
  return same_ml ? QUERY_STYLE_MULTIPLE_SAME : QUERY_STYLE_MULTIPLE_AVERAGED;
}

/** Write to style_res the stroke cap of the objects that have a stroke. */
export function objects_query_strokecap(objects: readonly SPItem[], style_res: SPStyle): QueryStyleResult {
  if (objects.length === 0) return QUERY_STYLE_NOTHING;

  let prev_cap = SPStrokeCapType.SP_STROKE_LINECAP_BUTT;
  let same_cap = true;
  let n_stroked = 0;
  for (const { style } of objects) {
    if (style.stroke.isNone()) continue;
    n_stroked++;
    if (n_stroked > 1 && style.stroke_linecap.value !== prev_cap) same_cap = false;
    prev_cap = style.stroke_linecap.value;
  }

  style_res.stroke_linecap.value = prev_cap;
  style_res.stroke_linecap.set = true;

  if (n_stroked === 0) return QUERY_STYLE_NOTHING;
  if (n_stroked === 1) return QUERY_STYLE_SINGLE;
  return same_cap ? QUERY_STYLE_MULTIPLE_SAME : QUERY_STYLE_MULTIPLE_DIFFERENT;
}

/** Write to style_res the stroke join of the objects that have a stroke. */
export function objects_query_strokejoin(objects: readonly SPItem[], style_res: SPStyle): QueryStyleResult {
  if (objects.length === 0) return QUERY_STYLE_NOTHING;

  let prev_join = SPStrokeJoinType.SP_STROKE_LINEJOIN_MITER;
  let same_join = true;
  let n_stroked = 0;
  for (const { style } of objects) {
    if (style.stroke.isNone()) continue;
    n_stroked++;
    if (n_stroked > 1 && style.stroke_linejoin.value !== prev_join) same_join = false;
    prev_join = style.stroke_linejoin.value;
  }

  style_res.stroke_linejoin.value = prev_join;
  style_res.stroke_linejoin.set = true;

  if (n_stroked === 0) return QUERY_STYLE_NOTHING;
  if (n_stroked === 1) return QUERY_STYLE_SINGLE;
  return same_join ? QUERY_STYLE_MULTIPLE_SAME : QUERY_STYLE_MULTIPLE_DIFFERENT;
}

/** Query objects for property, write the result to style and return the result kind. */
export function sp_desktop_query_style_from_list(
  list: readonly SPItem[],
  style: SPStyle,
  property: QueryStyleProperty,
): QueryStyleResult {
  switch (property) {
    case QUERY_STYLE_PROPERTY_FILL:
      return objects_query_fillstroke(list, style, true);
    case QUERY_STYLE_PROPERTY_STROKE:
      return objects_query_fillstroke(list, style, false);
    case QUERY_STYLE_PROPERTY_STROKEWIDTH:
      return objects_query_strokewidth(list, style);
    case QUERY_STYLE_PROPERTY_STROKEMITERLIMIT:
      return objects_query_miterlimit(list, style);
    case QUERY_STYLE_PROPERTY_STROKECAP:
      return objects_query_strokecap(list, style);
    case QUERY_STYLE_PROPERTY_STROKEJOIN:
      return objects_query_strokejoin(list, style);
    case QUERY_STYLE_PROPERTY_MASTEROPACITY:
      return objects_query_opacity(list, style);
    default:
      return QUERY_STYLE_NOTHING;
  }
}

/**
 * Query the selection of desktop for property, write the result to style and return the
 * result kind.
 * TODO: the query-style signal of the sub-selection of tools.
 */
export function sp_desktop_query_style(
  desktop: SPDesktop,
  style: SPStyle,
  property: QueryStyleProperty,
): QueryStyleResult {
  const selection = desktop.getSelection();
  if (selection.isEmpty()) return QUERY_STYLE_NOTHING;
  return sp_desktop_query_style_from_list(selection.items(), style, property);
}
