// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path/path-simplify.cpp, src/path/path-simplify.h, src/path/path-object-set.cpp
/*
 * Simplify paths (reduce node count).
 *
 * Authors:
 * see git history
 *  Created by fred on Fri Dec 05 2003.
 *  tweaked endlessly by bulia byak <buliabyak@users.sf.net>
 *
 * Copyright (C) 2018 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Affine } from '@inkscape-web/geom';
import { DocumentUndo } from '../document-undo.ts';
import { C_ } from '../i18n.ts';
import type { ObjectSet } from '../object/object-set.ts';
import type { SPItem } from '../object/sp-item.ts';
import { SPGroup } from '../object/sp-item-group.ts';
import { SPPath } from '../object/sp-path.ts';
import { Preferences } from '../preferences.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import { pathBoolopBackend } from './path-boolop.ts';

/**
 * Simplify the path or the paths of a group; returns the number of paths simplified. size is the
 * diagonal of the selection (path_simplify).
 */
export function path_simplify(item: SPItem, threshold: number, justCoalesce: boolean, size: number): number {
  if (item instanceof SPGroup) {
    let count = 0;
    for (const child of item.item_list()) count += path_simplify(child, threshold, justCoalesce, size);
    return count;
  }
  if (!(item instanceof SPPath)) return 0;

  const orig_path_str = item.getAttribute('d') ?? '';
  const nodes_before_simplify = item.nodesInPath();

  // There is actually no option in the preferences dialog for this!
  if (Preferences.get().getBool('/options/simplifyindividualpaths/value')) {
    const bbox = item.documentVisualBounds();
    size = bbox ? Math.hypot(bbox.width(), bbox.height()) : 0;
  }
  // Correct virtual size by full transform (bug #166937).
  size /= item.i2docAffine().descrim();

  // Save the transform, to re-apply it after simplification.
  const transform = item.transform;
  // Reset the transform so that all compensations cancel out regardless of the preferences.
  item.doWriteTransform(Affine.identity());

  // Get the path to simplify: the one before the path effect.
  const curve = item.curveBeforeLPE() ?? item.curve();
  if (!curve) return 0;
  const simplified = pathBoolopBackend().simplifyPath(
    sp_svg_write_path(curve),
    threshold * size,
    1,
    justCoalesce,
  );

  const patheffect = item.getAttribute('inkscape:path-effect');
  item.setAttribute(patheffect ? 'inkscape:original-d' : 'd', simplified);

  item.doWriteTransform(transform);
  // remove irrelevant old nodetypes attribute
  item.removeAttribute('sodipodi:nodetypes');

  if (nodes_before_simplify < item.nodesInPath()) {
    item.setAttribute(patheffect ? 'inkscape:original-d' : 'd', orig_path_str);
    return 0;
  }
  return 1;
}

/** Remembers the time of the last call: calls in quick succession simplify more (accelerated simplify). */
let previous_time = 0;
let multiply = 1;

/**
 * Path > Simplify (Ctrl+L): returns true if any path was simplified. The undo step is "Simplify".
 * now is the time in ms, for tests.
 */
export function simplifyPaths(set: ObjectSet, skip_undo = false, now: number = Date.now()): boolean {
  if (set.isEmpty()) return false;
  // TODO: flash "Select <b>path(s)</b> to simplify."
  const prefs = Preferences.get();
  let threshold = prefs.getDouble('/options/simplifythreshold/value', 0.003);
  const justCoalesce = prefs.getBool('/options/simplifyjustcoalesce/value', false);

  // Was the previous call to this function recent? (< 0.5 sec)
  if (previous_time > 0 && now - previous_time < 500) {
    // add to the threshold 1/2 of its original value
    multiply += 0.5;
    threshold *= multiply;
  } else {
    multiply = 1;
  }
  previous_time = now;

  const bbox = set.visualBounds();
  if (!bbox) return false;
  const size = Math.hypot(bbox.width(), bbox.height());

  let simplified = 0;
  for (const item of set.items()) simplified += path_simplify(item, threshold, justCoalesce, size);

  const document = set.document();
  if (simplified > 0 && !skip_undo && document) {
    DocumentUndo.done(document, C_('Undo', 'Simplify'), 'path-simplify');
  }
  return simplified > 0;
}
