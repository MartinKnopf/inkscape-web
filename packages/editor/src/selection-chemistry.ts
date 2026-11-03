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
import {
  C_,
  DocumentUndo,
  type ObjectSet,
  Preferences,
  SP_STYLE_FLAG_IFSET,
  type SPCSSAttr,
  type SPDocument,
  SPGroup,
  SPItem,
  type SPObject,
  spCssAttrScale,
  spCssAttrUnsetBlacklist,
  spCssAttrUnsetText,
  spReprCssAttrAddFromString,
  spReprCssAttrNew,
  spReprCssMerge,
  spReprCssUnsetProperty,
} from '@inkscape-web/core';
import { get_active_tool, set_active_tool } from './actions/actions-tools.ts';
import type { SPDesktop } from './desktop.ts';
import { sp_desktop_apply_css_recursive, sp_desktop_set_style } from './desktop-style.ts';
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

/** The style of object as CSS (upstream sp_css_attr_from_object in style.cpp). */
function sp_css_attr_from_object(object: SPObject, flags: number): SPCSSAttr {
  const css = spReprCssAttrNew();
  spReprCssAttrAddFromString(css, object.style.write(flags));
  return css;
}

/**
 * The complete cascaded style of object, for Paste Style and the style of
 * new objects: without text properties (TODO: except for text objects) and
 * the properties that should not be used in a default style, with the stroke
 * width and similar values scaled to document units.
 */
export function take_style_from_item(object: SPObject): SPCSSAttr {
  // write the complete cascaded style, context-free
  let css = sp_css_attr_from_object(object, SP_STYLE_FLAG_IFSET);

  if (object instanceof SPGroup && object.firstChild()) {
    // If this is a group, merge the style of its topmost (last) child with style
    // TODO: a text with exactly one tspan child.
    for (const element of [...object.children].reverse()) {
      spReprCssMerge(css, sp_css_attr_from_object(element, SP_STYLE_FLAG_IFSET));
      break;
    }
  }

  // Remove black-listed properties (those that should not be used in a default style)
  css = spCssAttrUnsetBlacklist(css);

  // do not copy text properties from non-text objects, it's confusing
  css = spCssAttrUnsetText(css);

  if (object instanceof SPItem) {
    // FIXME: also transform gradient/pattern fills, by forking? NO, this must be nondestructive
    const ex = object.i2docAffine().descrim();
    if (ex !== 1.0) css = spCssAttrScale(css, ex);
  }
  return css;
}

/**
 * Resize the document to the visual bounds of the drawing (upstream fit_canvas_to_drawing).
 * Returns false for an empty drawing. Like upstream, this ignores the pages.
 */
export function fit_canvas_to_drawing(doc: SPDocument, with_margins = false): boolean {
  doc.ensureUpToDate();
  const bbox = doc.getRoot().documentVisualBounds();
  if (!bbox) return false;
  doc.fitToRect(bbox, with_margins);
  return true;
}

/**
 * Remove the filters of the selected items (upstream ObjectSet::removeFilter), in the undo
 * step "Remove filter". Returns false if nothing is selected.
 * TODO: flash "Select <b>object(s)</b> to remove filters from." when nothing is selected.
 */
export function removeFilter(set: ObjectSet, desktop: SPDesktop | null): boolean {
  // check if something is selected
  if (set.isEmpty()) return false;

  const css = spReprCssAttrNew();
  spReprCssUnsetProperty(css, 'filter');
  if (desktop) {
    sp_desktop_set_style(desktop, css, true, true, false, set);
    // Refreshing the current tool (by switching to same tool)
    // will refresh tool's private information in it's selection context that
    // depends on desktop items.
    set_active_tool(desktop, get_active_tool(desktop));
  } else {
    for (const item of set.items()) sp_desktop_apply_css_recursive(item, css, true);
  }
  const document = set.document();
  if (document) DocumentUndo.done(document, C_('Undo', 'Remove filter'), '');
  return true;
}
