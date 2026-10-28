// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/filter-chemistry.cpp, src/filter-chemistry.h
/*
 * Various utility methods for filters
 *
 * Authors:
 *   Hugo Rodrigues
 *   bulia byak
 *   Niko Kiirala
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006-2008 authors
 */
import type { SPDocument } from './document.ts';
import { SPGaussianBlur } from './object/filters/gaussian-blur.ts';
import { SPFilterPrimitive } from './object/filters/sp-filter-primitive.ts';
import { SPFilter } from './object/sp-filter.ts';
import { SPItem } from './object/sp-item.ts';
import { SP_OBJECT_WRITE_EXT, SP_OBJECT_WRITE_NO_CHILDREN, type SPObject } from './object/sp-object.ts';
import { spStyleSetPropertyUrl } from './style.ts';
import { SPBlendMode, SPIsolation } from './style-enums.ts';
import { svgNumber } from './svg/stringstream.ts';
import type { Node } from './xml/node.ts';
import {
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssChangeRecursive,
  spReprCssSetProperty,
  spReprCssUnsetProperty,
} from './xml/repr-css.ts';

/** Blur slider value (0..100 %) to blur radius: radius = (value/100)² · (w + h) / BLUR_MULTIPLIER. */
export const BLUR_MULTIPLIER = 4.0;

/** Count how many times the filter is used by the styles of o and its descendants. */
function count_filter_hrefs(o: SPObject | null, filter: SPFilter): number {
  if (!o) return 1;
  let i = 0;
  const style = o.style;
  if (style.filter.set && style.getFilter() === filter) i++;
  for (const child of o.children) i += count_filter_hrefs(child, filter);
  return i;
}

/** A new svg:filter with color-interpolation-filters:sRGB, appended to defs. */
function create_filter_repr(document: SPDocument): Node {
  const repr = document.getReprDoc().createElement('svg:filter');
  // Inkscape now supports both sRGB and linear color-interpolation-filters.
  // But, for the moment, keep sRGB as default value for new filters
  // (historically set to sRGB and doesn't require conversion between
  // filter cairo surfaces and other types of cairo surfaces).
  const css = spReprCssAttrNew();
  spReprCssSetProperty(css, 'color-interpolation-filters', 'sRGB');
  spReprCssChange(repr, css, 'style');
  return repr;
}

/** Append a new empty filter to defs. */
export function new_filter(document: SPDocument): SPFilter {
  const repr = create_filter_repr(document);
  // Append the new filter node to defs
  document.getDefs()?.getRepr().appendChild(repr);
  // get corresponding object
  const f = document.getObjectByRepr(repr);
  if (!(f instanceof SPFilter)) throw new Error('new_filter: no SPFilter');
  return f;
}

/** stdDeviation for a blur radius in desktop units of an item with the given i2d expansion. */
function std_deviation(radius: number, expansion: number): number {
  return expansion !== 0 ? radius / expansion : radius;
}

/**
 * Creates a filter with blur primitive of specified radius for an item with the given matrix
 * expansion, width and height
 */
export function new_filter_gaussian_blur(document: SPDocument, radius: number, expansion: number): SPFilter {
  const xml_doc = document.getReprDoc();
  const repr = create_filter_repr(document);
  //create feGaussianBlur node
  const b_repr = xml_doc.createElement('svg:feGaussianBlur');
  //set stdDeviation attribute
  b_repr.setAttribute('stdDeviation', svgNumber(std_deviation(radius, expansion)));
  //set feGaussianBlur as child of filter node
  repr.appendChild(b_repr);
  // Append the new filter node to defs
  document.getDefs()?.getRepr().appendChild(repr);
  const f = document.getObjectByRepr(repr);
  if (!(f instanceof SPFilter)) throw new Error('new_filter_gaussian_blur: no SPFilter');
  return f;
}

/**
 * Creates a simple filter with a blend primitive and a blur primitive of specified radius for
 * an item with the given matrix expansion, width and height
 */
