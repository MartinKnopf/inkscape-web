// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/fill-and-stroke.cpp, src/ui/dialog/fill-and-stroke.h, src/ui/widget/stroke-style.cpp, src/ui/widget/paint-switch.cpp, src/ui/widget/paint-enums.cpp, src/ui/widget/object-composite-settings.cpp
/*
 * Fill and Stroke dialog: the logic behind the widgets. It reads the paint and the stroke style of
 * the selection with sp_desktop_query_style() and changes them with sp_desktop_set_style(), each
 * change with its undo step.
 *
 * Authors:
 *   Jon A. Cruz <jon@joncruz.org>
 *   Gustav Broberg <broberg@kth.se>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007-2024 Authors
 */
import {
  C_,
  type Colors,
  DocumentUndo,
  Preferences,
  type SPCSSAttr,
  type SPIPaint,
  type SPItem,
  SPStrokeCapType,
  SPStrokeJoinType,
  SPStyle,
  SPWindRule,
  spReprCssAttrNew,
  spReprCssSetProperty,
  spReprCssSetPropertyDouble,
  spReprCssSetPropertyString,
  spReprCssUnsetProperty,
} from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';
import {
  QUERY_STYLE_MULTIPLE_DIFFERENT,
  QUERY_STYLE_NOTHING,
  QUERY_STYLE_PROPERTY_FILL,
  QUERY_STYLE_PROPERTY_MASTEROPACITY,
  QUERY_STYLE_PROPERTY_STROKE,
  QUERY_STYLE_PROPERTY_STROKECAP,
  QUERY_STYLE_PROPERTY_STROKEJOIN,
  QUERY_STYLE_PROPERTY_STROKEMITERLIMIT,
  QUERY_STYLE_PROPERTY_STROKEWIDTH,
  type QueryStyleResult,
  sp_desktop_apply_css_recursive,
  sp_desktop_get_color,
  sp_desktop_query_style,
  sp_desktop_set_color,
  sp_desktop_set_style,
} from '../../desktop-style.ts';

const ICON = 'dialog-fill-and-stroke';
const UNDO = 'Undo';

/** The kinds of paint of the Fill and Stroke tabs (upstream Inkscape::UI::Widget::PaintMode). */
export enum PaintMode {
  None,
  Solid,
  Gradient,
  Mesh,
  Pattern,
  Swatch,
  /** Inherited or not set (upstream PaintDerivedMode). */
  Derived,
}

/** What the paint of the selection looks like. */
export type PaintInfo =
  /** Nothing is selected. */
  | { kind: 'empty' }
  /** The selected objects have different kinds of paint. */
  | { kind: 'multiple' }
  | { kind: 'paint'; mode: PaintMode; color: Colors.Color; fillRule: SPWindRule };

/** The mode of paint (upstream get_mode_from_paint). */
export function paintModeFromPaint(paint: SPIPaint): PaintMode {
  if (paint.isDerived()) return PaintMode.Derived;
  if (paint.isPaintserver()) return PaintMode.Gradient; // TODO: patterns, hatches, meshes, swatches
  if (paint.isColor()) return PaintMode.Solid;
  return PaintMode.None;
}

/**
 * The paint of the selection (fill or stroke) for the tabs of the dialog
 * (upstream FillAndStroke::_updateFromSelection). Like upstream, the first selected object shows
 * the color; objects with different kinds of paint show "Multiple styles".
 */
export function queryPaint(desktop: SPDesktop, isFill: boolean): PaintInfo {
  const items = desktop.getSelection().items();
  const anchor = items[0];
  if (!anchor) return { kind: 'empty' };

  const query = new SPStyle(desktop.getDocument());
  const result = sp_desktop_query_style(
    desktop,
    query,
    isFill ? QUERY_STYLE_PROPERTY_FILL : QUERY_STYLE_PROPERTY_STROKE,
  );
  if (result === QUERY_STYLE_MULTIPLE_DIFFERENT) return { kind: 'multiple' };

  const style = anchor.style;
  const paint = style.getFillOrStroke(isFill);
  const mode = paintModeFromPaint(paint);
  const opacity = (isFill ? style.fill_opacity : style.stroke_opacity).as_double();
  let color = paint.isColor() ? paint.getColor() : undefined;
  // Without a color, offer the last used one (desktop.current) for when the mode changes to flat color.
  color ??= sp_desktop_get_color(desktop, isFill) ?? paint.getColor();
  color = color.clone();
  color.enableOpacity(true);
  color.setOpacity(opacity);
  return { kind: 'paint', mode, color, fillRule: style.fill_rule.computed };
}

