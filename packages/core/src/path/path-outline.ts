// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path/path-outline.cpp, src/path/path-outline.h
/*
 * Path outlines: the conversion of the stroke of an object to a path.
 *
 * Authors:
 *   Created by fred on Fri Dec 05 2003.
 *   tweaked endlessly by bulia byak <buliabyak@users.sf.net>
 *   Liam P. White <inkscapebrony@gmail.com>
 *
 * Copyright (C) 2014 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { EPSILON } from '@inkscape-web/geom';
import { DocumentUndo } from '../document-undo.ts';
import { C_ } from '../i18n.ts';
import type { ObjectSet } from '../object/object-set.ts';
import { SPItem } from '../object/sp-item.ts';
import { SPGroup } from '../object/sp-item-group.ts';
import { SPLPEItem } from '../object/sp-lpe-item.ts';
import { SPShape } from '../object/sp-shape.ts';
import { copy_object_properties } from '../path-chemistry.ts';
import { Preferences } from '../preferences.ts';
import { SP_STYLE_FLAG_ALWAYS, SPStyle } from '../style.ts';
import { SPPaintOrderLayer, SPStrokeCapType, SPStrokeJoinType } from '../style-enums.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import type { Node } from '../xml/node.ts';
import {
  type SPCSSAttr,
  spReprCssAttrAddFromString,
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssProperty,
  spReprCssSetProperty,
  spReprCssUnsetProperty,
} from '../xml/repr-css.ts';
import { pathBoolopBackend } from './path-boolop.ts';

// The values of livarot's JoinType and ButtType.
const JOIN_STRAIGHT = 0;
const JOIN_ROUND = 1;
const JOIN_POINTY = 2;
const BUTT_STRAIGHT = 0;
const BUTT_SQUARE = 1;
const BUTT_ROUND = 2;

/**
 * The path of the fill and of the stroke of an item. Returns null if the item is not a shape
 * with a curve. The stroke is empty if the item has none. TODO: text.
 */
export function item_find_paths(item: SPItem): { fill: string; stroke: string } | null {
  if (!(item instanceof SPShape)) return null;
  const curve = item.curve();
  if (!curve || curve.length === 0) return null;

  const fill = sp_svg_write_path(curve);
  const style = item.style;
  const stroke_width = style.stroke_width.computed;
  if (style.stroke.isNone() || stroke_width <= EPSILON) {
    // No stroke, no chocolate!
    return { fill, stroke: '' };
  }

  const join =
    style.stroke_linejoin.computed === SPStrokeJoinType.SP_STROKE_LINEJOIN_MITER
      ? JOIN_POINTY
      : style.stroke_linejoin.computed === SPStrokeJoinType.SP_STROKE_LINEJOIN_ROUND
        ? JOIN_ROUND
        : JOIN_STRAIGHT;
  const butt =
    style.stroke_linecap.computed === SPStrokeCapType.SP_STROKE_LINECAP_SQUARE
      ? BUTT_SQUARE
      : style.stroke_linecap.computed === SPStrokeCapType.SP_STROKE_LINECAP_ROUND
        ? BUTT_ROUND
        : BUTT_STRAIGHT;
  const miter = style.stroke_miterlimit.value * stroke_width;
  const dashes = style.stroke_dasharray.values.map((v) => v.computed);

  const stroke = pathBoolopBackend().strokeToPath(
    fill,
    stroke_width,
    join,
    butt,
    miter,
    dashes,
    style.stroke_dashoffset.computed,
    item.transform.descrim(),
  );
  return { fill, stroke };
}

/** A CSS attribute set with the complete cascaded style of the item. */
function css_from_style(style: SPStyle): SPCSSAttr {
  const css = spReprCssAttrNew();
  spReprCssAttrAddFromString(css, style.write(SP_STYLE_FLAG_ALWAYS));
  return css;
}

/** Put the fill (stroke is none) properties of the item style on css, for the fill path. */
function unset_stroke(css: SPCSSAttr): void {
  spReprCssSetProperty(css, 'stroke', 'none');
  spReprCssSetProperty(css, 'stroke-width', null);
  spReprCssSetProperty(css, 'stroke-opacity', '1.0');
  spReprCssSetProperty(css, 'filter', null);
  spReprCssSetProperty(css, 'opacity', null);
  spReprCssUnsetProperty(css, 'marker-start');
  spReprCssUnsetProperty(css, 'marker-mid');
  spReprCssUnsetProperty(css, 'marker-end');
}

/**
 * Replace the item by its fill and its stroke as filled paths, in a group when both exist. Groups
 * are converted recursively. With legacy the fill is dropped. Returns the new repr, the group repr
 * if something inside it changed, or null if nothing changed.
 * TODO: markers, text, 3D boxes and the context paint of markers.
 */