function new_filter_blend_gaussian_blur(
  document: SPDocument,
  blendmode: string,
  radius: number,
  expansion: number,
): SPFilter {
  const xml_doc = document.getReprDoc();
  const repr = create_filter_repr(document);
  repr.setAttribute('inkscape:collect', 'always');
  // Append the new filter node to defs
  document.getDefs()?.getRepr().appendChild(repr);
  const f = document.getObjectByRepr(repr);
  if (!(f instanceof SPFilter)) throw new Error('new_filter_blend_gaussian_blur: no SPFilter');

  // Gaussian blur primitive
  if (radius !== 0) {
    //create feGaussianBlur node
    const b_repr = xml_doc.createElement('svg:feGaussianBlur');
    b_repr.setAttribute('inkscape:collect', 'always');
    //set stdDeviation attribute
    b_repr.setAttribute('stdDeviation', svgNumber(std_deviation(radius, expansion)));
    //set feGaussianBlur as child of filter node
    repr.appendChild(b_repr);
  }
  // Blend primitive
  if (blendmode !== 'normal') {
    const b_repr = xml_doc.createElement('svg:feBlend');
    b_repr.setAttribute('inkscape:collect', 'always');
    b_repr.setAttribute('mode', blendmode);
    b_repr.setAttribute('in2', 'BackgroundImage');
    // set feBlend as child of filter node
    repr.appendChild(b_repr);
    // Enable background image buffer for document
    const root = document.getReprRoot();
    if (!root.attribute('enable-background')) root.setAttribute('enable-background', 'new');
  }
  return f;
}

/**
 * Creates a simple filter for the given item with blend and blur primitives, using the
 * specified mode and radius, respectively
 */
export function new_filter_simple_from_item(
  document: SPDocument,
  item: SPItem,
  mode: string,
  radius: number,
): SPFilter {
  return new_filter_blend_gaussian_blur(document, mode, radius, item.i2dtAffine().descrim());
}

/**
 * Modifies the gaussian blur applied to the item.
 * If no filters are applied to given item, creates a new blur filter.
 * If a filter is applied and it contains a blur, modify that blur.
 * If the filter doesn't contain blur, a blur is added to the filter.
 * Should there be more references to modified filter, that filter is
 * duplicated, so that other elements referring that filter are not modified.
 */
/* TODO: this should be made more generic, not just for blurs */
export function modify_filter_gaussian_blur_from_item(
  document: SPDocument,
  item: SPItem,
  radius: number,
): SPFilter {
  if (!item.style.filter.set) return new_filter_simple_from_item(document, item, 'normal', radius);

  let filter = item.style.getFilter();
  if (!filter) {
    // We reach here when filter.set is true, but the href is not found in the document
    return new_filter_simple_from_item(document, item, 'normal', radius);
  }

  const xml_doc = document.getReprDoc();

  // If there are more users for this filter, duplicate it
  if (filter.hrefcount > count_filter_hrefs(item, filter)) {
    const repr = filter.getRepr().duplicate(xml_doc);
    document.getDefs()?.getRepr().appendChild(repr);
    const dup = document.getObjectByRepr(repr);
    if (dup instanceof SPFilter) filter = dup;
  }

  // Determine the required standard deviation value
  const stdDeviation = std_deviation(radius, item.i2dtAffine().descrim());

  // Search for gaussian blur primitives. If found, set the stdDeviation
  // of the first one and return.
  // Upstream searches the filter of the style here, which is the original after duplicating;
  // the duplicate is searched instead, so that the other users keep their blur.
  const repr = filter.getRepr();
  for (let primitive = repr.firstChild(); primitive; primitive = primitive.next()) {
    if (primitive.name() === 'svg:feGaussianBlur') {
      primitive.setAttribute('stdDeviation', svgNumber(stdDeviation));
      return filter;
    }
  }

  // If there were no gaussian blur primitives, create a new one
  const b_repr = xml_doc.createElement('svg:feGaussianBlur');
  b_repr.setAttribute('stdDeviation', svgNumber(stdDeviation));
  repr.appendChild(b_repr);
  return filter;
}

/** Remove the filter property from the style of item (and its descendants if recursive). */
export function remove_filter(item: SPObject, recursive: boolean): void {
  const css = spReprCssAttrNew();
  spReprCssUnsetProperty(css, 'filter');
  if (recursive) spReprCssChangeRecursive(item.getRepr(), css, 'style');
  else spReprCssChange(item.getRepr(), css, 'style');
}

/**
 * Removes the first feGaussianBlur from the filter attached to given item.
 * Should this leave us with an empty filter, remove that filter.
 */
/* TODO: the removed filter primitive may had had a named result image, so
 * after removing, the filter may be in erroneous state, this situation should
 * be handled gracefully */
export function remove_filter_gaussian_blur(item: SPObject): boolean {
  let changed = false;
  const filter = item.style.filter.set ? item.style.getFilter() : null;
  if (filter) {
    // Search for the first blur primitive and remove it. (if found)
    const repr = filter.getRepr();
    for (let primitive = repr.firstChild(); primitive; primitive = primitive.next()) {
      if (primitive.name() === 'svg:feGaussianBlur') {
        repr.removeChild(primitive);
        changed = true;
        break;
      }
    }
    // If there are no more primitives left in this filter, discard it.
    if (repr.childCount() === 0) {
      remove_filter(item, false);
      changed = true;
    }
  }
  return changed;
}

