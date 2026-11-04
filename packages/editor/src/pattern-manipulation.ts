// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/pattern-manipulation.cpp, src/pattern-manipulation.h, src/helper/stock-items.cpp (patterns and hatches)
/*
 * Pattern manipulation: the patterns of a document, applying a pattern to an object and the
 * settings of the pattern editor (color, transform, offset, uniform scaling, gap).
 */
import {
  _,
  type Colors,
  type SPDocument,
  SPHatch,
  type SPItem,
  type SPObject,
  SPPattern,
  sp_copy_resource,
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssChangeRecursive,
  spReprCssSetProperty,
} from '@inkscape-web/core';
import { Affine, Point } from '@inkscape-web/geom';
import { sp_desktop_apply_css_recursive } from './desktop-style.ts';

/** The valid root patterns (with children) of a document (upstream sp_get_pattern_list). */
export function sp_get_pattern_list(source: SPDocument | null): SPPattern[] {
  const list: SPPattern[] = [];
  const visit = (o: SPObject) => {
    for (const c of o.children) {
      // only if this is a valid root pattern
      if (c instanceof SPPattern) {
        if (c === c.rootPattern() && c.hasChildren()) list.push(c);
      } else visit(c);
    }
  };
  if (source) visit(source.getRoot());
  return list;
}

/** The valid root hatches (with children) of a document (upstream sp_get_hatch_list). */
export function sp_get_hatch_list(source: SPDocument | null): SPHatch[] {
  const list: SPHatch[] = [];
  const visit = (o: SPObject) => {
    for (const c of o.children) {
      // only if this is a valid root hatch
      if (c instanceof SPHatch) {
        if (c === c.rootHatch() && c.hasChildren()) list.push(c);
      } else visit(c);
    }
  };
  if (source) visit(source.getRoot());
  return list;
}

/** Set the fill of the pattern, which content without a fill inherits (upstream sp_pattern_set_color). */
export function sp_pattern_set_color(pattern: SPPattern, c: Colors.Color): void {
  const css = spReprCssAttrNew();
  spReprCssSetProperty(css, 'fill', c.toString());
  spReprCssChange(pattern.getRepr(), css, 'style');
}

export function sp_pattern_set_transform(pattern: SPPattern, transform: Affine): void {
  // for now, this is that simple
  pattern.transform_multiply(transform, true);
}

export function sp_pattern_set_offset(pattern: SPPattern, offset: Point): void {
  // TODO: verify
  pattern.getRepr().setAttributeSvgDouble('x', offset.x);
  pattern.getRepr().setAttributeSvgDouble('y', offset.y);
}

export function sp_pattern_set_uniform_scale(pattern: SPPattern, uniform: boolean): void {
  //TODO: make smarter to keep existing value when possible
  pattern.setAttribute('preserveAspectRatio', uniform ? 'xMidYMid' : 'none');
}

/** Set the gap between the tiles in percent of the tile size, on a link pattern (upstream sp_pattern_set_gap). */
export function sp_pattern_set_gap(link_pattern: SPPattern, gap_percent: Point): void {
  const root = link_pattern.rootPattern();
  // Setting pattern gap requires link and root patterns objects
  if (root === link_pattern) return;
  const set_gap = (size: number, percent: number, attr: string) => {
    if (percent === 0.0 || size <= 0.0) {
      // no gap
      link_pattern.removeAttribute(attr);
    } else if (percent > 0.0) {
      // positive gap
      link_pattern.getRepr().setAttributeSvgDouble(attr, size + (size * percent) / 100.0);
    } else if (percent > -100.0) {
      // negative gap - overlap
      link_pattern.getRepr().setAttributeSvgDouble(attr, size - (size * -percent) / 100.0);
    }
  };
  set_gap(root.width(), gap_percent.x, 'width');
  set_gap(root.height(), gap_percent.y, 'height');
}

/** The gap of a link pattern in percent (upstream sp_pattern_get_gap). */
export function sp_pattern_get_gap(link_pattern: SPPattern): { x: number; y: number } {
  const root = link_pattern.rootPattern();
  if (root === link_pattern) return { x: 0, y: 0 };
  const get_gap = (root_size: number, link_size: number) => {
    if (root_size > 0.0 && link_size > 0.0) {
      if (link_size > root_size) return (link_size - root_size) / root_size;
      if (link_size < root_size) return -link_size / root_size;
    }
    return 0.0;
  };
  return {
    x: get_gap(root.width(), link_pattern.width()) * 100.0,
    y: get_gap(root.height(), link_pattern.height()) * 100.0,
  };
}