/** Set the paint to a flat color; sliders merge their steps (upstream get_flat_color_changed). */
export function setFlatColor(desktop: SPDesktop, color: Colors.Color, isFill: boolean): void {
  sp_desktop_set_color(desktop, color, false, isFill);
  DocumentUndo.maybeDone(
    desktop.getDocument(),
    isFill ? 'fill:flatcolor' : 'stroke:flatcolor',
    isFill ? C_(UNDO, 'Set fill color') : C_(UNDO, 'Set stroke color'),
    ICON,
  );
}

/**
 * Change the kind of the paint of the selection (upstream get_signal_mode_changed). For
 * PaintMode.Solid, color is the flat color to set.
 * TODO: the gradient, mesh, pattern and swatch modes.
 */
export function setPaintMode(
  desktop: SPDesktop,
  isFill: boolean,
  mode: PaintMode,
  color?: Colors.Color,
): void {
  if (desktop.getSelection().isEmpty()) return;
  const doc = desktop.getDocument();
  const property = isFill ? 'fill' : 'stroke';
  switch (mode) {
    case PaintMode.None: {
      const css = spReprCssAttrNew();
      spReprCssSetProperty(css, property, 'none');
      sp_desktop_set_style(desktop, css, true);
      DocumentUndo.done(doc, isFill ? C_(UNDO, 'Remove fill') : C_(UNDO, 'Remove stroke'), ICON);
      break;
    }
    case PaintMode.Derived: {
      const css = spReprCssAttrNew();
      spReprCssUnsetProperty(css, property);
      sp_desktop_set_style(desktop, css, true);
      DocumentUndo.done(doc, isFill ? C_(UNDO, 'Unset fill') : C_(UNDO, 'Unset stroke'), ICON);
      break;
    }
    case PaintMode.Solid:
      if (color) setFlatColor(desktop, color, isFill);
      break;
    default:
      break; // TODO
  }
}

/** Set the fill rule (upstream get_fill_rule_changed). */
export function setFillRule(desktop: SPDesktop, rule: SPWindRule): void {
  const css = spReprCssAttrNew();
  spReprCssSetProperty(css, 'fill-rule', rule === SPWindRule.SP_WIND_RULE_EVENODD ? 'evenodd' : 'nonzero');
  sp_desktop_set_style(desktop, css, true);
  DocumentUndo.maybeDone(desktop.getDocument(), 'change-fill-rule', C_(UNDO, 'Change fill rule'), ICON);
}

// Opacity ---------------------------------------------------------------------------------------

/** The opacity of the selection from 0 to 1, or null if nothing is selected (upstream ObjectCompositeSettings). */
export function queryOpacity(desktop: SPDesktop): number | null {
  const query = new SPStyle(desktop.getDocument());
  const result = sp_desktop_query_style(desktop, query, QUERY_STYLE_PROPERTY_MASTEROPACITY);
  return result === QUERY_STYLE_NOTHING ? null : query.opacity.as_double();
}

/** Set the opacity of the selection from 0 to 1. Steps of one slider drag are one undo step. */
export function setOpacity(desktop: SPDesktop, opacity: number): void {
  const css = spReprCssAttrNew();
  spReprCssSetPropertyDouble(css, 'opacity', Math.min(1, Math.max(0, opacity)));
  sp_desktop_set_style(desktop, css);
  DocumentUndo.maybeDone(desktop.getDocument(), 'fillstroke:opacity', C_(UNDO, 'Change opacity'), ICON);
}

// Stroke style ----------------------------------------------------------------------------------

/** A unit of the stroke width (upstream Inkscape::Util::Unit, the used part). */
export interface StrokeUnit {
  abbr: string;
  /** Pixels per unit, or null for the percent of the old width. */
  pxPerUnit: number | null;
}

/** The units of the stroke width. TODO: all units of upstream's units table. */
export const STROKE_UNITS: readonly StrokeUnit[] = [
  { abbr: 'px', pxPerUnit: 1 },
  { abbr: 'mm', pxPerUnit: 96 / 25.4 },
  { abbr: 'cm', pxPerUnit: 96 / 2.54 },
  { abbr: 'in', pxPerUnit: 96 },
  { abbr: 'pt', pxPerUnit: 96 / 72 },
  { abbr: '%', pxPerUnit: null },
];

