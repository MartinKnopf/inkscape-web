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
import {
  C_,
  CompareSize,
  DocumentUndo,
  N_,
  NC_,
  ObjectSet,
  Preferences,
  removeoverlap,
  SPCloneCompensation,
  SPFlowtext,
  type SPItem,
  SPText,
  sp_repr_compare_position,
  te_get_layout,
  unclump,
} from '@inkscape-web/core';
import { are_near, type OptRect, Point, type Rect, Translate } from '@inkscape-web/geom';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { show_output } from './actions-helper.ts';
import type { ActionHintRawData } from './actions-hint-data.ts';

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

/* --------------- Rearrange ----------------- */

type SortOrder = 'selection' | 'z-order' | 'rotate';

/** Move each item to the place of the next one, the last to the place of the first (upstream exchange). */
function exchange(selection: ObjectSet, order: SortOrder): void {
  const items = selection.items();
  // Reorder items.
  if (order === 'z-order') {
    items.sort((a, b) => sp_repr_compare_position(a.getRepr(), b.getRepr()));
  } else if (order === 'rotate') {
    const center = selection.center();
    if (center) {
      const angle = (item: SPItem) =>
        Math.atan2(item.getCenter().y - center.y, item.getCenter().x - center.x);
      items.sort(
        (a, b) =>
          angle(a) - angle(b) ||
          Math.hypot(a.getCenter().x - center.x, a.getCenter().y - center.y) -
            Math.hypot(b.getCenter().x - center.x, b.getCenter().y - center.y),
      );
    }
  }
  // Move items.
  let p1 = (items.at(-1) as SPItem).getCenter();
  for (const item of items) {
    const p2 = item.getCenter();
    item.move_rel(Translate(p1.sub(p2)));
    p1 = p2;
  }
}

/**
 * Give the centers of the items random places in the box of their centers (upstream randomize). The
 * box keeps its size, so repeated randomizing causes no growth, shrinking or drift.
 */
function randomize(selection: ObjectSet): void {
  const items = selection.items();
  // Do 'x' and 'y' independently.
  for (const axis of ['x', 'y'] as const) {
    // First, find maximum and minimum centers.
    const centers = items.map((item) => item.getCenter()[axis]);
    const min = Math.min(...centers);
    const max = Math.max(...centers);
    // Second, assign minimum/maximum values to two different items randomly.
    const imin = Math.floor(Math.random() * items.length);
    let imax = Math.floor(Math.random() * items.length);
    while (imin === imax) imax = Math.floor(Math.random() * items.length);
    // Third, find new positions of item centers.
    items.forEach((item, index) => {
      const z = index === imin ? min : index === imax ? max : min + Math.random() * (max - min);
      const delta = z - item.getCenter()[axis];
      item.move_rel(axis === 'x' ? Translate(delta, 0) : Translate(0, delta));
    });
  }
}

/** Run with the clone compensation set to unmoved, so that clones stay in place with their originals. */
function with_unmoved_clones(run: () => void): void {
  const prefs = Preferences.get();
  const saved_compensation = prefs.getInt(
    '/options/clonecompensation/value',
    SPCloneCompensation.SP_CLONE_COMPENSATION_UNMOVED,
  );
  prefs.setInt('/options/clonecompensation/value', SPCloneCompensation.SP_CLONE_COMPENSATION_UNMOVED);
  try {
    run();
  } finally {
    prefs.setInt('/options/clonecompensation/value', saved_compensation);
  }
}

/**
 * app.object-rearrange: exchange, exchangez, rotate, randomize or unclump. TODO: graph (a graph
 * layout with libcola).
 */
function object_rearrange(selection: ObjectSet, token: string): void {
  const document = selection.document();
  const items = selection.items();
  if (!document || items.length < 2) return;
  with_unmoved_clones(() => {
    if (token === 'exchange') exchange(selection, 'selection');
    else if (token === 'exchangez') exchange(selection, 'z-order');
    else if (token === 'rotate') exchange(selection, 'rotate');
    else if (token === 'randomize') randomize(selection);
    else if (token === 'unclump') unclump(items);
    else show_output(`object_rearrange: unhandled argument: ${token}`);
  });
  DocumentUndo.done(document, C_('Undo', 'Rearrange'), 'dialog-align-and-distribute');
}

