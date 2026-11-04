// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path/path-offset.cpp, src/path/path-offset.h
/*
 * Inset and outset of paths, and the creation of dynamic and linked offsets.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Jasper van de Gronde <th.v.d.gronde@hccnet.nl>
 *
 * Copyright (C) 2004 authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Affine } from '@inkscape-web/geom';
import { DocumentUndo } from '../document-undo.ts';
import { C_ } from '../i18n.ts';
import type { ObjectSet } from '../object/object-set.ts';
import { SPItem } from '../object/sp-item.ts';
import { SPShape } from '../object/sp-shape.ts';
import { copy_object_properties } from '../path-chemistry.ts';
import { SPStrokeJoinType, SPWindRule } from '../style-enums.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../svg/svg-path.ts';
import { FillRule, pathBoolopBackend } from './path-boolop.ts';

const MIN_OFFSET = 0.01;

/** The values of livarot's JoinType. */
const JOIN_STRAIGHT = 0;
const JOIN_ROUND = 1;
const JOIN_POINTY = 2;

/** Livarot's fill rule of the item's fill-rule property (nonzero if unset). */
export function livarot_fill_rule(item: SPItem): FillRule {
  return item.style.fill_rule.computed === SPWindRule.SP_WIND_RULE_EVENODD
    ? FillRule.fill_oddEven
    : FillRule.fill_nonZero;
}

/** Offset the selected paths by the preference "default offset width" (upstream sp_selected_path_offset). */
export function sp_selected_path_offset(set: ObjectSet, defaultWidth: number): void {
  sp_selected_path_do_offset(set, true, defaultWidth);
}

/** Inset the selected paths by the preference "default offset width". */
export function sp_selected_path_inset(set: ObjectSet, defaultWidth: number): void {
  sp_selected_path_do_offset(set, false, defaultWidth);
}

/** Offset by a number of screen pixels at the zoom. */
export function sp_selected_path_offset_screen(set: ObjectSet, pixels: number, zoom: number): void {
  sp_selected_path_do_offset(set, true, pixels / zoom);
}

export function sp_selected_path_inset_screen(set: ObjectSet, pixels: number, zoom: number): void {
  sp_selected_path_do_offset(set, false, pixels / zoom);
}

/**
 * Apply offset to the selected paths: expand grows them, else they shrink; prefOffset is the size
 * in px. The path is replaced by the result (upstream sp_selected_path_do_offset); the undo step
 * is "Outset path" or "Inset path".
 */
export function sp_selected_path_do_offset(set: ObjectSet, expand: boolean, prefOffset: number): void {
  // TODO: flash "Select <b>path(s)</b> to inset/outset." and the errors; texts.
  if (set.isEmpty()) return;
  let did = false;
  for (const item of set.items()) {
    if (!(item instanceof SPShape) || !item.curve()) continue;

    const transform = item.transform;
    const scaling_factor = item.i2docAffine().descrim();
    item.doWriteTransform(Affine.identity());

    const style = item.style;
    const join =
      style.stroke_linejoin.value === SPStrokeJoinType.SP_STROKE_LINEJOIN_MITER
        ? JOIN_POINTY
        : style.stroke_linejoin.value === SPStrokeJoinType.SP_STROKE_LINEJOIN_ROUND
          ? JOIN_ROUND
          : JOIN_STRAIGHT;
    // scale to account for transforms and document units
    let o_width = prefOffset / scaling_factor;
    if (scaling_factor === 0 || o_width < MIN_OFFSET) o_width = MIN_OFFSET;
    const o_miter = style.stroke_miterlimit.value * o_width;

    const curve = item.curve();
    if (!curve) continue;
    const d = pathBoolopBackend().offsetShape(
      sp_svg_write_path(curve),
      expand ? o_width : -o_width,
      join,
      o_miter,
      livarot_fill_rule(item),
    );

    did = true;
    // remember the position of the item and its parent
    const item_repr = item.getRepr();
    const pos = item_repr.position();
    const parent = item_repr.parent();
    set.remove(item);

    // if there's 0 or 1 node left, drop this path altogether
    const keep = d && sp_svg_read_pathv(d).some((p) => p.size() > 0);
    const repr = keep && parent ? parent.document().createElement('svg:path') : null;
    if (repr) copy_object_properties(repr, item_repr);
    item.deleteObject(false);

    if (repr && parent) {
      repr.setAttribute('d', d);
      parent.addChildAtPos(repr, pos);
      const newitem = set.document()?.getObjectByRepr(repr);
      if (newitem instanceof SPItem) {
        // reapply the transform
        newitem.doWriteTransform(transform);
        set.add(newitem);
      }
    }
  }

  const document = set.document();
  if (did && document) {
    DocumentUndo.done(
      document,
      expand ? C_('Undo', 'Outset path') : C_('Undo', 'Inset path'),
      expand ? 'path-outset' : 'path-inset',
    );
  }
}

/**
 * Replace the single selected path by a dynamic offset (updating false) or add a linked offset
 * that follows it (updating true), with expand 1 for an outset, -1 for an inset and 0 for none by
 * the default offset width (upstream sp_selected_path_create_offset_object).
 */
export function sp_selected_path_create_offset_object(
  set: ObjectSet,
  expand: number,
  updating: boolean,
  defaultWidth: number,
): void {
  const item = set.singleItem();
  const document = set.document();
  if (!(item instanceof SPShape) || !item.curve() || !document) return;
  // TODO: flash "Selected object is <b>not a path</b>, cannot inset/outset."

  const transform = item.transform;
  const scaling_factor = item.i2docAffine().descrim();
  item.doWriteTransform(Affine.identity());

  // remember the position of the item and its parent
  const item_repr = item.getRepr();
  const pos = item_repr.position();
  const parent = item_repr.parent();

  let o_width = defaultWidth / scaling_factor;
  if (scaling_factor === 0 || o_width < MIN_OFFSET) o_width = MIN_OFFSET;

  const curve = item.curve();
  if (!curve || !parent) return;
  // The outline of the item as a contour without self-intersections: the original of the offset.
  const original = pathBoolopBackend().normalizeShape(sp_svg_write_path(curve), livarot_fill_rule(item));
  const description = updating ? C_('Undo', 'Create linked offset') : C_('Undo', 'Create dynamic offset');
  const icon = updating ? 'path-offset-linked' : 'path-offset-dynamic';
  if (!original) {
    // there's nothing left
    DocumentUndo.done(document, description, icon);
    set.clear();
    return;
  }

  const repr = parent.document().createElement('svg:path');
  if (!updating) copy_object_properties(repr, item_repr);
  else repr.setAttribute('style', item_repr.attribute('style'));

  repr.setAttribute('sodipodi:type', 'inkscape:offset');
  repr.setAttributeSvgDouble('inkscape:radius', expand > 0 ? o_width : expand < 0 ? -o_width : 0);
  repr.setAttribute('inkscape:original', original);

  if (updating) {
    item.doWriteTransform(transform);
    repr.setAttribute('xlink:href', `#${item_repr.attribute('id')}`);
  } else {
    repr.removeAttribute('inkscape:href');
    // delete original
    item.deleteObject(false);
  }

  // add the new repr to the parent, at the saved position
  parent.addChildAtPos(repr, pos);
  const nitem = document.getObjectByRepr(repr);
  if (nitem instanceof SPItem) {
    // apply the transform to the offset
    if (!updating) nitem.doWriteTransform(transform);
    // The object just created from a temporary repr is only a seed: its write adds the d attribute.
    nitem.updateRepr();
    set.set(nitem);
  }
  DocumentUndo.done(document, description, icon);
}
