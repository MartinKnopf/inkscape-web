// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/contextmenu.cpp, src/ui/contextmenu.h
/*
 * Context menu
 *
 * Authors:
 *   Tavmjong Bah
 *
 * Rewrite of code authored by:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Frank Felfe <innerspace@iname.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Kris De Gussem <Kris.DeGussem@gmail.com>
 *
 * Copyright (C) 2022 Tavmjong Bah
 * Copyright (C) 2012 Kris De Gussem
 * Copyright (C) 2010 authors
 * Copyright (C) 1999-2005 authors
 * Copyright (C) 2004 David Turner
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import {
  _,
  C_,
  DocumentUndo,
  type Selection,
  SPAnchor,
  type SPDocument,
  SPGroup,
  SPImage,
  SPItem,
  type SPObject,
  SPPage,
  SPShape,
  SPText,
  SPUse,
} from '@inkscape-web/core';
import type { Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../desktop.ts';
import type { MenuEntry } from './desktop/menubar.ts';

/**
 * The menu of a ContextMenu: sections of MenuEntry items, as the menu bar. Items with a "ctx."
 * action run the matching function of `ctx` (upstream: the "ctx" action group of the menu).
 */
export interface ContextMenuModel {
  entries: MenuEntry[];
  ctx: Map<string, () => void>;
}

type Presenter = (menu: ContextMenuModel, position: Point) => void;
let presenter: Presenter | null = null;

/** Set the function that shows a context menu at a position in the browser viewport (client coordinates); returns a function that removes it. */
export function setContextMenuPresenter(show: Presenter | null): () => void {
  presenter = show;
  return () => {
    if (presenter === show) presenter = null;
  };
}

/** Show menu at position (upstream UI::popup_at()). */
export function popup_context_menu(menu: ContextMenuModel, position: Point): void {
  presenter?.(menu, position);
}

/** An item of the action (upstream AppendItemFromAction()). */
const action_item = (action: string, label: string, icon: string | null = null): MenuEntry => ({
  kind: 'item',
  label,
  action,
  icon,
});
const section = (...children: MenuEntry[]): MenuEntry => ({ kind: 'section', id: null, children });
const submenu = (label: string, ...children: MenuEntry[]): MenuEntry => ({
  kind: 'submenu',
  id: null,
  label,
  children,
});

/**
 * Create a menu section containing the standard editing actions:
 * Cut, Copy, Paste, Paste... (in place, on page, style, size, width, height, size separately,
 * width separately, height separately). With paste_only, only the Paste action is included.
 */
function create_clipboard_actions(paste_only = false): MenuEntry {
  const result: MenuEntry[] = [];
  if (!paste_only) {
    result.push(action_item('app.cut', _('Cu_t'), 'edit-cut'));
    result.push(action_item('app.copy', _('_Copy'), 'edit-copy'));
  }
  result.push(action_item('win.paste', _('_Paste'), 'edit-paste'));

  // Also appending special paste options
  // (in place, paste on page, paste style, paste size, paste width, paste height, paste size separately,
  // paste width separately, paste height separately), to increase discoverability.
  result.push(
    section(
      submenu(
        _('Paste Options'),
        action_item('win.paste-in-place', _('Paste _in Place'), 'edit-paste-in-place'),
        action_item('win.paste-on-page', _('Paste _on Page')),
        action_item('app.paste-style', _('Paste _Style'), 'edit-paste-style'),
        action_item('app.paste-size', _('Paste Si_ze Onto Selection'), 'edit-paste-size'),
        action_item('app.paste-width', _('Paste _Width Onto Selection'), 'edit-paste-width'),
        action_item('app.paste-height', _('Paste _Height Onto Selection'), 'edit-paste-height'),
        action_item(
          'app.paste-size-separately',
          _('Paste Size Onto Selection Separately'),
          'edit-paste-size-separately',
        ),
        action_item(
          'app.paste-width-separately',
          _('Paste Width Onto Selection Separately'),
          'edit-paste-width-separately',
        ),
        action_item(
          'app.paste-height-separately',
          _('Paste Height Onto Selection Separately'),
          'edit-paste-height-separately',
        ),
      ),
    ),
  );
  return section(...result);
}

