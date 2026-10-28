// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path/path-object-set.cpp, src/path/path-util.cpp
/*
 * Path related functions for ObjectSet.
 *
 * Copyright (C) 2020 Tavmjong Bah
 */
import { PathVector } from '@inkscape-web/geom';
import { DocumentUndo } from '../document-undo.ts';
import { _, C_ } from '../i18n.ts';
import type { ObjectSet } from '../object/object-set.ts';
import type { SPItem } from '../object/sp-item.ts';
import { SPShape } from '../object/sp-shape.ts';
import { copy_object_properties } from '../path-chemistry.ts';
import { SPWindRule } from '../style-enums.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../svg/svg-path.ts';
import type { Node } from '../xml/node.ts';
import { spReprCssAttrNew, spReprCssChange, spReprCssSetProperty } from '../xml/repr-css.ts';
import {
  find_containing_child,
  is_descendant_of,
  lowest_common_ancestor,
  sp_repr_compare_position,
} from '../xml/repr-sorting.ts';
import { BooleanOp, FillRule, pathBoolopBackend } from './path-boolop.ts';

/** TODO: text and flowed text. */
function item_has_curve(item: SPItem): boolean {
  return item instanceof SPShape;
}

/** The curve of a shape (upstream curve_for_item). TODO: text, the curve before LPEs. */
function curve_for_item(item: SPItem): PathVector | null {
  return item instanceof SPShape ? item.curve() : null;
}

/** Path > Union, undo step "Union". */
export function pathUnion(set: ObjectSet, skip_undo = false, silent = false): void {
  _pathBoolOpUndo(set, BooleanOp.bool_op_union, 'path-union', C_('Undo', 'Union'), skip_undo, silent);
}

/** Path > Intersection, undo step "Intersection". */
export function pathIntersect(set: ObjectSet, skip_undo = false, silent = false): void {
  _pathBoolOpUndo(
    set,
    BooleanOp.bool_op_inters,
    'path-intersection',
    C_('Undo', 'Intersection'),
    skip_undo,
    silent,
  );
}

/** Path > Difference (bottom minus top), undo step "Difference". */
export function pathDiff(set: ObjectSet, skip_undo = false, silent = false): void {
  _pathBoolOpIterative(
    set,
    BooleanOp.bool_op_diff,
    'path-difference',
    C_('Undo', 'Difference'),
    skip_undo,
    silent,
  );
}

/** Path > Exclusion, undo step "Exclusion". */
export function pathSymDiff(set: ObjectSet, skip_undo = false, silent = false): void {
  _pathBoolOpUndo(
    set,
    BooleanOp.bool_op_symdiff,
    'path-exclusion',
    C_('Undo', 'Exclusion'),
    skip_undo,
    silent,
  );
}

/** Path > Division: cut the bottom path into pieces, undo step "Division". */
export function pathCut(set: ObjectSet, skip_undo = false, silent = false): void {
  _pathBoolOpIterative(
    set,
    BooleanOp.bool_op_cut,
    'path-division',
    C_('Undo', 'Division'),
    skip_undo,
    silent,
  );
}

/** Path > Cut Path: cut the bottom path's stroke into pieces, undo step "Cut path". */
export function pathSlice(set: ObjectSet, skip_undo = false, silent = false): void {
  _pathBoolOpIterative(set, BooleanOp.bool_op_slice, 'path-cut', C_('Undo', 'Cut path'), skip_undo, silent);
}

/** Report an error of a boolean operation. TODO: flash it in the message stack of the desktop. */
function reportError(msg: string, silent: boolean): void {
  if (!silent) console.warn(msg);
}

/**
 * This allows Difference, Divsion, and Cut to work on more than two objects by repeatedly copying the
 * top object and applying the operation one-by-one on the objects beneath.
 */
