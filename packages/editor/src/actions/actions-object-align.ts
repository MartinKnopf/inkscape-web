// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-object-align.cpp, src/actions/actions-object-align.h, src/object/algorithms/bboxsort.h
/*
 * Gio::Actions for aligning and distributing objects without GUI.
 *
 * Copyright (C) 2020 Tavmjong Bah
 *
 * Some code and ideas from src/ui/dialogs/align-and-distribute.cpp
 *   Authors: Bryce Harrington
 *            Martin Owens
 *            John Smith
 *            Patrick Storz
 *            Jabier Arraiza
 */
import { C_, CompareSize, DocumentUndo, ObjectSet, Preferences, type SPItem } from '@inkscape-web/core';
import { are_near, type OptRect, Point, type Rect, Translate } from '@inkscape-web/geom';

enum ObjectAlignTarget {
  LAST,
  FIRST,
  BIGGEST,
  SMALLEST,
  PAGE,
  DRAWING,
  SELECTION,
}

/**
 * app.object-align: align the items of selection. value is a list of words:
 * [left|hcenter|right] [top|vcenter|bottom]
 * [last|first|biggest|smallest|page|drawing|selection|pref]? group? anchor?
 * "pref" takes the target and "group" from the preferences of the dialog.
 * One undo step "Align" if anything moved.
 * TODO: bool LPE operands, items with the hidder filter.
 */
export function object_align(selection: ObjectSet, value: string): void {
  const prefs = Preferences.get();
  const tokens = value.split(' ');
  const document = selection.document();
  if (!document) return;

  // Find out if we are using an anchor.
  const anchor = tokens.includes('anchor');

  // Default values:
  let target = ObjectAlignTarget.SELECTION;

  let group = false;
  let mx0 = 0;
  let mx1 = 0;
  let my0 = 0;
  let my1 = 0;
  let sx0 = 0;
  let sx1 = 0;
  let sy0 = 0;
  let sy1 = 0;

  // Preference request allows alignment action to remember for key-presses
  if (tokens.includes('pref')) {
    group = prefs.getBool('/dialogs/align/sel-as-groups', false);
    tokens.push(prefs.getString('/dialogs/align/objects-align-to', 'selection'));
  }

  for (const token of tokens) {
    // Target
    if (token === 'last') target = ObjectAlignTarget.LAST;
    else if (token === 'first') target = ObjectAlignTarget.FIRST;
    else if (token === 'biggest') target = ObjectAlignTarget.BIGGEST;
    else if (token === 'smallest') target = ObjectAlignTarget.SMALLEST;
    else if (token === 'page') target = ObjectAlignTarget.PAGE;
    else if (token === 'drawing') target = ObjectAlignTarget.DRAWING;
    else if (token === 'selection') target = ObjectAlignTarget.SELECTION;
    // Group
    else if (token === 'group') group = true;

    // Position
    if (!anchor) {
      if (token === 'left') [mx0, mx1, sx0, sx1] = [1, 0, 1, 0];
      else if (token === 'hcenter') [mx0, mx1, sx0, sx1] = [0.5, 0.5, 0.5, 0.5];
      else if (token === 'right') [mx0, mx1, sx0, sx1] = [0, 1, 0, 1];
      else if (token === 'top') [my0, my1, sy0, sy1] = [1, 0, 1, 0];
      else if (token === 'vcenter') [my0, my1, sy0, sy1] = [0.5, 0.5, 0.5, 0.5];
      else if (token === 'bottom') [my0, my1, sy0, sy1] = [0, 1, 0, 1];
    } else {
      if (token === 'left') [mx0, mx1, sx0, sx1] = [0, 1, 1, 0];
      else if (token === 'hcenter') console.warn("'anchor' cannot be used with 'hcenter'");
      else if (token === 'right') [mx0, mx1, sx0, sx1] = [1, 0, 0, 1];
      else if (token === 'top') [my0, my1, sy0, sy1] = [0, 1, 1, 0];
      else if (token === 'vcenter') console.warn("'anchor' cannot be used with 'vcenter'");
      else if (token === 'bottom') [my0, my1, sy0, sy1] = [1, 0, 0, 1];
    }
  }

  const selected = selection.items();
  if (selected.length === 0) return;

  // Find alignment rectangle. This can come from:
  // - The bounding box of an object
  // - The bounding box of a group of objects
  // - The bounding box of the page, drawing, or selection.
  let focus: SPItem | null = null;
  let b: OptRect = null;
  const direction = mx0 !== 0 || mx1 !== 0 ? CompareSize.VERTICAL : CompareSize.HORIZONTAL;

  switch (target) {
    case ObjectAlignTarget.LAST:
      focus = selected.at(-1) ?? null;
      break;
    case ObjectAlignTarget.FIRST:
      focus = selected[0] ?? null;
      break;
    case ObjectAlignTarget.BIGGEST:
      focus = selection.largestItem(direction);
      break;
    case ObjectAlignTarget.SMALLEST:
      focus = selection.smallestItem(direction);
      break;
    case ObjectAlignTarget.PAGE:
      b = document.pageBounds();
      break;
    case ObjectAlignTarget.DRAWING:
      b = document.getRoot().desktopPreferredBounds();
      break;
    case ObjectAlignTarget.SELECTION:
      b = selection.preferredBounds();
      break;
  }

  if (focus) b = focus.desktopPreferredBounds();
  if (!b) return;

  if (selection.desktop() && document.yaxisdir() < 0) {
    [my0, my1] = [my1, my0];
    [sy0, sy1] = [sy1, sy0];
  }

  // Generate the move point from the selected bounding box
  const mp = new Point(mx0 * b.left() + mx1 * b.right(), my0 * b.top() + my1 * b.bottom());

  if (group) {
    if (focus) {
      // Use bounding box of all selected elements except the "focused" element.
      const copy = new ObjectSet(document);
      copy.setList(selection.objects());
      copy.remove(focus);
      b = copy.preferredBounds();
    } else {
      // Use bounding box of all selected elements.
      b = selection.preferredBounds();
    }
  }

  // Move each item in the selected list separately.
  let changed = false;
  for (const item of selected) {
    document.ensureUpToDate();

    if (!group) b = item.desktopPreferredBounds();

    if (b && (!focus || item !== focus)) {
      const sp = new Point(sx0 * b.left() + sx1 * b.right(), sy0 * b.top() + sy1 * b.bottom());
      const mp_rel = mp.sub(sp);
      if (Math.max(Math.abs(mp_rel.x), Math.abs(mp_rel.y)) > 1e-9) {
        item.move_rel(Translate(mp_rel));
        changed = true;
      }
    }
  }

  if (changed) DocumentUndo.done(document, C_('Undo', 'Align'), 'dialog-align-and-distribute');
}