/** Check if the item is a clone of an image. */
function is_clone_of_image(item: SPItem): boolean {
  return item instanceof SPUse && item.trueOriginal() instanceof SPImage;
}

function childrenIncludedInSelection(item: SPItem, selection: Selection): boolean {
  return item.children.some(
    (child) =>
      child instanceof SPItem && (selection.includes(child) || childrenIncludedInSelection(child, selection)),
  );
}

/** The label of an object: its inkscape:label, else "#id", else "<element name>" (upstream SPObject::defaultLabel()). */
function defaultLabel(object: SPObject): string {
  const id = object.getId();
  return object.label() ?? (id ? `#${id}` : `<${object.getRepr().name()}>`);
}

/** The group if object is a layer, else null (upstream LayerManager::asLayer()). */
function asLayer(object: SPObject | null): SPGroup | null {
  return object instanceof SPGroup && object.isLayer() ? object : null;
}

/** Unhide or unlock the items (upstream ContextMenu::unhide_or_unlock()). */
function unhide_or_unlock(
  document: SPDocument,
  items_under_cursor: readonly SPItem[],
  unhide: boolean,
): void {
  for (const item of items_under_cursor) {
    if (unhide) {
      if (item.isHidden()) item.setHidden(false);
    } else if (item.isLocked()) {
      item.setLocked(false, true);
    }
  }
  // We wouldn't be here if we didn't make a change.
  DocumentUndo.done(document, unhide ? C_('Undo', 'Unhid objects') : C_('Undo', 'Unlocked objects'), '');
}

/**
 * Build the Inkscape context menu for object (the object that was right-clicked) and the items
 * under the cursor (upstream ContextMenu::ContextMenu()). Like upstream, this selects the page, or
 * selects object if it is not selected. hide_layers_and_objects_menu_item hides "Layers and
 * Objects..." when the menu opens in that dialog.
 */