function _pathBoolOpIterative(
  set: ObjectSet,
  bop: BooleanOp,
  icon_name: string,
  description: string,
  skip_undo: boolean,
  silent: boolean,
): void {
  const items = set.items();
  const document = set.document();
  if (items.length <= 2 || !document) {
    // Short circuit all this nonsense
    _pathBoolOpUndo(set, bop, icon_name, description, skip_undo, silent);
    return;
  }

  items.sort((a, b) => sp_repr_compare_position(a.getRepr(), b.getRepr()));
  const xml_doc = document.getReprDoc();
  const top = items.at(-1) as SPItem;
  if (!item_has_curve(top)) {
    reportError(_('Top object must be a shape or text to perform boolean operations.'), silent);
    return;
  }
  const top_repr = top.getRepr();
  items.pop();

  let done = false;
  while (items.length > 0) {
    const item = items.at(-1) as SPItem;
    if (item_has_curve(item)) {
      // Duplicate top element and insert it next to original
      const top_copy = top_repr.duplicate(xml_doc);
      top_repr.parent()?.addChild(top_copy, top_repr);
      const top_copy_item = document.getObjectByRepr(top_copy);
      // The copy builds its curve on the next update (upstream calls set_shape()).
      document.ensureUpToDate();

      // Clear selection and add our two objects.
      set.clear();
      set.add(item);
      if (top_copy_item) set.add(top_copy_item);

      _pathBoolOpUndo(set, bop, icon_name, description, true, silent);
      done = true;
    }
    // Move on to next item.
    items.pop();
  }

  if (done) {
    // _pathBoolOp always removed a copy, we need to remove original (if at least one bool up done).
    top_repr.parent()?.removeChild(top_repr);
    if (!skip_undo) DocumentUndo.done(document, description, icon_name);
  }
}

/** Upstream _pathBoolOp(bop, icon_name, description, skip_undo, silent): run it with an undo step. */
function _pathBoolOpUndo(
  set: ObjectSet,
  bop: BooleanOp,
  icon_name: string,
  description: string,
  skip_undo: boolean,
  silent: boolean,
): void {
  try {
    _pathBoolOp(set, bop);
    const document = set.document();
    if (!skip_undo && document) DocumentUndo.done(document, description, icon_name);
  } catch (e) {
    if (!(e instanceof BoolOpError)) throw e;
    reportError(e.message, silent);
  }
}

/** A user error of a boolean operation (upstream throws the message as char const*). */
class BoolOpError extends Error {}

/** The operand of one item: fill rule and path in document coordinates. */
interface Operand {
  fill_rule: FillRule;
  pathv: string;
}

/**
 * Run the boolean operation on the items of set and replace them with the
 * result. The result takes the place, id, style and transform of the bottom
 * item; for difference, division and cut path of the bottom one of the two
 * items. Throws BoolOpError if the set has too few items.
 *
 * Differences to upstream: the operands are combined pairwise with
 * sp_pathvector_boolop() instead of in one livarot run, so the
 * intersection points are computed per pair.
 * TODO: LPE items (removeAllPathEffects), text.
 */
