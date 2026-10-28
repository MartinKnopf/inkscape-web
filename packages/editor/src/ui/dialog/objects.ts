// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/objects.cpp, src/ui/dialog/objects.h, src/ui/util.cpp
/*
 * Authors:
 *   Martin Owens
 *   Tavmjong Bah
 *
 * Copyright (C) 2020 Martin Owens
 */
import { C_, DocumentUndo, SPGroup, SPItem, type SPObject } from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';

/** A visible row of the layers and objects tree. */
export interface ObjectRow {
  item: SPItem;
  depth: number;
  label: string;
  isLayer: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  hidden: boolean;
  locked: boolean;
}

/**
 * The label of an object in the dialog (upstream objects.cpp updateRowInfo
 * with get_synthetic_object_name): inkscape:label, else the type name and id.
 */
export function objectLabel(object: SPObject): string {
  const label = object.label();
  if (label) return label;
  const id = object.getId();
  if (object instanceof SPItem) return id ? `${object.displayName()} ${id}` : object.displayName();
  return id ? `#${id}` : `<${object.getRepr().name()}>`;
}

/** The child items of a group that the dialog lists (no defs, no namedview). */
function childItems(object: SPObject): SPItem[] {
  return object.children.filter((c): c is SPItem => c instanceof SPItem);
}

/**
 * The rows of the dialog: the items below the root, topmost first (z-order
 * reversed, as upstream). Items in collapsed groups are not listed.
 */
export function objectRows(desktop: SPDesktop, collapsed: ReadonlySet<SPItem>): ObjectRow[] {
  const rows: ObjectRow[] = [];
  const lm = desktop.layerManager();
  const walk = (parent: SPObject, depth: number) => {
    for (const item of childItems(parent).reverse()) {
      const isGroup = item instanceof SPGroup;
      const kids = isGroup ? childItems(item) : [];
      const isCollapsed = kids.length > 0 && collapsed.has(item);
      rows.push({
        item,
        depth,
        label: objectLabel(item),
        isLayer: lm.isLayer(item),
        hasChildren: kids.length > 0,
        collapsed: isCollapsed,
        hidden: item.isHidden(),
        locked: !item.sensitive,
      });
      if (kids.length > 0 && !isCollapsed) walk(item, depth + 1);
    }
  };
  walk(desktop.doc.getRoot(), 0);
  return rows;
}

/** The items to act on when the toggle of item is clicked: the whole selection if item is in it (and ctrl is not held). */
function toggleTargets(desktop: SPDesktop, item: SPItem, ctrl: boolean): SPItem[] {
  const selection = desktop.getSelection();
  return ctrl || !selection.includes(item) ? [item] : selection.items();
}

/**
 * Toggle the visibility of item (upstream ObjectsPanel::toggleVisible). The
 * undo steps of repeated toggles merge. TODO: shift+click on a layer hides the other layers.
 */
export function toggleVisible(desktop: SPDesktop, item: SPItem, ctrl = false): void {
  const hide = !item.isHidden();
  for (const target of toggleTargets(desktop, item, ctrl)) target.setHidden(hide);
  DocumentUndo.maybeDone(
    desktop.doc,
    'toggle-vis',
    C_('Undo', 'Toggle item visibility'),
    'dialog-object-properties',
  );
}

/** Toggle the lock of item (upstream ObjectsPanel::toggleLocked). */
export function toggleLocked(desktop: SPDesktop, item: SPItem, ctrl = false): void {
  const lock = item.sensitive;
  for (const target of toggleTargets(desktop, item, ctrl)) target.setLocked(lock);
  DocumentUndo.maybeDone(desktop.doc, 'toggle-lock', C_('Undo', 'Toggle item locking'), '');
}

/**
 * Handle a click on the name of a row: a layer becomes the current layer; any
 * other item is selected (with ctrl or shift, added to or removed from the selection).
 */
export function selectRow(desktop: SPDesktop, item: SPItem, additive: boolean): void {
  const selection = desktop.getSelection();
  if (desktop.layerManager().isLayer(item)) {
    desktop.layerManager().setCurrentLayer(item, true);
  } else if (additive) {
    selection.toggle(item);
  } else {
    selection.set(item);
  }
}