/** app.object-remove-overlaps: the value is the horizontal and the vertical gap, "h,v". */
function object_remove_overlaps(selection: ObjectSet, value: string): void {
  const document = selection.document();
  const items = selection.items();
  if (!document || items.length < 2) return;
  const [hgap, vgap] = value.split(',').map(Number);
  if (hgap === undefined || vgap === undefined || Number.isNaN(hgap) || Number.isNaN(vgap)) {
    show_output(`object_remove_overlaps: wrong value: ${value} (should be 'h,v')`);
    return;
  }
  with_unmoved_clones(() => removeoverlap(items, hgap, vgap));
  DocumentUndo.done(document, C_('Undo', 'Remove overlaps'), 'dialog-align-and-distribute');
}

/** The anchor of the first baseline of a text or flowed text in desktop coordinates, or null. */
function text_baseline(item: SPItem): Point | null {
  if (!(item instanceof SPText || item instanceof SPFlowtext)) return null;
  const pt = te_get_layout(item)?.baselineAnchorPoint();
  return pt ? pt.transformed(item.i2dtAffine()) : null;
}

/**
 * app.object-distribute-text: distribute the baseline anchors of the selected
 * texts evenly, horizontally (default) or "vertical". One undo step "Distribute".
 */
export function object_distribute_text(selection: ObjectSet, value: string): void {
  const orientation = value.includes('vertical') ? 'y' : 'x';
  const document = selection.document();
  if (!document || selection.size() < 2) return;

  const baselines: { item: SPItem; base: Point }[] = [];
  let b_min = Infinity;
  let b_max = -Infinity;
  for (const item of selection.items()) {
    const base = text_baseline(item);
    if (!base) continue;
    b_min = Math.min(b_min, base[orientation]);
    b_max = Math.max(b_max, base[orientation]);
    baselines.push({ item, base });
  }
  if (baselines.length < 2) return;

  // Array.prototype.sort is stable.
  baselines.sort((a, b) => a.base[orientation] - b.base[orientation]);
  const step = (b_max - b_min) / (baselines.length - 1);
  baselines.forEach((baseline, i) => {
    const t = b_min + step * i - baseline.base[orientation];
    baseline.item.move_rel(orientation === 'x' ? Translate(t, 0) : Translate(0, t));
  });

  DocumentUndo.done(document, C_('Undo', 'Distribute'), 'dialog-align-and-distribute');
}

/**
 * app.object-align-text: align the baseline anchors of the selected texts.
 * value: [vertical | horizontal] [last|first|biggest|smallest|page|drawing|selection|pref]?
 * Horizontal (default) moves along x. The reference is the baseline anchor of
 * a text target, the minimum corner of the bounds of other targets.
 */
export function object_align_text(selection: ObjectSet, value: string): void {
  const tokens = value.split(' ');

  // Defaults
  let target = ObjectAlignTarget.SELECTION;
  let orientation: 'x' | 'y' = 'x';
  let direction = CompareSize.HORIZONTAL;

  // Preference request allows alignment action to remember for key-presses
  if (tokens.includes('pref')) {
    tokens.push(Preferences.get().getString('/dialogs/align/objects-align-to', 'selection'));
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

    // Direction
    if (token === 'vertical') {
      orientation = 'y';
      direction = CompareSize.VERTICAL;
    }
  }

  const selected = selection.items();
  const document = selection.document();
  if (selected.length === 0 || !document) return;

  // Find alignment rectangle. This can come from:
  // - The bounding box of an object
  // - The bounding box of a group of objects
  // - The bounding box of the page, drawing, or selection.
  let focus: SPItem | null = null;
  let b: OptRect = null;
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

  const ref_point = focus
    ? (text_baseline(focus) ?? focus.desktopPreferredBounds()?.min() ?? null)
    : (b?.min() ?? null);
  if (!ref_point) return;

  for (const item of selected) {
    const base = text_baseline(item);
    if (!base) continue;
    const t = ref_point[orientation] - base[orientation];
    item.move_rel(orientation === 'x' ? Translate(t, 0) : Translate(0, t));
  }

  DocumentUndo.done(document, C_('Undo', 'Align'), 'dialog-align-and-distribute');
}