/** An item with its bounds and the anchor to sort by (upstream BBoxSort). */
interface BBoxSort {
  item: SPItem;
  bbox: Rect;
  anchor: number;
}

/**
 * app.object-distribute: distribute the items of selection. value is one of
 * hgap, left, hcenter, right, vgap, top, vcenter, bottom. The gap modes make
 * equal gaps between the bounding boxes, the others equal distances between
 * the edges or centers. One undo step "Distribute" if anything moved.
 * TODO: clone compensation (/options/clonecompensation/value) during the moves.
 */
export function object_distribute(selection: ObjectSet, value: string): void {
  const document = selection.document();
  if (!document || selection.items().length < 2) return;

  let a = 0;
  let b = 0;
  let gap = false;
  let orientation: 'x' | 'y' = 'x';
  if (value === 'hgap') [gap, orientation, a, b] = [true, 'x', 0.5, 0.5];
  else if (value === 'left') [gap, orientation, a, b] = [false, 'x', 1, 0];
  else if (value === 'hcenter') [gap, orientation, a, b] = [false, 'x', 0.5, 0.5];
  else if (value === 'right') [gap, orientation, a, b] = [false, 'x', 0, 1];
  else if (value === 'vgap') [gap, orientation, a, b] = [true, 'y', 0.5, 0.5];
  else if (value === 'top') [gap, orientation, a, b] = [false, 'y', 1, 0];
  else if (value === 'vcenter') [gap, orientation, a, b] = [false, 'y', 0.5, 0.5];
  else if (value === 'bottom') [gap, orientation, a, b] = [false, 'y', 0, 1];

  const prefs_bbox = Preferences.get().getInt('/tools/bounding_box', 0) !== 0;
  const min = (r: Rect) => (orientation === 'x' ? r.left() : r.top());
  const max = (r: Rect) => (orientation === 'x' ? r.right() : r.bottom());

  // Make a list of objects, sorted by anchors.
  const sorted: BBoxSort[] = [];
  for (const item of selection.items()) {
    const bbox = !prefs_bbox ? item.desktopVisualBounds() : item.desktopGeometricBounds();
    if (bbox) sorted.push({ item, bbox, anchor: a * min(bbox) + b * max(bbox) });
  }
  // Array.prototype.sort is stable.
  sorted.sort((x, y) => x.anchor - y.anchor);
  const front = sorted[0];
  const back = sorted.at(-1);
  if (!front || !back || sorted.length < 2) return;

  const translate = (item: SPItem, d: number) =>
    item.move_rel(orientation === 'x' ? Translate(d, 0) : Translate(0, d));

  let changed = false;
  if (gap) {
    // Evenly spaced.

    // Overall bboxes span.
    const dist = max(back.bbox) - min(front.bbox);

    // Space eaten by bboxes.
    let span = 0;
    for (const s of sorted) span += max(s.bbox) - min(s.bbox);

    // New distance between each bbox.
    const step = (dist - span) / (sorted.length - 1);
    let pos = min(front.bbox);
    for (const s of sorted) {
      // Don't move if we are really close.
      if (!are_near(pos, min(s.bbox), 1e-6)) {
        translate(s.item, pos - min(s.bbox));
        changed = true;
      }
      pos += max(s.bbox) - min(s.bbox);
      pos += step;
    }
  } else {
    // Overall anchor span.
    const dist = back.anchor - front.anchor;

    // Distance between anchors.
    const step = dist / (sorted.length - 1);

    sorted.forEach((it, i) => {
      // New anchor position.
      const pos = front.anchor + i * step;
      // Don't move if we are really close.
      if (!are_near(pos, it.anchor, 1e-6)) {
        translate(it.item, pos - it.anchor);
        changed = true;
      }
    });
  }

  if (changed) DocumentUndo.done(document, C_('Undo', 'Distribute'), 'dialog-align-and-distribute');
}

/**
 * The actions of this file by name, without the "app." prefix, for detailed
 * action names like app.object-align('left pref').
 */
export const object_align_actions: Readonly<Record<string, (selection: ObjectSet, value: string) => void>> = {
  'object-align': object_align,
  'object-distribute': object_distribute,
};