/** The name of a pattern: its label, stock id or id (upstream sp_get_pattern_label). */
export function sp_get_pattern_label(pattern: SPObject): string {
  const label = pattern.getAttribute('inkscape:label');
  if (label) return _(label);
  const stock_id = pattern.getAttribute('inkscape:stockid');
  return stock_id ? _(stock_id) : (pattern.getId() ?? '');
}

/** Use root_pattern for the fill or stroke of item, unless its pattern already links to it (upstream sp_item_set_pattern_style). */
function sp_item_set_pattern_style(item: SPItem, root_pattern: SPPattern, fill: boolean): void {
  const server = fill ? item.style.getFillPaintServer() : item.style.getStrokePaintServer();
  // only if this object's pattern is not rooted in our selected pattern, apply
  if (server instanceof SPPattern && server.rootPattern() === root_pattern) return;
  const css = spReprCssAttrNew();
  spReprCssSetProperty(css, fill ? 'fill' : 'stroke', `url(#${root_pattern.getId()})`);
  if (fill) sp_desktop_apply_css_recursive(item, css, true);
  else spReprCssChangeRecursive(item.getRepr(), css, 'style');
  // create a link to the pattern right away, without waiting for an object to be moved;
  // otherwise the pattern editor may end up modifying a pattern shared by different objects
  item.adjust_pattern(Affine.identity());
}

/** The settings of the pattern editor (upstream: the arguments of sp_item_apply_pattern). */
export interface PatternSettings {
  color: Colors.Color | null;
  label: string;
  transform: Affine;
  offset: Point;
  uniform_scale: boolean;
  /** Gap between the tiles in percent of the tile size. */
  gap: Point;
}

/** Set a pattern as the fill or stroke of item and apply the settings (upstream sp_item_apply_pattern). */
export function sp_item_apply_pattern(
  item: SPItem,
  pattern: SPPattern,
  fill: boolean,
  s: PatternSettings,
): void {
  const root_pattern = pattern.rootPattern();
  if (s.color) sp_pattern_set_color(root_pattern, s.color);
  // pattern name is applied to the root
  root_pattern.setAttribute('inkscape:label', s.label || null);
  // the remaining settings apply to a link pattern
  if (pattern !== root_pattern) {
    sp_pattern_set_transform(pattern, s.transform);
    sp_pattern_set_offset(pattern, s.offset);
    sp_pattern_set_uniform_scale(pattern, s.uniform_scale);
    // a gap requires both patterns, but they are only created later by calling "adjust_pattern" below
    sp_pattern_set_gap(pattern, s.gap);
  }
  sp_item_set_pattern_style(item, root_pattern, fill);
}

/**
 * Copy the stock pattern id of stock_doc into the defs of document (upstream get_stock_item with
 * "urn:inkscape:pattern:id" and stock = true, which always copies).
 */
export function get_stock_pattern(document: SPDocument, stock_doc: SPDocument, id: string): SPPattern | null {
  const source = stock_doc.getObjectById(id);
  if (!(source instanceof SPPattern)) return null;
  const object = sp_copy_resource(source, document);
  if (!(object instanceof SPPattern)) return null;
  object.setAttribute('inkscape:collect', 'always');
  object.setAttribute('inkscape:isstock', 'true');
  return object;
}

export function sp_hatch_set_pitch(hatch: SPHatch, pitch: number): void {
  hatch.getRepr().setAttributeSvgDouble('pitch', pitch);
}

export function sp_hatch_set_rotation(hatch: SPHatch, angle: number): void {
  hatch.getRepr().setAttributeSvgDouble('rotate', angle);
}

export function sp_hatch_set_transform(hatch: SPHatch, transform: Affine): void {
  hatch.transform_multiply(transform, true);
}

export function sp_hatch_set_offset(hatch: SPHatch, offset: Point): void {
  hatch.getRepr().setAttributeSvgDouble('x', offset.x);
  hatch.getRepr().setAttributeSvgDouble('y', offset.y);
}