export function item_to_paths(item: SPItem, legacy = false): Node | null {
  const id = item.getAttribute('id');
  const doc = item.document;
  let flatten = false;
  // flatten all path effects
  if (item instanceof SPLPEItem && item.hasPathEffect()) {
    item.removeAllPathEffects(true);
    const elemref = id ? doc.getObjectById(id) : null;
    // If the LPE item is a shape, it is converted to a path so we need to reupdate the item
    if (elemref instanceof SPItem && elemref !== item) item = elemref;
    if (!(elemref instanceof SPLPEItem) || !elemref.hasPathEffect()) flatten = true;
  }

  // if group, recurse
  if (item instanceof SPGroup) {
    if (legacy) return null;
    let did = false;
    for (const subitem of item.item_list()) {
      if (item_to_paths(subitem, legacy)) did = true;
    }
    // This indicates that at least one thing was changed inside the group.
    return did || flatten ? item.getRepr() : null;
  }

  const paths = item_find_paths(item);
  if (!item.parent || !(item instanceof SPShape) || !paths) return null;

  // The styles ------------------------
  const ncss = css_from_style(item.style);
  const ncsf = css_from_style(item.style);
  const s_val = spReprCssProperty(ncss, 'stroke');
  const s_opac = spReprCssProperty(ncss, 'stroke-opacity');
  const f_val = spReprCssProperty(ncss, 'fill');
  const opacity = spReprCssProperty(ncss, 'opacity'); // Also for markers
  const filter = spReprCssProperty(ncss, 'filter'); // Also for markers

  unset_stroke(ncss);
  // we change the stroke to fill on ncss to create the filled stroke
  spReprCssSetProperty(ncss, 'fill', s_val);
  spReprCssSetProperty(ncss, 'fill-opacity', s_opac ?? '1.0');
  unset_stroke(ncsf);

  // The object tree -------------------
  const item_repr = item.getRepr();
  const pos = item_repr.position(); // Remember the position of the item
  const parent = item_repr.parent();
  if (!parent) return null;
  const xml_doc = doc.getReprDoc();

  // Create a group to put everything in.
  const g_repr = xml_doc.createElement('svg:g');
  copy_object_properties(g_repr, item_repr);
  // drop copied style, children will be re-styled (stroke becomes fill)
  g_repr.removeAttribute('style');
  // Add the group to the parent, move to the saved position
  parent.addChildAtPos(g_repr, pos);

  const parentStyle = item.parent.style;
  // The stroke ------------------------
  let stroke: Node | null = null;
  if (s_val && s_val !== 'none' && paths.stroke !== '') {
    const stroke_style = new SPStyle(doc);
    stroke_style.mergeCSS(ncss);
    stroke = xml_doc.createElement('svg:path');
    stroke.setAttribute('style', stroke_style.writeIfDiff(parentStyle));
    stroke.setAttribute('d', paths.stroke);
  }

  // The fill --------------------------
  let fill: Node | null = null;
  if (f_val && f_val !== 'none' && !legacy) {
    const fill_style = new SPStyle(doc);
    fill_style.mergeCSS(ncsf);
    fill = xml_doc.createElement('svg:path');
    fill.setAttribute('style', fill_style.writeIfDiff(parentStyle));
    fill.setAttribute('d', paths.fill);
  }

  // The order of the layers (paint-order); without markers only fill and stroke are left.
  const unique = !fill || !stroke;
  if (!unique) {
    const layer = item.style.paint_order.layer;
    const strokeFirst =
      layer[0] === SPPaintOrderLayer.SP_CSS_PAINT_ORDER_STROKE ||
      (layer[0] === SPPaintOrderLayer.SP_CSS_PAINT_ORDER_MARKER &&
        layer[1] === SPPaintOrderLayer.SP_CSS_PAINT_ORDER_STROKE);
    const first = strokeFirst ? stroke : fill;
    const second = strokeFirst ? fill : stroke;
    if (first) g_repr.appendChild(first);
    if (second) g_repr.appendChild(second);
  }

  // only consider it a change if more than a fill is created.
  const did = stroke !== null;
  let out: Node | null = null;
  if (!fill && did) out = stroke;
  else if (did) out = g_repr;
  else {
    parent.removeChild(g_repr);
    return flatten ? item_repr : null;
  }
  if (!out) return null;

  const r_style = spReprCssAttrNew();
  spReprCssSetProperty(r_style, 'opacity', opacity);
  spReprCssSetProperty(r_style, 'filter', filter);
  spReprCssChange(out, r_style, 'style');

  if (unique) {
    parent.addChild(out, g_repr);
    parent.removeChild(g_repr);
  }
  out.setAttribute('transform', item_repr.attribute('transform'));

  // We're replacing item, delete it.
  item.deleteObject(false);
  out.setAttribute('id', id);
  return out;
}

/**
 * Object > Stroke to Path (strokesToPaths): converts the selected items, keeps the originals
 * selected when nothing changed and adds the new items to the selection. Returns true if anything
 * was converted; the undo step is "Convert stroke to path".
 */
export function strokesToPaths(set: ObjectSet, legacy = false, skip_undo = false): boolean {
  if (set.isEmpty()) return false; // TODO: flash "Select <b>stroked path(s)</b> ..."
  const document = set.document();
  if (!document) return false;
  let did = false;

  const prefs = Preferences.get();
  if (prefs.getBool('/options/pathoperationsunlink/value', true)) did = set.unlinkRecursive(true);

  // Need to turn on stroke scaling to ensure stroke is scaled when transformed!
  const scale_stroke = prefs.getBool('/options/transform/stroke', true);
  prefs.setBool('/options/transform/stroke', true);

  for (const item of set.items()) {
    // Do not remove the object from the selection here
    // as we want to keep it selected if the whole operation fails
    const new_node = item_to_paths(item, legacy);
    if (new_node) {
      const new_item = document.getObjectByRepr(new_node);
      if (new_item) set.add(new_item);
      did = true;
    }
  }
  prefs.setBool('/options/transform/stroke', scale_stroke);

  // TODO: flash "<b>No stroked paths</b> in the selection."
  if (did && !skip_undo) {
    DocumentUndo.done(document, C_('Undo', 'Convert stroke to path'), '');
  }
  return did;
}