/** The width in px for width_typed in unit, for an item with the given old width (upstream calc_scale_line_width). */
export function calc_scale_line_width(width_typed: number, item: SPItem, unit: StrokeUnit): number {
  if (unit.pxPerUnit === null) {
    const scale = item.i2docAffine().descrim();
    return ((item.style.stroke_width.computed * width_typed) / 100) * scale;
  }
  return width_typed * unit.pxPerUnit;
}

/** Number of px as a string for CSS, like CSSOStringStream (8 significant digits, no trailing zeros). */
const cssNumber = (x: number): string => String(Number(x.toPrecision(8)));

/** Set the dash properties of css: pattern and offset in units of scale (upstream set_scaled_dash). */
export function set_scaled_dash(
  css: SPCSSAttr,
  dash: readonly number[],
  offset: number,
  scale: number,
): void {
  if (dash.length > 0) {
    spReprCssSetProperty(css, 'stroke-dasharray', dash.map((d) => cssNumber(d * scale)).join(','));
    spReprCssSetProperty(css, 'stroke-dashoffset', cssNumber(offset * scale));
  } else {
    spReprCssSetProperty(css, 'stroke-dasharray', 'none');
    spReprCssSetProperty(css, 'stroke-dashoffset', null);
  }
}

/** The dash pattern and offset of style in units of the stroke width (upstream getDashFromStyle). */
export function getDashFromStyle(style: SPStyle): { dash: number[]; offset: number } {
  const scaledash =
    Preferences.get().getBool('/options/dash/scale', true) && style.stroke_width.computed
      ? style.stroke_width.computed
      : 1.0;
  return {
    dash: style.stroke_dasharray.values.map((v) => v.value / scaledash),
    offset: style.stroke_dashoffset.value / scaledash,
  };
}

