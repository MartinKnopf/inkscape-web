// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/fill-and-stroke.cpp, src/ui/dialog/fill-and-stroke.h, src/ui/widget/stroke-style.cpp, src/ui/widget/paint-switch.cpp, src/ui/widget/paint-enums.cpp, src/ui/widget/object-composite-settings.cpp, src/ui/widget/gradient-editor.cpp
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
  type SPGradient,
  type SPGradientSpread,
  SPGradientType,
  type SPIPaint,
  type SPItem,
  SPLinearGradient,
  type SPPaintServer,
  SPPattern,
  SPRadialGradient,
  SPStop,
  SPStrokeCapType,
  SPStrokeJoinType,
  SPStyle,
  SPWindRule,
  sp_gradient_add_stop,
  sp_gradient_delete_stop,
  sp_gradient_reverse_vector,
  sp_set_gradient_stop_color,
  spReprCssAttrNew,
  spReprCssChangeRecursive,
  spReprCssSetProperty,
  spReprCssSetPropertyDouble,
  spReprCssSetPropertyString,
  spReprCssUnsetProperty,
  writeBuf,
} from '@inkscape-web/core';
import { Affine, atan2, L2, Point, Rotate, Scale } from '@inkscape-web/geom';
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
import { sp_item_apply_gradient } from '../../gradient-chemistry.ts';
import {
  type PatternSettings,
  sp_get_pattern_label,
  sp_get_pattern_list,
  sp_item_apply_pattern,
  sp_pattern_get_gap,
} from '../../pattern-manipulation.ts';

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
  | {
      kind: 'paint';
      mode: PaintMode;
      color: Colors.Color;
      fillRule: SPWindRule;
      /** The linear or radial gradient of the first selected object (PaintMode.Gradient), else null. */
      gradient: SPGradient | null;
      /** The pattern of the first selected object (PaintMode.Pattern), else null. */
      pattern: SPPattern | null;
    };

/** The mode of paint (upstream get_mode_from_paint). */
export function paintModeFromPaint(paint: SPIPaint, server: SPPaintServer | null = null): PaintMode {
  if (paint.isDerived()) return PaintMode.Derived;
  if (paint.isPaintserver()) {
    // TODO: hatches, meshes, swatches
    return server instanceof SPPattern ? PaintMode.Pattern : PaintMode.Gradient;
  }
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
  const server0 = isFill ? style.getFillPaintServer() : style.getStrokePaintServer();
  const mode = paintModeFromPaint(paint, paint.isPaintserver() ? server0 : null);
  const opacity = (isFill ? style.fill_opacity : style.stroke_opacity).as_double();
  let color = paint.isColor() ? paint.getColor() : undefined;
  // Without a color, offer the last used one (desktop.current) for when the mode changes to flat color.
  color ??= sp_desktop_get_color(desktop, isFill) ?? paint.getColor();
  color = color.clone();
  color.enableOpacity(true);
  color.setOpacity(opacity);
  const server = paint.isPaintserver()
    ? isFill
      ? style.getFillPaintServer()
      : style.getStrokePaintServer()
    : null;
  const gradient = server instanceof SPLinearGradient || server instanceof SPRadialGradient ? server : null;
  const pattern = server instanceof SPPattern ? server : null;
  return { kind: 'paint', mode, color, fillRule: style.fill_rule.computed, gradient, pattern };
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
    case PaintMode.Gradient:
      // A new gradient from the current paint (upstream fire_gradient_changed(nullptr)).
      setGradient(desktop, isFill, null, SPGradientType.SP_GRADIENT_TYPE_LINEAR);
      break;
    case PaintMode.Pattern: {
      // The first pattern of the document; the editor offers the stock patterns.
      const pattern = sp_get_pattern_list(doc)[0];
      if (pattern) setPattern(desktop, isFill, pattern, patternItem(pattern));
      break;
    }
    default:
      break; // TODO: mesh, pattern, swatch
  }
}

