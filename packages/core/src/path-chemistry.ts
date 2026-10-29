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
import { PathVector } from '@inkscape-web/geom';
import { DocumentUndo } from './document-undo.ts';
import { C_ } from './i18n.ts';
import type { ObjectSet } from './object/object-set.ts';
import { SPItem } from './object/sp-item.ts';
import { SPGroup } from './object/sp-item-group.ts';
import { SPLPEItem } from './object/sp-lpe-item.ts';
import type { SPObject } from './object/sp-object.ts';
import { SPPath } from './object/sp-path.ts';
import { SPShape } from './object/sp-shape.ts';
import { FillRule, pathBoolopBackend } from './path/path-boolop.ts';
import { pathvector_append } from './path/path-curve.ts';
import { SPWindRule } from './style-enums.ts';
import { sp_svg_transform_write } from './svg/svg-affine.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from './svg/svg-path.ts';
import type { Node } from './xml/node.ts';
import { sp_repr_compare_position } from './xml/repr-sorting.ts';

function sp_degroup_list_recursive(out: SPItem[], item: SPItem): void {
  if (item instanceof SPGroup) {
    for (const child of item.children) {
      if (child instanceof SPItem) sp_degroup_list_recursive(out, child);
    }
  } else {
    out.push(item);
  }
}

/** Replace all groups in the list with their member objects, recursively. */
function sp_degroup_list(items: readonly SPItem[]): SPItem[] {
  const out: SPItem[] = [];
  for (const item of items) sp_degroup_list_recursive(out, item);
  return out;
}

/** The objects of reprs, in the same order (for upstream ObjectSet::setReprList). */
function objectsOfReprs(set: ObjectSet, reprs: readonly Node[]): SPObject[] {
  const document = set.document();
  if (!document) return [];
  return reprs.map((r) => document.getObjectByRepr(r)).filter((o): o is SPObject => o !== null);
}

/**
 * Combine the paths of the set (shapes are converted, groups entered) into
 * one path with the id, style, transform and z-position of the topmost one,
 * with the undo step "Combine" unless skip_undo.
 * TODO: unlink clones (the action calls unlinkRecursive), LPE (inkscape:original-d),
 * the messages in the status bar, the busy cursor.
 */
export function combine(set: ObjectSet, skip_undo = false, _silent = false): void {
  const doc = set.document();
  let items_copy = set.items();
  if (items_copy.length === 0 || !doc) {
    // TODO: flash "Select <b>object(s)</b> to combine."
    return;
  }

  items_copy = sp_degroup_list(items_copy); // descend into any groups in selection

  const to_paths: SPItem[] = [];
  for (const item of [...items_copy].reverse()) {
    if (!(item instanceof SPPath) && !(item instanceof SPGroup)) to_paths.push(item);
  }
  const converted: Node[] = [];
  let did = sp_item_list_to_curves(to_paths, items_copy, converted);
  for (const node of converted) {
    const object = doc.getObjectByRepr(node);
    if (object instanceof SPItem) items_copy.push(object);
  }

  items_copy = sp_degroup_list(items_copy); // converting to path may have added more groups, descend again

  items_copy.sort((a, b) => sp_repr_compare_position(a.getRepr(), b.getRepr()));

  // remember the position, id, transform and style of the topmost path, they will be assigned to the combined one
  let position = 0;
  let transform: string | null = null;
  let path_effect: string | null = null;

  let curve: PathVector = [];
  let first: SPItem | null = null;
  let parent: Node | null = null;

  if (did) set.clear();

  for (const item of [...items_copy].reverse()) {
    if (!(item instanceof SPPath)) continue;

    if (!did) {
      set.clear();
      did = true;
    }

    const c = item.curve() ?? [];
    if (!first) {
      // this is the topmost path
      first = item;
      parent = first.getRepr().parent();
      position = first.getRepr().position();
      transform = first.getRepr().attribute('transform');
      // FIXME: merge styles of combined objects instead of using the first one's style
      path_effect = first.getRepr().attribute('inkscape:path-effect');
      curve = [...c];
    } else {
      pathvector_append(curve, PathVector.transformed(c, item.getRelativeTransform(first)));

      // reduce position only if the same parent
      if (item.getRepr().parent() === parent) position--;
      // delete the object for real, so that its clones can take appropriate action
      item.deleteObject();
    }
  }

  if (did && first && parent) {
    const repr = doc.getReprDoc().createElement('svg:path');
    copy_object_properties(repr, first.getRepr());

    // delete the topmost.
    first.deleteObject(false);

    // restore id, transform, path effect, and style
    if (transform) repr.setAttribute('transform', transform);
    repr.setAttribute('inkscape:path-effect', path_effect);

    // set path data corresponding to new curve
    const dstring = sp_svg_write_path(curve);
    if (path_effect) repr.setAttribute('inkscape:original-d', dstring);
    else repr.setAttribute('d', dstring);

    // add the new group to the parent of the topmost
    // move to the position of the topmost, reduced by the number of deleted items
    parent.addChildAtPos(repr, Math.max(position, 0));

    if (!skip_undo) DocumentUndo.done(doc, C_('Undo', 'Combine'), 'path-combine');
    const object = doc.getObjectByRepr(repr);
    if (object) set.set(object);
  }
  // TODO: else flash "<b>No path(s)</b> to combine in the selection."
}