export function sp_hatch_set_color(hatch: SPHatch, c: Colors.Color): void {
  const css = spReprCssAttrNew();
  spReprCssSetProperty(css, 'stroke', c.toString());
  spReprCssChange(hatch.getRepr(), css, 'style');
}

export function sp_hatch_set_stroke_width(hatch: SPHatch, thickness: number): void {
  const css = spReprCssAttrNew();
  spReprCssSetProperty(css, 'stroke-width', String(thickness));
  spReprCssChange(hatch.getRepr(), css, 'style');
}

/** Use root_hatch for the fill or stroke of item, unless its hatch already links to it (upstream sp_item_set_hatch_style). */
function sp_item_set_hatch_style(item: SPItem, root_hatch: SPHatch, url: string, fill: boolean): void {
  const server = fill ? item.style.getFillPaintServer() : item.style.getStrokePaintServer();
  // only if this object's hatch is not rooted in our selected hatch, apply
  if (server instanceof SPHatch && server.rootHatch() === root_hatch) return;
  const css = spReprCssAttrNew();
  spReprCssSetProperty(css, fill ? 'fill' : 'stroke', url);
  if (fill) sp_desktop_apply_css_recursive(item, css, true);
  else spReprCssChangeRecursive(item.getRepr(), css, 'style');
  // create a link to the hatch right away, without waiting for this item to be moved;
  // otherwise the pattern editor may end up modifying a hatch shared by different objects
  // (upstream SPItem::adjust_hatch with the identity)
  const now = fill ? item.style.getFillPaintServer() : item.style.getStrokePaintServer();
  if (now instanceof SPHatch) now.clone_if_necessary(item, fill ? 'fill' : 'stroke');
}

/** The settings of a hatch (upstream: the arguments of sp_item_apply_hatch). */
export interface HatchSettings {
  color: Colors.Color | null;
  label: string;
  transform: Affine;
  offset: Point;
  pitch: number;
  rotation: number;
  thickness: number;
}

/** The settings of a hatch as the pattern editor reads them (upstream create_hatch_item). */
export function hatchSettings(hatch: SPHatch): HatchSettings {
  const root_hatch = hatch.rootHatch();
  // hatches (through <hatchpath>) support stroke colors, and there could be multiple potentially different ones,
  // but if stroke color is defined on a <hatch> element, we use it:
  const stroke = root_hatch.style.stroke;
  return {
    color: stroke.set && stroke.isColor() ? stroke.getColor() : null,
    label: sp_get_pattern_label(root_hatch),
    transform: hatch.get_this_transform(),
    offset: new Point(hatch.x(), hatch.y()),
    pitch: hatch.pitch(),
    rotation: hatch.rotate(),
    thickness: root_hatch.style.stroke_width.computed,
  };
}

/** Set a hatch as the fill or stroke of item and apply the settings (upstream sp_item_apply_hatch). */
export function sp_item_apply_hatch(item: SPItem, hatch: SPHatch, fill: boolean, s: HatchSettings): void {
  const link_hatch = hatch;
  const root_hatch = hatch.rootHatch();
  if (s.color) sp_hatch_set_color(root_hatch, s.color);
  sp_hatch_set_stroke_width(root_hatch, s.thickness);
  // hatch name is applied to the root
  root_hatch.setAttribute('inkscape:label', s.label || null);
  // the remaining settings apply to a link hatch
  if (link_hatch !== root_hatch) {
    sp_hatch_set_pitch(link_hatch, s.pitch);
    sp_hatch_set_rotation(link_hatch, s.rotation);
    sp_hatch_set_transform(link_hatch, s.transform);
    sp_hatch_set_offset(link_hatch, s.offset);
  }
  sp_item_set_hatch_style(item, hatch, `url(#${hatch.getId()})`, fill);
}

/** Copy the stock hatch id of stock_doc into the defs of document (upstream get_stock_item for hatches, stock = true). */
export function get_stock_hatch(document: SPDocument, stock_doc: SPDocument, id: string): SPHatch | null {
  const source = stock_doc.getObjectById(id);
  if (!(source instanceof SPHatch)) return null;
  const object = sp_copy_resource(source, document);
  if (!(object instanceof SPHatch)) return null;
  object.setAttribute('inkscape:collect', 'always');
  object.setAttribute('inkscape:isstock', 'true');
  return object;
}
