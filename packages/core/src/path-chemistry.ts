// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path-chemistry.cpp, src/path-chemistry.h
/*
 * Here are handlers for modifying selections, specific to paths
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jasper van de Gronde <th.v.d.gronde@hccnet.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2008 Authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { DocumentUndo } from './document-undo.ts';
import { C_ } from './i18n.ts';
import type { ObjectSet } from './object/object-set.ts';
import { SPItem } from './object/sp-item.ts';
import { SPGroup } from './object/sp-item-group.ts';
import type { SPObject } from './object/sp-object.ts';
import { SPPath } from './object/sp-path.ts';
import { SPShape } from './object/sp-shape.ts';
import { sp_svg_write_path } from './svg/svg-path.ts';
import type { Node } from './xml/node.ts';

/**
 * Convert the items of set to paths, with the undo step "Object to path"
 * unless skip_undo (upstream ObjectSet::toCurves). The converted items take
 * the place of the originals in the set.
 * TODO: unlink clones (unlinkRecursive), text, 3D boxes, LPE items,
 * the messages in the status bar.
 */
export function toCurves(set: ObjectSet, skip_undo = false): void {
  if (set.isEmpty()) {
    // TODO: flash "Select <b>object(s)</b> to convert to path."
    return;
  }
  const selected = set.items();
  const to_select: Node[] = [];
  const did = sp_item_list_to_curves([...selected], selected, to_select);
  const document = set.document();
  if (did && document) {
    // upstream setReprList(to_select); addList(selected)
    const objects = to_select
      .map((repr) => document.getObjectByRepr(repr))
      .filter((o): o is SPObject => o !== null);
    set.setList([...objects, ...selected]);
  }
  if (did && !skip_undo && document) {
    DocumentUndo.done(document, C_('Undo', 'Object to path'), 'object-to-path');
  }
  // TODO: else flash "<b>No objects</b> to convert to path in the selection."
}

function collect_object_items(object: SPObject, items: SPItem[]): void {
  for (const child of object.children) {
    if (child instanceof SPItem) items.push(child);
    else collect_object_items(child, items);
  }
}

/**
 * Convert items to paths. Converted items are removed from selected and their
 * new reprs are added to to_select; groups are converted recursively.
 * Returns true if anything was converted.
 */
export function sp_item_list_to_curves(
  items: readonly SPItem[],
  selected: SPItem[],
  to_select: Node[],
): boolean {
  let did = false;
  for (const item of items) {
    // TODO: 3D boxes, LPE items, connectors.
    if (item instanceof SPPath) continue; // already a path

    if (item instanceof SPGroup) {
      const item_list: SPItem[] = [];
      // This convoluted system allows SPItem's in defs to be collected too
      collect_object_items(item, item_list);
      if (sp_item_list_to_curves(item_list, [], [])) did = true;
      continue;
    }

    // remember id
    const id = item.getRepr().attribute('id');
    const repr = sp_selected_item_to_curved_repr(item);
    if (!repr) continue;

    did = true;
    const index = selected.indexOf(item);
    if (index >= 0) selected.splice(index, 1);

    // remember the position of the item
    const pos = item.getRepr().position();
    // remember parent
    const parent = item.getRepr().parent();
    // remember class
    const class_attr = item.getRepr().attribute('class');

    // It's going to resurrect, so we delete without notifying listeners.
    item.deleteObject(false);

    // restore id
    repr.setAttribute('id', id);
    // restore class
    repr.setAttribute('class', class_attr);
    // add the new repr to the parent
    parent?.addChild(repr, pos > 0 ? parent.nthChild(pos - 1) : null);

    to_select.unshift(repr);
  }
  return did;
}

/** A new svg:path repr with the geometry, style and properties of item, or null. TODO: text. */
export function sp_selected_item_to_curved_repr(item: SPItem): Node | null {
  const xml_doc = item.getRepr().document();
  const curve = item instanceof SPShape ? item.curve() : null;
  // Prevent empty paths from being added to the document
  // otherwise we end up with zomby markup in the SVG file
  if (!curve || curve.length === 0) return null;

  const repr = xml_doc.createElement('svg:path');
  copy_object_properties(repr, item.getRepr());

  /* Transformation */
  repr.setAttribute('transform', item.getRepr().attribute('transform'));

  /* Style */
  const parentStyle = item.parent ? item.parent.style : null;
  repr.setAttribute('style', item.style.writeIfDiff(parentStyle) || null);

  /* Definition */
  repr.setAttribute('d', sp_svg_write_path(curve));
  return repr;
}

/** Attributes copied by copy_object_properties. */
const GENERIC_ATTRIBUTES = [
  // core
  'id',
  // clip & mask
  'clip-path',
  'mask',
  // style
  'style',
  'class',
  // inkscape
  'inkscape:highlight-color',
  'inkscape:label',
  'inkscape:transform-center-x',
  'inkscape:transform-center-y',
  // interactivity
  'onclick',
  'onmouseover',
  'onmouseout',
  'onmousedown',
  'onmouseup',
  'onmousemove',
  'onfocusin',
  'onfocusout',
  'onload',
];

/**
 * Copy generic object properties, like id, label, title, description, style,
 * clip, mask, transformation center, highlight color and interactivity
 * (event attributes), and XML comments.
 */
export function copy_object_properties(dest: Node, src: Node): void {
  for (const key of GENERIC_ATTRIBUTES) {
    const value = src.attribute(key);
    if (value !== null) dest.setAttribute(key, value);
  }
  const doc = dest.document();
  for (const child of src.children()) {
    // check if this child should be copied
    if (!(child.type() === 'comment' || child.name() === 'svg:title' || child.name() === 'svg:desc'))
      continue;
    dest.appendChild(child.duplicate(doc));
  }
}
