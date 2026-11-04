// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-paths.cpp, src/ui/tools/booleans-builder.cpp, src/ui/tools/booleans-builder.h
/*
 * Fracture and Flatten: the whole selection as a boolean builder commit.
 *
 * Authors:
 *   Martin Owens <doctormo@gmail.com>
 *
 * Copyright (C) 2024 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { PathVector } from '@inkscape-web/geom';
import { DocumentUndo } from '../document-undo.ts';
import { C_ } from '../i18n.ts';
import type { ObjectSet } from '../object/object-set.ts';
import type { SPItem } from '../object/sp-item.ts';
import { SPShape } from '../object/sp-shape.ts';
import { SPWindRule } from '../style-enums.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../svg/svg-path.ts';
import { sp_repr_compare_position } from '../xml/repr-sorting.ts';
import { BooleanOp, FillRule, pathBoolopBackend } from './path-boolop.ts';
import { strokesToPaths } from './path-outline.ts';

/** A piece of the plane in document coordinates, painted like its source item. */
interface Fragment {
  d: string;
  source: SPItem;
}

const hasArea = (d: string): boolean => d !== '' && sp_svg_read_pathv(d).length > 0;

/**
 * The fragments of the shapes of the items (bottom to top): each region of the plane with the
 * same stack of shapes above it is one fragment, painted like the topmost shape. With visibleOnly
 * the fragments of one source are united, so that the result is what is visible.
 * The BooleanBuilder of upstream does the same with a livarot shape.
 */
function build_fragments(items: readonly SPItem[], visibleOnly: boolean): Fragment[] {
  const geom = pathBoolopBackend();
  let fragments: Fragment[] = [];
  for (const item of items) {
    const curve = item instanceof SPShape ? item.curve() : null;
    if (!curve) continue;
    const rule =
      item.style.fill_rule.computed === SPWindRule.SP_WIND_RULE_EVENODD
        ? FillRule.fill_oddEven
        : FillRule.fill_nonZero;
    const shape = sp_svg_write_path(PathVector.transformed(curve, item.i2docAffine()));

    const next: Fragment[] = [];
    // The part of the new shape that no fragment covers.
    // (as a contour without self-intersections, which fill_nonZero reads)
    let rest = geom.boolop(shape, shape, BooleanOp.bool_op_union, rule, rule);
    for (const fragment of fragments) {
      // boolop(a, b, diff) is b minus a.
      const kept = geom.boolop(shape, fragment.d, BooleanOp.bool_op_diff, rule, FillRule.fill_nonZero);
      if (hasArea(kept)) next.push({ d: kept, source: fragment.source });
      if (!visibleOnly) {
        const covered = geom.boolop(fragment.d, shape, BooleanOp.bool_op_inters, FillRule.fill_nonZero, rule);
        if (hasArea(covered)) next.push({ d: covered, source: item });
        rest = geom.boolop(
          fragment.d,
          rest,
          BooleanOp.bool_op_diff,
          FillRule.fill_nonZero,
          FillRule.fill_nonZero,
        );
      }
    }
    // Flatten: the new shape is on top, so all of it is visible.
    const own = rest;
    if (hasArea(own)) next.push({ d: own, source: item });
    fragments = next;
  }
  return fragments;
}

/**
 * Replace the selected shapes by their fragments and select them. Each connected piece is a
 * path with the style of its topmost source, in the place of that source.
 */
function commit(set: ObjectSet, visibleOnly: boolean): void {
  const document = set.document();
  if (!document) return;
  const items = set.items().sort((a, b) => sp_repr_compare_position(a.getRepr(), b.getRepr()));
  const fragments = build_fragments(items, visibleOnly);
  const xml_doc = document.getReprDoc();
  const created = [];

  for (const fragment of fragments) {
    const source = fragment.source;
    const parent = source.parent;
    if (!parent || !(parent as SPItem).i2docAffine) continue;
    const to_parent = (parent as SPItem).i2docAffine().inverse();
    const pieces = visibleOnly
      ? [fragment.d]
      : pathBoolopBackend().splitNonIntersectingPaths(fragment.d, FillRule.fill_nonZero);
    for (const piece of pieces) {
      const repr = xml_doc.createElement('svg:path');
      repr.setAttribute('d', sp_svg_write_path(PathVector.transformed(sp_svg_read_pathv(piece), to_parent)));
      repr.setAttribute('style', source.style.writeIfDiff(parent.style));
      source.getRepr().parent()?.addChild(repr, source.getRepr());
      created.push(repr);
    }
  }
  for (const item of items) item.deleteObject(false);
  set.clear();
  for (const repr of created) {
    const object = document.getObjectByRepr(repr);
    if (object) set.add(object);
  }
}

/** Path > Fracture: split overlapping shapes into all their segments (undo step "Fracture"). */
export function pathFracture(set: ObjectSet): void {
  const document = set.document();
  if (!document || set.isEmpty()) return;
  commit(set, false);
  DocumentUndo.done(document, C_('Undo', 'Fracture'), 'path-fracture');
}

/** Path > Flatten: keep only the visible parts of overlapping shapes (undo step "Flatten"). */
export function pathFlatten(set: ObjectSet): void {
  const document = set.document();
  if (!document || set.isEmpty()) return;
  strokesToPaths(set, false, true);
  commit(set, true);
  DocumentUndo.done(document, C_('Undo', 'Flatten'), 'path-flatten');
}