/**
 * Break the paths of the set into pieces, with the undo step "Break apart"
 * unless skip_undo. With overlapping (Path > Break Apart) each subpath becomes
 * a path; without it (Path > Split Apart) the parts that do not touch when
 * filled. The first piece keeps the id. Needs the path boolop backend.
 * TODO: LPE (forkPathEffectsIfNecessary), the messages in the status bar.
 */
export function breakApart(set: ObjectSet, skip_undo = false, overlapping = true, _silent = false): void {
  if (set.isEmpty()) {
    // TODO: flash "Select <b>path(s)</b> to break apart."
    return;
  }
  let did = false;

  for (const item of set.items()) {
    if (!(item instanceof SPPath)) continue;
    const pathv = item.curve();
    if (!pathv) continue;

    did = true;

    const repr_item = item.getRepr();
    const parent = repr_item.parent();
    const pos = repr_item.position();
    const id = repr_item.attribute('id');
    const fill_rule = item.style.fill_rule.computed;

    // XML Tree being used directly here while it shouldn't be...
    const style = repr_item.attribute('style');
    // XML Tree being used directly here while it shouldn't be...
    const path_effect = repr_item.attribute('inkscape:path-effect');
    const transform = item.transform;
    // it's going to resurrect as one of the pieces, so we delete without advertisement
    item.deleteObject(false);
    if (!parent) continue;

    const list = pathBoolopBackend().splitNonIntersectingPaths(
      sp_svg_write_path(pathv),
      overlapping ? FillRule.fill_justDont : to_livarot(fill_rule),
    );

    const reprs: Node[] = [];
    list.forEach((d, i) => {
      const repr = parent.document().createElement('svg:path');
      repr.setAttribute('style', style);
      repr.setAttribute('inkscape:path-effect', path_effect);

      const str = sp_svg_write_path(sp_svg_read_pathv(d));
      if (path_effect) repr.setAttribute('inkscape:original-d', str);
      else repr.setAttribute('d', str);
      repr.setAttributeOrRemoveIfEmpty('transform', sp_svg_transform_write(transform));

      // add the new repr to the parent
      // move to the saved position
      parent.addChildAtPos(repr, pos);

      // if it's the first one, restore id
      if (i === 0) repr.setAttribute('id', id);

      reprs.push(repr);
    });
    set.setList(objectsOfReprs(set, reprs));
  }

  const document = set.document();
  if (did && !skip_undo && document) {
    DocumentUndo.done(document, C_('Undo', 'Break apart'), 'path-break-apart');
  }
  // TODO: else flash "<b>No path(s)</b> to break apart in the selection."
}

/** Upstream to_livarot() (SPWindRule to livarot FillRule). */
function to_livarot(fill_rule: SPWindRule): FillRule {
  return fill_rule === SPWindRule.SP_WIND_RULE_EVENODD ? FillRule.fill_oddEven : FillRule.fill_nonZero;
}

/**
 * Convert the items of set to paths, with the undo step "Object to path"
 * unless skip_undo (upstream ObjectSet::toCurves). The converted items take
 * the place of the originals in the set.
 * TODO: unlink clones (unlinkRecursive), text, 3D boxes,
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
    set.setList([...objectsOfReprs(set, to_select), ...selected]);
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
  for (let item of items) {
    // TODO: 3D boxes, connectors.
    const document = item.document;
    // remember id
    const lpe_id = item.getRepr().attribute('id');
    if (item instanceof SPLPEItem && item.hasPathEffect()) {
      const lpeitem = item;
      lpeitem.removeAllPathEffects(true);
      const elemref = document.getObjectById(lpe_id);
      if (elemref !== item) {
        const index = selected.indexOf(item);
        if (index >= 0) selected.splice(index, 1);
        did = true;
        if (elemref instanceof SPItem) {
          //If the LPE item is a shape is converted to a path so we need to reupdate the item
          item = elemref;
          selected.push(item);
        } else {
          // item deleted. Possibly because original-d value has no segments
          continue;
        }
      } else if (!lpeitem.hasPathEffect()) {
        did = true;
      }
    }

    if (item instanceof SPPath) continue; // already a path, and no path effect

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