function _pathBoolOp(set: ObjectSet, bop: BooleanOp): void {
  const doc = set.document();
  if (!doc) return;

  // Grab the items list.
  const il = set.items();

  // Validate number of items.
  if (bop === BooleanOp.bool_op_union) {
    if (il.length < 1) {
      // Allow union of single item --> flatten.
      throw new BoolOpError(_('Select <b>at least 1 path</b> to perform a boolean union.'));
    }
  } else if (il.length < 2) {
    throw new BoolOpError(_('Select <b>at least 2 paths</b> to perform the boolean operation.'));
  }

  // reverseOrderForOp marks whether the order of the list is the top->down order
  // it's only used when there are 2 objects, and for operations which need to know the
  // topmost object (differences, cuts)
  let reverseOrderForOp = false;
  const twoOperands =
    bop === BooleanOp.bool_op_diff || bop === BooleanOp.bool_op_cut || bop === BooleanOp.bool_op_slice;

  if (twoOperands) {
    // check in the tree to find which element of the selection list is topmost (for 2-operand commands only)
    const a = (il[0] as SPItem).getRepr();
    const b = (il.at(-1) as SPItem).getRepr();

    if (is_descendant_of(a, b)) {
      // a is a child of b, already in the proper order
    } else if (is_descendant_of(b, a)) {
      // reverse order
      reverseOrderForOp = true;
    } else {
      // objects are not in parent/child relationship;
      // find their lowest common ancestor
      const parent = lowest_common_ancestor(a, b);
      if (!parent) return;

      // find the children of the LCA that lead from it to the a and b
      const as = find_containing_child(a, parent);
      const bs = find_containing_child(b, parent);

      // find out which comes first
      for (let child = parent.firstChild(); child; child = child.next()) {
        if (child === as) {
          /* a first, so reverse. */
          reverseOrderForOp = true;
          break;
        }
        if (child === bs) break;
      }
    }
  }

  // First check if all the input objects have curves, otherwise bail out.
  if (!il.every(item_has_curve)) return;

  // Extract the fill rules and pathvectors from the source objects.
  const operands: Operand[] = [];
  for (const item of il) {
    const curve = curve_for_item(item);
    if (!curve) {
      console.error(`Inkscape::ObjectSet::_pathBoolOp(BooleanOp bop): no curve: ${item.getId() ?? 'no id'}`);
      return;
    }
    operands.push({
      fill_rule:
        item.style.fill_rule.computed === SPWindRule.SP_WIND_RULE_EVENODD
          ? FillRule.fill_oddEven
          : FillRule.fill_nonZero,
      pathv: sp_svg_write_path(PathVector.transformed(curve, item.i2docAffine())),
    });
    if (PathVector.curveCount(curve) === 0) return;
  }

  // reverse if needed
  // note that the selection list keeps its order
  if (reverseOrderForOp) [operands[0], operands[1]] = [operands[1] as Operand, operands[0] as Operand];

  const geom = pathBoolopBackend();
  // The resulting paths, in document coordinates.
  let results: string[];
  const first = operands[0] as Operand;
  const second = operands[1];
  if (bop === BooleanOp.bool_op_cut && second) {
    // the bottom path cut by the top one
    results = geom.cutPath(second.pathv, first.pathv);
  } else if (bop === BooleanOp.bool_op_slice && second) {
    // there are moveto's at each intersection, but it's still one unique path
    // so break it down and add each subpath independently
    const res = geom.boolop(first.pathv, second.pathv, bop, first.fill_rule, second.fill_rule);
    results = sp_svg_read_pathv(res).map((p) => sp_svg_write_path(p));
  } else {
    // true boolean op
    // apply the operation iteratively; operands[0] is the top object for difference
    let res = first.pathv;
    let fill = first.fill_rule;
    for (const operand of operands.slice(1)) {
      res = geom.boolop(res, operand.pathv, bop, fill, operand.fill_rule);
      // the result has no self-intersections
      fill = FillRule.fill_nonZero;
    }
    // Union of a single item: flatten it (the union with itself).
    if (operands.length === 1) res = geom.boolop(res, res, bop, fill, fill);
    results = sp_svg_read_pathv(res).length > 0 ? [res] : [];
  }

  if (results.length === 0) {
    // only one command, presumably a moveto: it isn't a path
    for (const l of il) l.deleteObject();
    set.clear();
    return;
  }

  // get the source path object
  let source: SPItem;
  if (twoOperands) {
    source = reverseOrderForOp ? (il[0] as SPItem) : (il.at(-1) as SPItem);
  } else {
    // find out the bottom object
    source = [...il].sort((a, b) => sp_repr_compare_position(a.getRepr(), b.getRepr()))[0] as SPItem;
  }

  // adjust style properties that depend on a possible transform in the source object in order
  // to get a correct style attribute for the new path
  const i2doc = source.i2docAffine();
  const repr_source = source.getRepr();

  // remember important aspects of the source path, to be restored
  const pos = repr_source.position();
  const parent = repr_source.parent();
  if (!parent) return;
  // remove source paths
  set.clear();
  for (const l of il) {
    // delete the object for real, so that its clones can take appropriate action
    if (l !== source) l.deleteObject();
  }

  const source2doc_inverse = i2doc.inverse();
  const old_transform_attibute = repr_source.attribute('transform');
  const xml_doc = doc.getReprDoc();

  // now that we have the result, add it on the canvas
  const selection: Node[] = [];
  results.forEach((d, i) => {
    const repr = xml_doc.createElement('svg:path');
    copy_object_properties(repr, repr_source);

    // Delete source on last iteration (after we don't need repr_source anymore). As a consequence, the last
    // item will inherit the original's id.
    if (i + 1 === results.length) source.deleteObject(false);

    repr.setAttribute(
      'd',
      sp_svg_write_path(PathVector.transformed(sp_svg_read_pathv(d), source2doc_inverse)),
    );

    // for slice, remove fill
    if (bop === BooleanOp.bool_op_slice) {
      const css = spReprCssAttrNew();
      spReprCssSetProperty(css, 'fill', 'none');
      spReprCssChange(repr, css, 'style');
    }

    repr.setAttributeOrRemoveIfEmpty('transform', old_transform_attibute);

    // add the new repr to the parent
    // move to the saved position
    parent.addChildAtPos(repr, pos);
    selection.push(repr);
  });
  // upstream setReprList(selection)
  set.setList(selection.map((r) => doc.getObjectByRepr(r)).filter((o) => o !== null));
}