/**
 * What the pattern editor shows of a pattern: read from the link pattern, the color and the
 * label from the root pattern (upstream PatternManager create_pattern_item).
 */
export interface PatternItem extends PatternSettings {
  /** The id of the root pattern. */
  id: string;
  /** Rotation in degrees, scale x and y (taken from the transform of the link). */
  angle: number;
  scale_x: number;
  scale_y: number;
}

export function patternItem(pattern: SPPattern): PatternItem {
  //  this is a link:       this is a root:
  // <pattern href="abc"/> <pattern id="abc"/>
  const link_pattern = pattern;
  const root_pattern = pattern.rootPattern();
  const transform = link_pattern.get_this_transform();
  // reading color style form "root" pattern; linked one won't have any effect, as it's not a parent
  const fill = root_pattern.style.fill;
  const preserve = link_pattern.getAttribute('preserveAspectRatio');
  const gap = link_pattern !== root_pattern ? sp_pattern_get_gap(link_pattern) : { x: 0, y: 0 };
  return {
    id: root_pattern.getId() ?? '',
    label: sp_get_pattern_label(root_pattern),
    transform,
    offset: new Point(link_pattern.x(), link_pattern.y()),
    color: fill.set && fill.isColor() ? fill.getColor() : null,
    uniform_scale: !!preserve && preserve !== 'none',
    gap: new Point(gap.x, gap.y),
    angle: (atan2(transform.xAxis()) * 180) / Math.PI,
    scale_x: L2(transform.xAxis()),
    scale_y: L2(transform.yAxis()),
  };
}

/**
 * The transform of the editor's settings: scale, then rotation, with the translation of the
 * current link (upstream PatternEditor::get_selected_transform).
 */
export function patternSettingsTransform(item: PatternItem): Affine {
  const m = Scale(item.scale_x, item.scale_y).multiply(Rotate((item.angle / 180.0) * Math.PI));
  const t = item.transform.translation();
  return new Affine(m.c0, m.c1, m.c2, m.c3, t.x, t.y);
}

/** Apply a pattern (of the document, or copied from a stock document) with the editor's settings to the selection. */
export function setPattern(desktop: SPDesktop, isFill: boolean, pattern: SPPattern, item: PatternItem): void {
  const items = desktop.getSelection().items();
  if (!items.length) return;
  const settings: PatternSettings = { ...item, transform: patternSettingsTransform(item) };
  for (const it of items) {
    // the link of each object gets the settings; the first application creates it
    const server = isFill ? it.style.getFillPaintServer() : it.style.getStrokePaintServer();
    const link =
      server instanceof SPPattern && server.rootPattern() === pattern.rootPattern() ? server : pattern;
    sp_item_apply_pattern(it, link, isFill, settings);
    const now = isFill ? it.style.getFillPaintServer() : it.style.getStrokePaintServer();
    if (now instanceof SPPattern && now !== link) sp_item_apply_pattern(it, now, isFill, settings);
    remove_opacity(it, isFill);
  }
  DocumentUndo.done(
    desktop.getDocument(),
    isFill ? C_(UNDO, 'Set pattern on fill') : C_(UNDO, 'Set pattern on stroke'),
    ICON,
  );
}

/**
 * An SVG image of width × height filled with the pattern on a white background, for the pattern
 * lists of the editor (upstream PatternManager::get_preview, which renders with cairo).
 */
export function patternPreviewSvg(pattern: SPPattern, width: number, height: number): string {
  // The pattern, the patterns of its href chain and the resources that their content uses.
  const doc = pattern.document;
  const used = new Map<string, string>();
  const add = (id: string | null) => {
    const object = id ? doc?.getObjectById(id) : null;
    if (!id || !object || used.has(id)) return;
    const xml = writeBuf(object.getRepr());
    used.set(id, xml);
    for (const m of xml.matchAll(/url\(\s*['"]?#([^'")]+)['"]?\s*\)|href="#([^"]+)"/g))
      add(m[1] ?? m[2] ?? null);
  };
  add(pattern.getId());
  const id = pattern.getId() ?? '';
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" ' +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${[...used.values()].join('')}</defs>` +
    `<rect width="${width}" height="${height}" fill="#fff"/><rect width="${width}" height="${height}" fill="url(#${id})"/></svg>`
  );
}