/** The dash patterns of the preferences "/palette/dashes" (upstream preferences-skeleton.h), in units of the stroke width. */
export const DASH_PATTERNS: readonly (readonly number[])[] = [
  [],
  [3, 2],
  [1, 1],
  [1, 2],
  [1, 3],
  [1, 4],
  [1, 6],
  [1, 8],
  [1, 12],
  [1, 24],
  [1, 48],
  [0, 11],
  [2, 1],
  [3, 1],
  [4, 1],
  [6, 1],
  [8, 1],
  [12, 1],
  [24, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [6, 6],
  [8, 8],
  [12, 12],
  [24, 24],
  [2, 4],
  [4, 2],
  [2, 6],
  [6, 2],
  [4, 8],
  [8, 4],
  [2, 1, 0.5, 1],
  [4, 2, 1, 2],
  [8, 2, 1, 2],
  [0.5, 0.5],
  [0.25, 0.25],
  [0.1, 0.1],
];

/** The stroke style of the selection (upstream StrokeStyle::updateLine). */
export interface StrokeStyleInfo {
  /** Average width in px (desktop units), see QUERY_STYLE_PROPERTY_STROKEWIDTH. */
  width: number;
  /** Whether the selected objects have the same width, or averaged widths (shown in percent). */
  widthResult: QueryStyleResult;
  /** False if no selected object has a stroke: only the width stays editable. */
  enabled: boolean;
  /** The join, the cap and the miter limit; null if the selected objects differ. */
  join: SPStrokeJoinType | null;
  cap: SPStrokeCapType | null;
  miterLimit: number;
  /** Dash pattern and offset of the first selected object, in units of the stroke width. */
  dash: number[];
  dashOffset: number;
}

/** Whether the result of a query has one value to show (upstream is_query_style_updateable). */
const isUpdateable = (result: QueryStyleResult) =>
  result !== QUERY_STYLE_NOTHING && result !== QUERY_STYLE_MULTIPLE_DIFFERENT;

/** The stroke style of the selection, or null if nothing is selected. */
export function queryStrokeStyle(desktop: SPDesktop): StrokeStyleInfo | null {
  const first = desktop.getSelection().items()[0];
  if (!first) return null;
  const query = new SPStyle(desktop.getDocument());
  const widthResult = sp_desktop_query_style(desktop, query, QUERY_STYLE_PROPERTY_STROKEWIDTH);
  const miterResult = sp_desktop_query_style(desktop, query, QUERY_STYLE_PROPERTY_STROKEMITERLIMIT);
  const capResult = sp_desktop_query_style(desktop, query, QUERY_STYLE_PROPERTY_STROKECAP);
  const joinResult = sp_desktop_query_style(desktop, query, QUERY_STYLE_PROPERTY_STROKEJOIN);
  const { dash, offset } = getDashFromStyle(first.style);
  return {
    width: query.stroke_width.computed,
    widthResult,
    enabled: widthResult !== QUERY_STYLE_NOTHING && !query.stroke.isNoneSet(),
    join: isUpdateable(joinResult) ? query.stroke_linejoin.value : null,
    cap: isUpdateable(capResult) ? query.stroke_linecap.value : null,
    miterLimit: isUpdateable(miterResult) ? query.stroke_miterlimit.value : 4,
    dash,
    dashOffset: offset,
  };
}

/** Set the stroke width, typed in unit, and scale the dashes with it (upstream StrokeStyle::setStrokeWidth). */
export function setStrokeWidth(desktop: SPDesktop, width_typed: number, unit: StrokeUnit): void {
  // TODO: hairline strokes.
  const css = spReprCssAttrNew();
  const scaleDashes = Preferences.get().getBool('/options/dash/scale', true);
  for (const item of desktop.getSelection().items()) {
    const width = calc_scale_line_width(width_typed, item, unit);
    spReprCssSetPropertyDouble(css, 'stroke-width', width);
    if (scaleDashes) {
      // This reads the old stroke-width to un-scale the pattern.
      const { dash, offset } = getDashFromStyle(item.style);
      set_scaled_dash(css, dash, offset, width);
    }
    sp_desktop_apply_css_recursive(item, css, true);
  }
  sp_desktop_set_style(desktop, css, false);
  DocumentUndo.done(desktop.getDocument(), C_(UNDO, 'Set stroke width'), ICON);
}

/** Set the dash pattern (in units of the stroke width) of the selection (upstream StrokeStyle::setStrokeDash). */
export function setStrokeDash(desktop: SPDesktop, dash: readonly number[], offset: number): void {
  const css = spReprCssAttrNew();
  const scaleToWidth = Preferences.get().getBool('/options/dash/scale', true);
  for (const item of desktop.getSelection().items()) {
    let scale = item.i2docAffine().descrim();
    if (scaleToWidth) scale = item.style.stroke_width.computed * scale;
    set_scaled_dash(css, dash, offset, scale);
    sp_desktop_apply_css_recursive(item, css, true);
  }
  sp_desktop_set_style(desktop, css, false);
  DocumentUndo.done(desktop.getDocument(), C_(UNDO, 'Set stroke dash'), ICON);
}

/** Set the miter limit of the selection (upstream StrokeStyle::setStrokeMiter). */
export function setStrokeMiter(desktop: SPDesktop, value: number): void {
  const css = spReprCssAttrNew();
  spReprCssSetPropertyDouble(css, 'stroke-miterlimit', value);
  for (const item of desktop.getSelection().items()) sp_desktop_apply_css_recursive(item, css, true);
  sp_desktop_set_style(desktop, css, false);
  DocumentUndo.done(desktop.getDocument(), C_(UNDO, 'Set stroke miter'), ICON);
}

/** Set the line join ("miter", "round" or "bevel") or the line cap ("butt", "round" or "square"). */
export function setStrokeJoinOrCap(
  desktop: SPDesktop,
  property: 'stroke-linejoin' | 'stroke-linecap',
  value: string,
): void {
  const css = spReprCssAttrNew();
  spReprCssSetPropertyString(css, property, value);
  sp_desktop_set_style(desktop, css);
  DocumentUndo.done(desktop.getDocument(), C_(UNDO, 'Set stroke style'), ICON);
}

export const JOIN_NAMES: Readonly<Record<SPStrokeJoinType, string>> = {
  [SPStrokeJoinType.SP_STROKE_LINEJOIN_MITER]: 'miter',
  [SPStrokeJoinType.SP_STROKE_LINEJOIN_ROUND]: 'round',
  [SPStrokeJoinType.SP_STROKE_LINEJOIN_BEVEL]: 'bevel',
};

export const CAP_NAMES: Readonly<Record<SPStrokeCapType, string>> = {
  [SPStrokeCapType.SP_STROKE_LINECAP_BUTT]: 'butt',
  [SPStrokeCapType.SP_STROKE_LINECAP_ROUND]: 'round',
  [SPStrokeCapType.SP_STROKE_LINECAP_SQUARE]: 'square',
};
