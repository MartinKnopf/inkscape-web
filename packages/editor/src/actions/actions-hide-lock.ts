// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-hide-lock.cpp, src/actions/actions-hide-lock.h
/*
 * Actions related to hide and lock
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *   Tavmjong Bah
 *
 * Copyright (C) 2021-2022 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { C_, DocumentUndo, N_, NC_, SPItem } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';

const SECTION = NC_('Action Section', 'Hide and Lock');

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_hide_lock: readonly (readonly [string, string, string, string])[] = [
  ['app.unhide-all', N_('Unhide All'), SECTION, N_('Unhide all objects')],
  ['app.unlock-all', N_('Unlock All'), SECTION, N_('Unlock all objects')],
  ['app.selection-hide', N_('Hide selection'), SECTION, N_('Hide all selected objects')],
  ['app.selection-unhide', N_('Unhide selection'), SECTION, N_('Unhide all selected objects')],
  [
    'app.selection-unhide-below',
    N_('Unhide descendents'),
    SECTION,
    N_('Unhide all items inside selected objects'),
  ],
  ['app.selection-lock', N_('Lock selection'), SECTION, N_('Lock all selected objects')],
  ['app.selection-unlock', N_('Unlock selection'), SECTION, N_('Unlock all selected objects')],
  [
    'app.selection-unlock-below',
    N_('Unlock descendents'),
    SECTION,
    N_('Unlock all items inside selected objects'),
  ],
];

/** Apply f to the item and all its descendants; true if f changed any. */
function hide_lock_recurse(
  f: (item: SPItem, value: boolean) => boolean,
  item: SPItem,
  value: boolean,
): boolean {
  let changed = f(item, value);
  for (const child of item.children) {
    if (child instanceof SPItem && hide_lock_recurse(f, child, value)) changed = true;
  }
  return changed;
}

/** Hide/unhide one item. */
export function hide_lock_hide(item: SPItem, hide: boolean): boolean {
  if (item.isHidden() === hide) return false;
  item.setHidden(hide);
  return true;
}

/** Lock/unlock one item. */
export function hide_lock_lock(item: SPItem, lock: boolean): boolean {
  if (item.isLocked() === lock) return false;
  item.setLocked(lock);
  return true;
}

export function add_actions_hide_lock(app: InkscapeApplication): void {
  const actions = app.actions.app;

  const all = (f: (item: SPItem, value: boolean) => boolean, description: string) => () => {
    const document = app.get_active_document();
    if (document && hide_lock_recurse(f, document.getRoot(), false))
      DocumentUndo.done(document, description, '');
  };
  actions.add_action('unhide-all', all(hide_lock_hide, C_('Undo', 'Unhid all objects in the current layer')));
  actions.add_action(
    'unlock-all',
    all(hide_lock_lock, C_('Undo', 'Unlocked all objects in the current layer')),
  );

  // Hide/unhide, lock/unlock the selected items; the selection is cleared if something changed.
  const selected =
    (f: (item: SPItem, value: boolean) => boolean, value: boolean, description: string) => () => {
      const selection = app.get_active_selection();
      const document = app.get_active_document();
      if (!selection || !document) return;
      let changed = false;
      for (const item of selection.items()) if (f(item, value)) changed = true;
      if (changed) {
        DocumentUndo.done(document, description, '');
        selection.clear();
      }
    };
  actions.add_action('selection-hide', selected(hide_lock_hide, true, C_('Undo', 'Hid selected items.')));
  actions.add_action(
    'selection-unhide',
    selected(hide_lock_hide, false, C_('Undo', 'Unhid selected items.')),
  );
  actions.add_action('selection-lock', selected(hide_lock_lock, true, C_('Undo', 'Locked selected items.')));
  actions.add_action(
    'selection-unlock',
    selected(hide_lock_lock, false, C_('Undo', 'Unlocked selected items.')),
  );

  // Unhide/unlock the selected items and their descendents.
  const below = (f: (item: SPItem, value: boolean) => boolean, description: string) => () => {
    const selection = app.get_active_selection();
    const document = app.get_active_document();
    if (!selection || !document) return;
    let changed = false;
    for (const item of selection.items()) if (hide_lock_recurse(f, item, false)) changed = true;
    if (changed) DocumentUndo.done(document, description, '');
  };
  actions.add_action(
    'selection-unhide-below',
    below(hide_lock_hide, C_('Undo', 'Unhid selected items and their descendents.')),
  );
  actions.add_action(
    'selection-unlock-below',
    below(hide_lock_lock, C_('Undo', 'Unlocked selected items and their descendents.')),
  );
  app.get_action_extra_data().add_data(raw_data_hide_lock);
}
