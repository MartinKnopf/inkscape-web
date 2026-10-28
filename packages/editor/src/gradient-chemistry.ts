// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/gradient-chemistry.cpp, src/gradient-chemistry.h
/*
 * Various utility methods for gradients: the functions that need a desktop. The others are in
 * @inkscape-web/core (gradient-chemistry.ts).
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Tavmjong Bah <tavmjong@free.fr>
 *
 * Copyright (C) 2012 Tavmjong Bah
 * Copyright (C) 2010 Authors
 * Copyright (C) 2007 Johan Engelen
 * Copyright (C) 2001-2005 authors
 * Copyright (C) 2001 Ximian, Inc.
 */
import {
  C_,
  Colors,
  DocumentUndo,
  PaintTarget,
  type SPDocument,
  SPGradient,
  SPGradientType,
  type SPItem,
  SPLinearGradient,
  type SPObject,
  SPRadialGradient,
  sp_document_default_gradient_vector,
  sp_gradient_ensure_vector_normalized,
  sp_item_gradient_invert_vector_color,
  sp_item_gradient_reverse_vector,
  sp_item_set_gradient,
} from '@inkscape-web/core';
import type { SPDesktop } from './desktop.ts';
import { sp_desktop_get_color } from './desktop-style.ts';

const ICON = 'color-gradient';

/**
 * The preferred vector for o, made from (in order of preference) its current vector, current
 * fill or stroke color, or from desktop style if o is null or doesn't have style.
 */
export function sp_gradient_vector_for_object(
  doc: SPDocument,
  desktop: SPDesktop | null,
  o: SPObject | null,
  fill_or_stroke: PaintTarget,
  singleStop = false,
): SPGradient {
  let color = new Colors.Color(0x000000ff);
  let opacity = 1.0;
  const for_fill = fill_or_stroke === PaintTarget.FOR_FILL;
  // if not o or o doesn't use flat color, then take current color of the desktop.
  const tmp = desktop ? sp_desktop_get_color(desktop, for_fill) : undefined;
  if (tmp) color = tmp;
  if (o) {
    // take the color of the object
    const style = o.style;
    const paint = style.getFillOrStroke(for_fill);
    if (paint.isPaintserver()) {
      const server = for_fill ? style.getFillPaintServer() : style.getStrokePaintServer();
      if (server instanceof SPLinearGradient || server instanceof SPRadialGradient)
        return server.getVector(true);
    } else if (paint.isColor()) {
      color = paint.getColor().clone();
      opacity = (for_fill ? style.fill_opacity : style.stroke_opacity).as_double();
    }
  }
  return sp_document_default_gradient_vector(doc, color, opacity, singleStop);
}

/** Invert the colors of the gradients of the selection. */
export function sp_gradient_invert_selected_gradients(desktop: SPDesktop, fill_or_stroke: PaintTarget): void {
  for (const i of desktop.getSelection().items()) sp_item_gradient_invert_vector_color(i, fill_or_stroke);
  // we did an undoable action
  DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Invert gradient colors'), ICON);
}

/** Reverse the gradients of the selected gradient handle, or else of the selection (fill and stroke). */
export function sp_gradient_reverse_selected_gradients(desktop: SPDesktop): void {
  const ev = desktop.getTool();
  if (!ev) return;
  const drag = ev.get_drag();
  // First try selected dragger
  if (drag?.selected.size) {
    drag.selected_reverse_vector();
  } else {
    // If no drag or no dragger selected, act on selection (both fill and stroke gradients)
    for (const i of desktop.getSelection().items()) {
      sp_item_gradient_reverse_vector(i, PaintTarget.FOR_FILL);
      sp_item_gradient_reverse_vector(i, PaintTarget.FOR_STROKE);
    }
  }
  // we did an undoable action
  DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Reverse gradient'), ICON);
}

/**
 * Apply the gradient vector to item, as a linear or radial gradient; with a null vector, create
 * a new vector from the current paint of the item.
 * TODO: swatches (create_swatch), meshes.
 */
export function sp_item_apply_gradient(
  item: SPItem,
  vector: SPGradient | null,
  desktop: SPDesktop | null,
  gradient_type: SPGradientType,
  create_swatch: boolean,
  fill: boolean,
): void {
  if (gradient_type === SPGradientType.SP_GRADIENT_TYPE_MESH) return;
  const paint_target = fill ? PaintTarget.FOR_FILL : PaintTarget.FOR_STROKE;
  if (!vector) {
    // no vector means that we want to create a new one; find initial color
    const paint = item.style.getFillOrStroke(fill);
    let common = new Colors.Color(0xffffffff); // fallback: opaque white
    const server = fill ? item.style.getFillPaintServer() : item.style.getStrokePaintServer();
    if (paint.isColor()) {
      common = paint.getColor().clone();
    } else if (server instanceof SPGradient) {
      const vect = server.getVector();
      const first = vect.hasStops() ? vect.getFirstStop() : null;
      if (first) common = first.getColor();
    } else if (desktop) {
      const color = sp_desktop_get_color(desktop, fill);
      if (color) common = color;
    }
    vector = sp_document_default_gradient_vector(item.document, common, 1.0, create_swatch);
    vector.setSwatch(create_swatch);
  } else {
    // We have changed from another gradient type, or modified spread/units within
    // this gradient type.
    vector = sp_gradient_ensure_vector_normalized(vector) ?? vector;
  }
  sp_item_set_gradient(item, vector, gradient_type, paint_target);
}