export function ContextMenu(
  desktop: SPDesktop,
  object: SPObject | null,
  items_under_cursor: readonly SPItem[],
  hide_layers_and_objects_menu_item = false,
): ContextMenuModel {
  const item = object instanceof SPItem ? object : null;

  const document = desktop.getDocument();
  const ctx = new Map<string, () => void>([
    ['ctx.unhide-objects-below-cursor', () => unhide_or_unlock(document, items_under_cursor, true)],
    ['ctx.unlock-objects-below-cursor', () => unhide_or_unlock(document, items_under_cursor, false)],
  ]);

  const gmenu: MenuEntry[] = []; // Main menu

  const layer = asLayer(item); // Layers have their own context menu in the Object and Layers dialog.
  const root = desktop.layerManager().currentRoot();

  const has_hidden_below_cursor = items_under_cursor.some((i) => i.isHidden());
  const has_locked_below_cursor = items_under_cursor.some((i) => i.isLocked());

  if (object instanceof SPPage) {
    const page_manager = document.getPageManager();
    page_manager.selectPage(object);

    gmenu.push(
      section(
        action_item('doc.page-new', _('_New Page'), 'pages-add'),
        action_item('doc.page-duplicate', _('Duplicate Page'), 'pages-duplicate'),
      ),
      section(
        action_item('doc.page-delete', _('_Delete Page'), 'pages-remove'),
        action_item('doc.page-move-backward', _('Move Page _Backward'), 'pages-order-backwards'),
        action_item('doc.page-move-forward', _('Move Page _Forward'), 'pages-order-forwards'),
      ),
    );
  } else {
    const only_layer = layer && !desktop.getSelection().includes(layer);

    if (!only_layer) {
      // "item" is the object that was under the mouse when right-clicked. It determines what is shown
      // in the menu thus it makes the most sense that it is either selected or part of the current
      // selection.
      const selection = desktop.getSelection();

      // Do not include this object in the selection if any of its
      // children have been selected separately.
      if (object && !selection.includes(object) && item && !childrenIncludedInSelection(item, selection)) {
        selection.set(object);
      }

      if (!item) {
        // Even when there's no item, we should still have the Paste action on top
        // (see https://gitlab.com/inkscape/inkscape/-/issues/4150)
        gmenu.push(create_clipboard_actions(true));
        gmenu.push(
          section(
            action_item(
              "win.dialog-open('DocumentProperties')",
              _('Document Properties...'),
              'document-properties',
            ),
          ),
        );
      } else {
        // When an item is selected, show all three of Cut, Copy and Paste.
        gmenu.push(create_clipboard_actions());

        const edit: MenuEntry[] = [
          action_item('app.duplicate', _('Duplic_ate'), 'edit-duplicate'),
          action_item('app.clone', _('_Clone'), 'edit-clone'),
          action_item('app.delete-selection', _('_Delete'), 'edit-delete'),
        ];
        if (item instanceof SPText && item.has_shape_inside()) {
          edit.push(
            action_item(
              'app.text-unflow-and-keep-shape',
              _('_Unflow and keep shape'),
              'select_text_unflow_and_keep_shape',
            ),
          );
        }
        gmenu.push(section(...edit));

        // Dialogs
        const gmenu_dialogs: MenuEntry[] = [];
        if (!hide_layers_and_objects_menu_item) {
          // Hidden when context menu is popped up in Layers and Objects dialog!
          gmenu_dialogs.push(
            action_item("win.dialog-open('Objects')", _('Layers and Objects...'), 'dialog-objects'),
          );
        }
        gmenu_dialogs.push(
          action_item(
            "win.dialog-open('ObjectProperties')",
            _('_Object Properties...'),
            'dialog-object-properties',
          ),
        );

        if (item instanceof SPShape || item instanceof SPText || item instanceof SPGroup) {
          gmenu_dialogs.push(
            action_item("win.dialog-open('FillStroke')", _('_Fill and Stroke...'), 'dialog-fill-and-stroke'),
          );
        }

        // Image dialogs (mostly).
        if (item instanceof SPImage) {
          gmenu_dialogs.push(action_item("win.dialog-open('Trace')", _('_Trace Bitmap...'), 'bitmap-trace'));

          if (item.getClipObject()) {
            gmenu_dialogs.push(action_item('app.element-image-crop', _('Crop Image to Clip')));
          }
          if (item.href?.startsWith('data')) {
            // Image is embedded.
            gmenu_dialogs.push(action_item('app.org.inkscape.filter.extract-image', _('Extract Image...')));
          } else {
            // Image is linked.
            gmenu_dialogs.push(action_item('app.org.inkscape.filter.selected.embed-image', _('Embed Image')));
            gmenu_dialogs.push(action_item('app.element-image-edit', _('Edit Externally...')));
          }
        }

        // A clone of an image supports "Edit Externally" as well
        if (is_clone_of_image(item)) {
          gmenu_dialogs.push(action_item('app.element-image-edit', _('Edit Externally...')));
        }

        // Text dialogs.
        if (item instanceof SPText) {
          gmenu_dialogs.push(
            action_item("win.dialog-open('Text')", _('_Text and Font...'), 'dialog-text-and-font'),
          );
          gmenu_dialogs.push(
            action_item("win.dialog-open('Spellcheck')", _('Check Spellin_g...'), 'tools-check-spelling'),
          );
        }
        gmenu.push(section(...gmenu_dialogs));

        if (!(item instanceof SPAnchor)) {
          // Item menu

          // Selection
          gmenu.push(
            section(
              submenu(
                _('Select Sa_me'),
                action_item(
                  'win.select-same-fill-and-stroke',
                  _('Fill _and Stroke'),
                  'edit-select-same-fill-and-stroke',
                ),
                action_item('win.select-same-fill', _('_Fill Color'), 'edit-select-same-fill'),
                action_item(
                  'win.select-same-stroke-color',
                  _('_Stroke Color'),
                  'edit-select-same-stroke-color',
                ),
                action_item(
                  'win.select-same-stroke-style',
                  _('Stroke St_yle'),
                  'edit-select-same-stroke-style',
                ),
                action_item('win.select-same-object-type', _('_Object Type'), 'edit-select-same-object-type'),
              ),
            ),
          );

          // Groups and Layers
          const groups: MenuEntry[] = [
            action_item('win.selection-move-to-layer', _('_Move to Layer...')),
            action_item('app.selection-link', _('Create Anchor (Hyperlink)')),
            action_item('app.selection-group', _('_Group')),
          ];
          if (item instanceof SPGroup) {
            groups.push(action_item('app.selection-ungroup', _('_Ungroup')));
            const label = _('Enter Group %1').replace('%1', defaultLabel(item));
            groups.push(action_item('win.selection-group-enter', label));
            const parent = item.parent;
            if (!layer && ((parent instanceof SPGroup && parent.isLayer()) || parent === root)) {
              // A layer should be a child of root or another layer.
              groups.push(action_item('win.layer-from-group', _('Group to Layer')));
            }
          }
          const group = item.parent;
          if (group instanceof SPGroup && !group.isLayer()) {
            groups.push(action_item('win.selection-group-exit', _('Exit Group')));
            groups.push(action_item('app.selection-ungroup-pop', _('_Pop Selection out of Group')));
          }
          gmenu.push(section(...groups));

          // Clipping and Masking
          const clip: MenuEntry[] = [];
          if (selection.size() > 1) {
            clip.push(action_item('app.object-set-clip', _('Set Cl_ip')));
          }
          if (item.getClipObject()) {
            clip.push(action_item('app.object-release-clip', _('Release C_lip')));
          } else {
            clip.push(action_item('app.object-set-clip-group', _('Set Clip G_roup')));
          }
          if (selection.size() > 1) {
            clip.push(action_item('app.object-set-mask', _('Set Mask')));
          }
          if (item.getMaskObject()) {
            clip.push(action_item('app.object-release-mask', _('Release Mask')));
          }
          gmenu.push(section(...clip));

          // Hide and Lock
          gmenu.push(
            section(
              action_item('app.selection-hide', _('Hide Selected Objects')),
              action_item('app.selection-lock', _('Lock Selected Objects')),
            ),
          );
        } else {
          // Anchor menu
          gmenu.push(
            section(
              action_item('app.element-a-open-link', _('_Open Link in Browser')),
              action_item('app.selection-ungroup', _('_Remove Link')),
              action_item('win.selection-group-enter', _('Enter Group')),
            ),
          );
        }
      }

      // Hidden or locked beneath cursor
      const below: MenuEntry[] = [];
      if (has_hidden_below_cursor) {
        below.push(action_item('ctx.unhide-objects-below-cursor', _('Unhide Objects Below Cursor')));
      }
      if (has_locked_below_cursor) {
        below.push(action_item('ctx.unlock-objects-below-cursor', _('Unlock Objects Below Cursor')));
      }
      gmenu.push(section(...below));
    }

    if (layer) {
      // Layers: Only used in "Layers and Objects" dialog.
      gmenu.push(
        section(
          action_item('win.layer-new', _('_Add Layer...'), 'layer-new'),
          action_item('win.layer-duplicate', _('D_uplicate Layer'), 'layer-duplicate'),
          action_item('win.layer-delete', _('_Delete Layer'), 'layer-delete'),
          action_item('win.layer-rename', _('Re_name Layer...'), 'layer-rename'),
          action_item('win.layer-to-group', _('Layer to _Group'), 'dialog-objects'),
        ),
        section(
          action_item('win.layer-raise', _('_Raise Layer'), 'layer-raise'),
          action_item('win.layer-lower', _('_Lower Layer'), 'layer-lower'),
        ),
        section(
          action_item('win.layer-hide-toggle-others', _('_Hide/Show Other Layers')),
          action_item('win.layer-hide-all', _('_Hide All Layers')),
          action_item('win.layer-unhide-all', _('_Show All Layers')),
        ),
        section(
          action_item('win.layer-lock-toggle-others', _('_Lock/Unlock Other Layers')),
          action_item('win.layer-lock-all', _('_Lock All Layers')),
          action_item('win.layer-unlock-all', _('_Unlock All Layers')),
        ),
      );
    }
  }

  return { entries: gmenu, ctx };
}
