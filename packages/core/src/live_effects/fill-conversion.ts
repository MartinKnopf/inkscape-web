// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/fill-conversion.cpp, src/live_effects/fill-conversion.h
/**
 * @file
 * Fill/stroke conversion routines for LPEs which draw a stroke
 */
/*
 * Authors:
 *   Liam P White
 *
 * Copyright (C) 2020 Authors
 */
import type { SPObject } from '../object/sp-object.ts';
import type { SPShape } from '../object/sp-shape.ts';
import { svgNumber } from '../svg/stringstream.ts';
import { type SPCSSAttr, spReprCssAttrNew, spReprCssChange, spReprCssSetProperty } from '../xml/repr-css.ts';

function get_linked_fill(source: SPObject): SPObject | null {
  const linked_fill_id = source.getAttribute('inkscape:linked-fill');
  return linked_fill_id ? source.document.getObjectById(linked_fill_id) : null;
}

function convert_fill_color(css: SPCSSAttr, source: SPObject): void {
  const color = source.style.fill.getColor();
  color.addOpacity(source.style.fill_opacity.as_double());
  spReprCssSetProperty(css, 'fill', color.toString());
}

function convert_stroke_color(css: SPCSSAttr, source: SPObject): void {
  const color = source.style.stroke.getColor();
  color.addOpacity(source.style.stroke_opacity.as_double());
  spReprCssSetProperty(css, 'fill', color.toString());
}

function revert_stroke_color(css: SPCSSAttr, source: SPObject): void {
  const color = source.style.fill.getColor();
  color.addOpacity(source.style.fill_opacity.as_double());
  spReprCssSetProperty(css, 'stroke', color.toString());
}

function server_url(server: SPObject | null): string | null {
  return server ? `url(#${server.getId()})` : null;
}

function has_fill(source: SPObject): boolean {
  return source.style.fill.isColor() || source.style.fill.isPaintserver();
}

function has_stroke(source: SPObject): boolean {
  return source.style.stroke.isColor() || source.style.stroke.isPaintserver();
}

/**
 * Turn the stroke of shape into its fill, for effects that draw the stroke as a filled outline
 * (Taper stroke, Power stroke).
 * TODO: the fill of the shape goes to a linked path with the Fill between many effect, which is
 * not ported; the fill is dropped for now.
 */
export function lpe_shape_convert_stroke_and_fill(shape: SPShape): void {
  const stroke_css = spReprCssAttrNew();
  if (has_stroke(shape)) {
    if (shape.style.stroke.isColor()) {
      convert_stroke_color(stroke_css, shape);
    } else {
      const url = server_url(shape.style.getStrokePaintServer());
      if (url) spReprCssSetProperty(stroke_css, 'fill', url);
    }
  }
  spReprCssSetProperty(stroke_css, 'fill-rule', 'nonzero');
  spReprCssSetProperty(stroke_css, 'stroke', 'none');
  spReprCssChange(shape.getRepr(), stroke_css, 'style');
}

/** Turn the fill of shape back into its stroke of width (when the effect is removed). */
export function lpe_shape_revert_stroke_and_fill(shape: SPShape, width: number): void {
  const linked = get_linked_fill(shape);
  const css = spReprCssAttrNew();
  if (has_fill(shape)) {
    if (shape.style.fill.isColor()) {
      revert_stroke_color(css, shape);
    } else {
      const url = server_url(shape.style.getFillPaintServer());
      if (url) spReprCssSetProperty(css, 'stroke', url);
    }
  }
  if (linked) {
    if (linked.style.fill.isColor()) {
      convert_fill_color(css, linked);
    } else {
      const url = server_url(linked.style.getFillPaintServer());
      if (url) spReprCssSetProperty(css, 'fill', url);
    }
  } else {
    spReprCssSetProperty(css, 'fill', 'none');
  }
  // (upstream scales the width by the expansion of i2doc, and sp_desktop_apply_css_recursive
  // divides it again: the width in item units stays)
  spReprCssSetProperty(css, 'stroke-width', svgNumber(Math.abs(width)));
  spReprCssChange(shape.getRepr(), css, 'style');
  if (linked) {
    shape.removeAttribute('inkscape:linked-fill');
    linked.deleteObject();
  }
}