/**
 * Removes blend primitive from the filter attached to given item.
 * Get if the filter have a < 1.0 blending filter and if it remove it
 */
export function remove_filter_legacy_blend(item: SPObject | null): void {
  const filter = item?.style.filter.set ? item.style.getFilter() : null;
  if (!filter) return;
  // determine whether filter is simple (blend and/or blur) or complex
  let blurcount = 0;
  let total = 0;
  let blend: SPObject | null = null;
  for (const primitive of filter.children) {
    if (!(primitive instanceof SPFilterPrimitive)) continue;
    // TODO: is<SPFeBlend>(primitive) when SPFeBlend is ported.
    if (primitive.getRepr().name() === 'svg:feBlend') blend = primitive;
    if (primitive instanceof SPGaussianBlur) ++blurcount;
    ++total;
  }
  if (blend && total === 2 && blurcount === 1) {
    blend.deleteObject(true);
  } else if (total === 1 && blurcount !== 1) {
    if (item) remove_filter(item, false);
  }
}

/** True if the filter has one primitive, a gaussian blur. */
export function filter_is_single_gaussian_blur(filter: SPFilter): boolean {
  return filter.children.length === 1 && filter.children[0] instanceof SPGaussianBlur;
}

/** The stdDeviation of a filter with only a gaussian blur, else 0. */
export function get_single_gaussian_blur_radius(filter: SPFilter): number {
  const gb = filter.children[0];
  if (filter.children.length === 1 && gb instanceof SPGaussianBlur) {
    const x = gb.get_std_deviation().getNumber();
    const y = gb.get_std_deviation().getOptNumber();
    if (x > 0 && y > 0) return Math.max(x, y);
    return x;
  }
  return 0.0;
}

function _set_blend_mode(item: SPItem | null, blend_mode: SPBlendMode, clear: boolean): boolean {
  if (!item) return false;
  const style = item.style;

  let change_blend =
    (style.mix_blend_mode.set ? style.mix_blend_mode.value : SPBlendMode.SP_CSS_BLEND_NORMAL) !== blend_mode;
  // < 1.0 filter based blend removal
  if (!style.mix_blend_mode.set && style.filter.set && style.getFilter()) remove_filter_legacy_blend(item);
  if (clear) {
    change_blend = change_blend || style.mix_blend_mode.set;
    style.mix_blend_mode.clear();
  } else {
    style.mix_blend_mode.set = true;
    style.mix_blend_mode.value =
      style.isolation.value === SPIsolation.SP_CSS_ISOLATION_ISOLATE
        ? SPBlendMode.SP_CSS_BLEND_NORMAL
        : blend_mode;
  }
  if (change_blend) {
    // we do blend so we need to update display style
    item.updateRepr(SP_OBJECT_WRITE_NO_CHILDREN | SP_OBJECT_WRITE_EXT);
  }
  return change_blend;
}

/** Set mix-blend-mode of item; returns true if it changed. */
export function set_blend_mode(item: SPItem | null, blend_mode: SPBlendMode): boolean {
  return _set_blend_mode(item, blend_mode, false);
}

/** Remove mix-blend-mode from item; returns true if it changed. */
export function clear_blend_mode(item: SPItem | null): boolean {
  return _set_blend_mode(item, SPBlendMode.SP_CSS_BLEND_NORMAL, true);
}

/** The blur radius (desktop units) of the first gaussian blur in the filter of object. */
export function object_query_blur_filter(object: SPObject | null): number | null {
  if (!(object instanceof SPItem) || !object.style.filter.set) return null;
  const filter = object.style.getFilter();
  if (!filter) return null;
  for (const primitive of filter.children) {
    if (primitive instanceof SPGaussianBlur) {
      const num = primitive.get_std_deviation().getNumber();
      const radius = num * object.i2dtAffine().descrim();
      if (!Number.isNaN(radius)) return radius;
    }
  }
  return null;
}

/** Set the blur of item from a slider value (0..100 %), as the Fill and Stroke blur slider does. */
export function modify_filter_gaussian_blur_amount(item: SPItem | null, amount: number): boolean {
  if (!item) return false;
  let radius = 0;
  const bbox = item.desktopGeometricBounds();
  if (bbox) {
    const perimeter = bbox.width() + bbox.height(); // fixme: this is only half the perimeter, is that correct?
    const blur_value = amount / 100.0;
    radius = (blur_value * blur_value * perimeter) / BLUR_MULTIPLIER;
  }
  const filter = modify_filter_gaussian_blur_from_item(item.document, item, radius);
  filter.update_filter_region(item);
  spStyleSetPropertyUrl(item, 'filter', filter, false);
  return true;
}
