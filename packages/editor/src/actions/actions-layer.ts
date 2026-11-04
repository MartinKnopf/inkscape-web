// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-layer.cpp, src/actions/actions-layer.h
/*
 * Actions related to layers.
 *
 * Authors:
 *   Tavmjong Bah
 *   Martin Owens
 *
 * Copyright (C) 2021 Authors
 *
 * The contents of this file may be used under the GNU General Public License Version 2 or later.
 */
import {
  _,
  C_,
  DocumentUndo,
  LayerMode,
  N_,
  NC_,
  SP_OBJECT_WRITE_EXT,
  SP_OBJECT_WRITE_NO_CHILDREN,
  SPGroup,
  SPItem,
  type SPObject,
} from '@inkscape-web/core';
import type { SPDesktop } from '../desktop.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { create_layer, LayerRelativePosition, next_layer, previous_layer } from '../layer-manager.ts';
import { show_output } from './actions-helper.ts';

const SECTION_LAYER = NC_('Action Section', 'Layer');
const SECTION_SELECT = NC_('Action Section', 'Select');

/** Action id, label, section and tooltip (untranslated). TODO: layer-new, layer-rename, selection-move-to-layer (they open the layer dialog), layer-duplicate, selection-move-to-layer-above/below. */
export const raw_data_layer: readonly (readonly [string, string, string, string])[] = [
  ['win.layer-new-above', N_('Add Layer Above'), SECTION_LAYER, N_('Create a new layer above current')],
  ['win.layer-delete', N_('Delete Current Layer'), SECTION_LAYER, N_('Delete the current layer')],

  [
    'win.layer-hide-toggle',
    N_('Show/Hide Current Layer'),
    SECTION_LAYER,
    N_('Toggle visibility of current layer'),
  ],
  [
    'win.layer-lock-toggle',
    N_('Lock/Unlock Current Layer'),
    SECTION_LAYER,
    N_('Toggle lock on current layer'),
  ],

  [
    'win.layer-previous',
    N_('Switch to Layer Above'),
    SECTION_LAYER,
    N_('Switch to the layer above the current'),
  ],
  ['win.layer-next', N_('Switch to Layer Below'), SECTION_LAYER, N_('Switch to the layer below the current')],

  ['win.layer-top', N_('Layer to Top'), SECTION_LAYER, N_('Raise the current layer to the top')],
  ['win.layer-raise', N_('Raise Layer'), SECTION_LAYER, N_('Raise the current layer')],
  ['win.layer-lower', N_('Lower Layer'), SECTION_LAYER, N_('Lower the current layer')],
  ['win.layer-bottom', N_('Layer to Bottom'), SECTION_LAYER, N_('Lower the current layer to the bottom')],

  ['win.layer-to-group', N_('Layer to Group'), SECTION_LAYER, N_('Convert the current layer to a group')],
  ['win.layer-from-group', N_('Layer from Group'), SECTION_LAYER, N_('Convert the group to a layer')],

  // These use Layer technology even if they don't act on layers.
  ['win.selection-group-enter', N_('Enter Group'), SECTION_SELECT, N_('Enter group')],
  ['win.selection-group-exit', N_('Exit Group'), SECTION_SELECT, N_('Exit group')],
];

/** The message of upstream's status bar flash. */
const flash = (message: string) => show_output(message, false);
const no_layer = () => flash(_('No current layer.'));

/** The items among the siblings of item, in order. */
const sibling_items = (item: SPObject): SPItem[] =>
  (item.parent?.children ?? []).filter((c): c is SPItem => c instanceof SPItem);

/** Move the layer above its next sibling item (upstream SPItem::raiseOne). */
function raise_one(layer: SPItem): void {
  const items = sibling_items(layer);
  const next = items[items.indexOf(layer) + 1];
  if (next) layer.getRepr().parent()?.changeOrder(layer.getRepr(), next.getRepr());
}

