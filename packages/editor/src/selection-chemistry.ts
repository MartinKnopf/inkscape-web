// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/selection-chemistry.cpp, src/selection-chemistry.h
/*
 * Miscellaneous operations on selected items: the parts that need a desktop
 * (the ObjectSet operations are in @inkscape-web/core object-set.ts).
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Frank Felfe <innerspace@iname.com>
 *   MenTaLguY <mental@rydia.net>
 *   bulia byak <buliabyak@users.sf.net>
 *   Andrius R. <knutux@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Martin Sucha <martin.sucha-inkscape@jts-sro.sk>
 *   Abhishek Sharma
 *   Kris De Gussem <Kris.DeGussem@gmail.com>
 *   Tavmjong Bah <tavmjong@free.fr> (Symbol additions)
 *   Adrian Boguszewski
 *   Marc Jeanmougin
 *
 * Copyright (C) 1999-2016 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { Preferences, SPItem, type SPObject } from '@inkscape-web/core';
import { set_active_tool } from './actions/actions-tools.ts';
import type { SPDesktop } from './desktop.ts';
import { NodeTool } from './ui/tools/node-tool.ts';

/** Values of /options/kbselection/inlayer. */
export enum PrefsSelectionContext {
  PREFS_SELECTION_ALL = 0,
  PREFS_SELECTION_LAYER = 1,
  PREFS_SELECTION_LAYER_RECURSIVE = 2,
}

/** The selection operations of the Edit menu, which act on nodes when the node tool is active. */
export const SelectionHelper = {
  selectAll(dt: SPDesktop): void {
    const nt = dt.getTool();
    if (nt instanceof NodeTool && !nt._multipath.empty()) {
      nt._multipath.selectSubpaths();
      return;
    }
    sp_edit_select_all(dt);
  },

  selectAllInAll(dt: SPDesktop): void {
    const nt = dt.getTool();
    if (nt instanceof NodeTool) nt._selected_nodes.selectAll();
    else sp_edit_select_all_in_all_layers(dt);
  },

  selectNone(dt: SPDesktop): void {
    const nt = dt.getTool();
    if (nt instanceof NodeTool && !nt._selected_nodes.empty()) {
      nt._selected_nodes.clear();
    } else if (!dt.getSelection().isEmpty()) {
      dt.getSelection().clear();
    } else {
      // If nothing selected switch to selection tool
      set_active_tool(dt, 'Select');
    }
  },

  invert(dt: SPDesktop): void {
    const nt = dt.getTool();
    if (nt instanceof NodeTool) nt._multipath.invertSelectionInSubpaths();
    else sp_edit_invert(dt);
  },

  invertAllInAll(dt: SPDesktop): void {
    const nt = dt.getTool();
    if (nt instanceof NodeTool) nt._selected_nodes.invertSelection();
    else sp_edit_invert_in_all_layers(dt);
  },
};

/** Whether item is hidden in dt. TODO: per display key (upstream SPDesktop::itemIsHidden). */
function itemIsHidden(_dt: SPDesktop, item: SPItem): boolean {
  return item.isHidden();
}

function get_all_items_recursive(
  list: SPItem[],
  from: SPObject,
  desktop: SPDesktop,
  onlyvisible: boolean,
  onlysensitive: boolean,
  ingroups: boolean,
  exclude: readonly SPItem[],
): void {
  const layers = desktop.layerManager();
  for (const child of from.children) {
    const item = child instanceof SPItem ? child : null;
    if (
      item &&
      !layers.isLayer(item) &&
      (!onlysensitive || !item.isLocked()) &&
      (!onlyvisible || !itemIsHidden(desktop, item)) &&
      !exclude.includes(item)
    ) {
      list.push(item);
    }
    if (ingroups || (item && layers.isLayer(item))) {
      get_all_items_recursive(list, child, desktop, onlyvisible, onlysensitive, ingroups, exclude);
    }
  }
}

/**
 * The items below from (into layers, and into groups with ingroups), topmost
 * first, without exclude.
 */
export function get_all_items(
  from: SPObject,
  desktop: SPDesktop,
  onlyvisible: boolean,
  onlysensitive: boolean,
  ingroups: boolean,
  exclude: readonly SPItem[] = [],
): SPItem[] {
  const list: SPItem[] = [];
  get_all_items_recursive(list, from, desktop, onlyvisible, onlysensitive, ingroups, exclude);
  return list.reverse(); // Todo: For compatibility; is it necessary?
}

function sp_edit_select_all_full(dt: SPDesktop, force_all_layers: boolean, invert: boolean): void {
  const selection = dt.getSelection();
  const layers = dt.layerManager();
  const layer = layers.currentLayer();
  if (!layer) return;

  const prefs = Preferences.get();
  let inlayer: PrefsSelectionContext = prefs.getInt(
    '/options/kbselection/inlayer',
    PrefsSelectionContext.PREFS_SELECTION_LAYER,
  );
  const onlyvisible = prefs.getBool('/options/kbselection/onlyvisible', true);
  const onlysensitive = prefs.getBool('/options/kbselection/onlysensitive', true);

  const exclude = invert ? selection.items() : [];
  if (force_all_layers) inlayer = PrefsSelectionContext.PREFS_SELECTION_ALL;

  let items: SPItem[] = [];
  switch (inlayer) {
    case PrefsSelectionContext.PREFS_SELECTION_LAYER: {
      if ((onlysensitive && layer.isLocked()) || (onlyvisible && itemIsHidden(dt, layer))) return;
      for (const item of layer.item_list().reverse()) {
        if (
          (!onlysensitive || !item.isLocked()) &&
          (!onlyvisible || !itemIsHidden(dt, item)) &&
          !layers.isLayer(item) &&
          (!invert || !exclude.includes(item))
        ) {
          items.push(item); // leave it in the list
        }
      }
      break;
    }
    case PrefsSelectionContext.PREFS_SELECTION_LAYER_RECURSIVE:
      items = get_all_items(layer, dt, onlyvisible, onlysensitive, false, exclude);
      break;
    default: {
      const root = layers.currentRoot();
      if (root) items = get_all_items(root, dt, onlyvisible, onlysensitive, false, exclude);
      break;
    }
  }
  selection.setList(items);
}

export function sp_edit_select_all(desktop: SPDesktop): void {
  sp_edit_select_all_full(desktop, false, false);
}

export function sp_edit_select_all_in_all_layers(desktop: SPDesktop): void {
  sp_edit_select_all_full(desktop, true, false);
}

export function sp_edit_invert(desktop: SPDesktop): void {
  sp_edit_select_all_full(desktop, false, true);
}

export function sp_edit_invert_in_all_layers(desktop: SPDesktop): void {
  sp_edit_select_all_full(desktop, true, true);
}