/**
 * The actions of this file by name, without the "app." prefix, for detailed
 * action names like app.object-align('left pref').
 */
export const object_align_actions: Readonly<Record<string, (selection: ObjectSet, value: string) => void>> = {
  'object-align': object_align,
  'object-distribute': object_distribute,
  'object-rearrange': object_rearrange,
  'object-remove-overlaps': object_remove_overlaps,
  'object-align-text': object_align_text,
  'object-distribute-text': object_distribute_text,
};

const SECTION = NC_('Action Section', 'Object');

/** Action id, label, section and tooltip of the align actions (untranslated). */
export const raw_data_object_align: readonly (readonly [string, string, string, string])[] = [
  [
    'app.object-align-on-canvas',
    N_('Enable on-canvas alignment'),
    SECTION,
    N_('Enable on-canvas alignment handles'),
  ],
  [
    'app.object-align',
    N_('Align objects'),
    SECTION,
    N_(
      'Align selected objects; usage: [[left|hcenter|right] || [top|vcenter|bottom]] [last|first|biggest|smallest|page|drawing|selection|pref]? group? anchor?',
    ),
  ],
  [
    'app.object-distribute',
    N_('Distribute objects'),
    SECTION,
    N_('Distribute selected objects; usage: [hgap | left | hcenter | right | vgap | top | vcenter | bottom]'),
  ],
  [
    'app.object-rearrange',
    N_('Rearrange objects'),
    SECTION,
    N_('Rearrange selected objects; usage: [graph | exchange | exchangez | rotate | randomize | unclump]'),
  ],
  [
    'app.object-remove-overlaps',
    N_('Remove overlaps'),
    SECTION,
    N_(
      'Remove overlaps between objects: requires two comma separated numbers (horizontal and vertical gaps)',
    ),
  ],
  [
    'app.object-align-text',
    N_('Align text objects'),
    SECTION,
    N_(
      'Align selected text anchors; usage: [[vertical | horizontal] [last|first|biggest|smallest|page|drawing|selection]?',
    ),
  ],
  [
    'app.object-distribute-text',
    N_('Distribute text objects'),
    SECTION,
    N_('Distribute text anchors; usage [vertical | horizontal]'),
  ],
  [
    "app.object-distribute-text('horizontal')",
    N_('Distribute text horizontally'),
    SECTION,
    N_('Distribute text anchors horizontally'),
  ],
  [
    "app.object-distribute-text('vertical')",
    N_('Distribute text vertically'),
    SECTION,
    N_('Distribute text anchors vertically'),
  ],
];

/** What to enter for the parameter of an action (shown by the command palette). */
export const hint_data_object_align: ActionHintRawData = [
  [
    'app.object-align',
    N_(
      'Enter anchor<space>alignment<space>optional second alignment. Possible anchors: last, first, biggest, smallest, page, drawing, selection, pref; possible alignments: left, hcenter, right, top, vcenter, bottom.',
    ),
  ],
  [
    'app.object-distribute',
    N_('Enter distribution type. Possible values: left, hcenter, right, top, vcenter, bottom, hgap, vgap.'),
  ],
  [
    'app.object-rearrange',
    N_('Enter arrange method. Possible values: graph, exchange, exchangez, rotate, randomize, unclump.'),
  ],
  ['app.object-remove-overlaps', N_('Enter two comma-separated numbers: horizontal,vertical')],
];

/** Register app.object-align, app.object-distribute and their text variants (string parameter). */
export function add_actions_object_align(app: InkscapeApplication): void {
  for (const [name, run] of Object.entries(object_align_actions)) {
    app.actions.app.add_action_with_parameter(name, 's', (value) => {
      const selection = app.get_active_selection();
      if (selection) run(selection, value);
    });
  }
  // Toggle the on-canvas alignment handles of the selector tool (the click on the selection shows them).
  const on_canvas = app.actions.app.add_action_bool(
    'object-align-on-canvas',
    () => {
      const state = !(on_canvas.get_state() ?? false);
      on_canvas.change_state(state);
      Preferences.get().setBool('/dialogs/align/oncanvas', state);
    },
    Preferences.get().getBool('/dialogs/align/oncanvas'),
  );
  app.get_action_extra_data().add_data(raw_data_object_align);
  app.get_action_hint_data().add_data(hint_data_object_align);
}