/** Move the layer below its previous sibling item (upstream SPItem::lowerOne). */
function lower_one(layer: SPItem): void {
  const items = sibling_items(layer);
  const prev = items[items.indexOf(layer) - 1];
  if (!prev) return;
  const put_after = prev.getRepr().prev();
  if (put_after) layer.getRepr().parent()?.changeOrder(layer.getRepr(), put_after);
  else layer.getRepr().setPosition(0);
}

/** Move the layer to the end of its parent (upstream SPItem::raiseToTop). */
function raise_to_top(layer: SPItem): void {
  layer.getRepr().setPosition(-1);
}

/** Move the layer below all its sibling items, but above non-items like defs (upstream SPItem::lowerToBottom). */
function lower_to_bottom(layer: SPItem): void {
  const first = sibling_items(layer)[0];
  if (!first || first === layer) return;
  const put_after = first.getRepr().prev();
  if (put_after) layer.getRepr().parent()?.changeOrder(layer.getRepr(), put_after);
  else layer.getRepr().setPosition(0);
}

export function add_actions_layer(app: InkscapeApplication): void {
  const add = (name: string, run: (dt: SPDesktop) => void) =>
    app.actions.win.add_action(name, () => {
      const dt = app.get_active_desktop();
      if (dt) run(dt);
    });
  /** Run with the current layer; a warning if there is none (the root is not a layer to act on). */
  const with_layer = (name: string, run: (dt: SPDesktop, layer: SPGroup) => void) =>
    add(name, (dt) => {
      const layer = dt.layerManager().currentLayer();
      if (!layer || dt.layerManager().isRoot()) no_layer();
      else run(dt, layer);
    });

  add('layer-new-above', (dt) => {
    const manager = dt.layerManager();
    const document = dt.getDocument();
    const current = manager.currentLayer();
    const root = document.getRoot();
    if (!current) return;
    const new_layer = create_layer(root, current, LayerRelativePosition.LPOS_ABOVE);
    if (!new_layer) return;
    new_layer.setAttribute('inkscape:label', current.label() ?? '');
    dt.getSelection().clear();
    manager.setCurrentLayer(new_layer);
    DocumentUndo.done(document, C_('Undo', 'Add layer'), 'layer-new');
    flash(_('New layer created.'));
  });

  with_layer('layer-delete', (dt, old_layer) => {
    const manager = dt.layerManager();
    const root = manager.currentRoot();
    if (!root) return;
    dt.getSelection().clear();
    const old_parent = old_layer.parent;
    const old_parent_parent = old_parent?.parent ?? null;

    let survivor = previous_layer(root, old_layer);
    if (survivor && survivor.parent === old_layer) {
      while (survivor && survivor.parent !== old_parent && survivor.parent !== old_parent_parent) {
        survivor = previous_layer(root, survivor);
      }
    }
    if (!survivor || (survivor.parent !== old_parent && survivor.parent !== old_layer)) {
      survivor = next_layer(root, old_layer);
      while (survivor && survivor !== old_parent && survivor.parent !== old_parent) {
        survivor = next_layer(root, survivor);
      }
    }
    // Deleting the old layer before switching layers triggers the listeners of the deletion event.
    old_layer.deleteObject();
    if (survivor) manager.setCurrentLayer(survivor);
    DocumentUndo.done(dt.getDocument(), C_('Undo', 'Delete layer'), 'layer-delete');
    flash(_('Deleted layer.'));
  });

  with_layer('layer-hide-toggle', (_dt, layer) => layer.setHidden(!layer.isHidden()));
  with_layer('layer-lock-toggle', (_dt, layer) => layer.setLocked(!layer.isLocked()));

  // The layer above is the next one in document order.
  add('layer-previous', (dt) => {
    const manager = dt.layerManager();
    const root = manager.currentRoot();
    const current = manager.currentLayer();
    const next = root && current ? next_layer(root, current) : null;
    if (next) {
      manager.setCurrentLayer(next);
      DocumentUndo.done(dt.getDocument(), C_('Undo', 'Switch to next layer'), 'layer-previous');
      flash(_('Switched to next layer.'));
    } else flash(_('Cannot go past last layer.'));
  });
  add('layer-next', (dt) => {
    const manager = dt.layerManager();
    const root = manager.currentRoot();
    const current = manager.currentLayer();
    const prev = root && current ? previous_layer(root, current) : null;
    if (prev) {
      manager.setCurrentLayer(prev);
      DocumentUndo.done(dt.getDocument(), C_('Undo', 'Switch to previous layer'), 'layer-next');
      flash(_('Switched to previous layer.'));
    } else flash(_('Cannot go before first layer.'));
  });

  /** Move the layer within its parent and report as upstream. */
  const move = (name: string, mover: (layer: SPItem) => void, undo: string, icon: string, message: string) =>
    with_layer(name, (dt, layer) => {
      const old_pos = layer.getRepr().next();
      mover(layer);
      if (layer.getRepr().next() !== old_pos) {
        DocumentUndo.done(dt.getDocument(), undo, icon);
        flash(message.replace('%s', layer.label() ?? layer.getId() ?? ''));
      } else flash(_('Cannot move layer any further.'));
    });
  move('layer-top', raise_to_top, C_('Undo', 'Layer to top'), 'layer-top', _('Raised layer <b>%s</b>.'));
  move('layer-raise', raise_one, C_('Undo', 'Raise layer'), 'layer-raise', _('Raised layer <b>%s</b>.'));
  move('layer-lower', lower_one, C_('Undo', 'Lower layer'), 'layer-lower', _('Lowered layer <b>%s</b>.'));
  move(
    'layer-bottom',
    lower_to_bottom,
    C_('Undo', 'Layer to bottom'),
    'layer-bottom',
    _('Lowered layer <b>%s</b>.'),
  );

  with_layer('layer-to-group', (dt, layer) => {
    layer.setLayerMode(LayerMode.GROUP);
    layer.updateRepr(SP_OBJECT_WRITE_NO_CHILDREN | SP_OBJECT_WRITE_EXT);
    dt.getSelection().set(layer);
    DocumentUndo.done(dt.getDocument(), C_('Undo', 'Layer to group'), 'dialog-objects');
  });

  add('layer-from-group', (dt) => {
    const selection = dt.getSelection();
    const obj = selection.single() ? selection.singleItem() : null;
    if (!obj) {
      show_output('layer_to_group: only one selected item allowed!');
      return;
    }
    if (obj instanceof SPGroup) {
      if (!obj.isLayer()) {
        obj.setLayerMode(LayerMode.LAYER);
        obj.updateRepr(SP_OBJECT_WRITE_NO_CHILDREN | SP_OBJECT_WRITE_EXT);
        selection.set(obj);
        DocumentUndo.done(dt.getDocument(), C_('Undo', 'Group to layer'), 'dialog-objects');
      } else flash(_('Group already layer.'));
    } else flash(_('Selection is not a group.'));
  });

  // Does not change XML.
  add('selection-group-enter', (dt) => {
    const selection = dt.getSelection();
    const obj = selection.singleItem();
    if (obj instanceof SPGroup) {
      // Only one item and it is a group!
      dt.layerManager().setCurrentLayer(obj);
      selection.clear();
    }
  });
  // Does not change XML.
  add('selection-group-exit', (dt) => {
    const selection = dt.getSelection();
    const parent = dt.layerManager().currentLayer()?.parent;
    if (parent) dt.layerManager().setCurrentLayer(parent);
    const obj = selection.singleItem();
    if (obj && obj.parent instanceof SPGroup) {
      // Only one item selected and the parent is a group!
      selection.set(obj.parent);
    } else selection.clear();
  });
  app.get_action_extra_data().add_data(raw_data_layer);
}