/** Unset fill-opacity or stroke-opacity of item (upstream remove_opacity). */
function remove_opacity(item: SPItem, isFill: boolean): void {
  const css = spReprCssAttrNew();
  spReprCssUnsetProperty(css, isFill ? 'fill-opacity' : 'stroke-opacity');
  spReprCssChangeRecursive(item.getRepr(), css, 'style');
}

/**
 * Apply the gradient vector (null: a new one from the current paint) as a linear or radial
 * gradient to the selection (upstream: the get_gradient_changed handler of the dialog).
 */
export function setGradient(
  desktop: SPDesktop,
  isFill: boolean,
  vector: SPGradient | null,
  type: SPGradientType,
): void {
  for (const item of desktop.getSelection().items()) {
    sp_item_apply_gradient(item, vector, desktop, type, false, isFill);
    remove_opacity(item, isFill);
  }
  DocumentUndo.done(
    desktop.getDocument(),
    isFill ? C_(UNDO, 'Set gradient on fill') : C_(UNDO, 'Set gradient on stroke'),
    ICON,
  );
}

// Gradient editor (upstream GradientEditor, reduced) -----------------------------------------------

const GRADIENT_ICON = 'color-gradient';

/** The stops of the vector of gradient. */
export function gradientStops(gradient: SPGradient): SPStop[] {
  return gradient.getVector().children.filter((c): c is SPStop => c instanceof SPStop);
}

/** Set the color of a stop (upstream GradientEditor::set_stop_color); slider steps merge. */
export function setStopColor(stop: SPStop, color: Colors.Color): void {
  sp_set_gradient_stop_color(stop.document, stop, color);
}

/** Set the offset (0 to 1) of a stop, limited by its neighbors (upstream GradientEditor::set_stop_offset). */
export function setStopOffset(stop: SPStop, offset: number): void {
  const prev = stop.getPrevStop();
  const next = stop.getNextStop();
  stop.offset = Math.min(Math.max(offset, prev?.offset ?? 0), next?.offset ?? 1);
  stop.getRepr().setAttribute('offset', cssNumber(stop.offset));
  DocumentUndo.maybeDone(
    stop.document,
    'gradient:stop:offset',
    C_(UNDO, 'Change gradient stop offset'),
    GRADIENT_ICON,
  );
}

/** Add a stop after stop (upstream GradientEditor::add_stop); returns the new stop. */
export function addGradientStop(gradient: SPGradient, stop: SPStop): SPStop | null {
  return sp_gradient_add_stop(gradient.getVector(), stop);
}

/** Delete stop if the vector keeps two stops (upstream GradientEditor::delete_stop). */
export function deleteGradientStop(gradient: SPGradient, stop: SPStop): boolean {
  return sp_gradient_delete_stop(gradient.getVector(), stop);
}

/** Reverse the stops of the vector (upstream GradientEditor::reverse_gradient). */
export function reverseGradient(gradient: SPGradient): void {
  sp_gradient_reverse_vector(gradient.getVector());
  DocumentUndo.done(gradient.document, C_(UNDO, 'Reverse gradient'), GRADIENT_ICON);
}

/** Set the spread of the gradient (upstream GradientEditor::set_repeat_mode). */
export function setGradientRepeat(gradient: SPGradient, mode: SPGradientSpread): void {
  gradient.setSpread(mode);
  gradient.updateRepr();
  DocumentUndo.done(gradient.document, C_(UNDO, 'Set gradient repeat'), GRADIENT_ICON);
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
