// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/layer-properties.cpp, src/ui/dialog/layer-properties.h
/*
 * Dialog for renaming layers, adding layers and moving the selection to a layer.
 *
 * Author:
 *   Bryce W. Harrington <bryce@bryceharrington.org>
 *   Andrius R. <knutux@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004 Bryce Harrington
 * Copyright (C) 2006 Andrius R.
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { _, C_, DocumentUndo, Preferences, type SPGroup, type SPObject } from '@inkscape-web/core';
import { show_output } from '../../actions/actions-helper.ts';
import type { SPDesktop } from '../../desktop.ts';
import { create_layer, LayerRelativePosition } from '../../layer-manager.ts';

/** What the dialog shows (upstream LayerPropertiesDialogType) and what it does when it is applied. */
export type LayerPropertiesRequest =
  | {
      type: 'create';
      title: string;
      apply_label: string;
      /** The name to start with. */
      name: string;
      /** Whether the position of the new layer can be chosen (there is a current layer). */
      position_visible: boolean;
      /** The position to start with. */
      position: LayerRelativePosition;
      apply(name: string, position: LayerRelativePosition): void;
    }
  | { type: 'rename'; title: string; apply_label: string; name: string; apply(name: string): void }
  | {
      type: 'move';
      title: string;
      apply_label: string;
      /** The layers in document order. */
      layers: { layer: SPGroup; label: string; depth: number }[];
      /** The layer to start with. */
      selected: SPGroup | null;
      apply(layer: SPObject): void;
    };

type Presenter = (request: LayerPropertiesRequest) => void;
let presenter: Presenter | null = null;

/**
 * The web app shows the dialog: it registers the function that does it. Returns the function that
 * removes it again.
 */
export function setLayerPropertiesPresenter(show: Presenter | null): () => void {
  presenter = show;
  return () => {
    if (presenter === show) presenter = null;
  };
}

/** The positions of the radio buttons, in the order of the dialog. */
export const LAYER_POSITIONS = [
  LayerRelativePosition.LPOS_ABOVE,
  LayerRelativePosition.LPOS_CHILD,
  LayerRelativePosition.LPOS_BELOW,
] as const;

const flash = (message: string) => show_output(message, false);

export const LayerPropertiesDialog = {
  /** Add Layer (win.layer-new): the name and the position relative to the current layer. */
  showCreate(desktop: SPDesktop, layer: SPObject | null): void {
    const manager = desktop.layerManager();
    const position_visible = !!layer && layer !== desktop.getDocument().getRoot();
    const stored = Preferences.get().getInt('/dialogs/layerProp/addLayerPosition', 0);
    const index = stored >= 0 && stored <= 2 ? stored : 0;
    presenter?.({
      type: 'create',
      title: _('Add Layer'),
      apply_label: _('Add'),
      name: manager.getNextLayerName(null, layer?.label() ?? null),
      position_visible,
      position: LAYER_POSITIONS[index] ?? LayerRelativePosition.LPOS_ABOVE,
      apply(name, position) {
        if (position_visible) {
          Preferences.get().setInt('/dialogs/layerProp/addLayerPosition', LAYER_POSITIONS.indexOf(position));
        } else position = LayerRelativePosition.LPOS_ABOVE;
        if (name === '') return;
        const root = desktop.getDocument().getRoot();
        const new_layer = create_layer(root, layer ?? root, position);
        if (!new_layer) return;
        manager.renameLayer(new_layer, name, true);
        desktop.getSelection().clear();
        manager.setCurrentLayer(new_layer);
        DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Add layer'), 'layer-new');
        flash(_('New layer created.'));
      },
    });
  },

  /** Rename Layer (win.layer-rename). */
  showRename(desktop: SPDesktop, layer: SPObject | null): void {
    if (!layer) return;
    presenter?.({
      type: 'rename',
      title: _('Rename Layer'),
      apply_label: _('Rename'),
      name: layer.label() ?? _('Layer'),
      apply(name) {
        if (name === '') return;
        const manager = desktop.layerManager();
        const current = manager.currentLayer();
        if (!current) return;
        // TODO: preserveLayerHighlight() of the current layer.
        manager.renameLayer(current, name, false);
        DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Rename layer'), 'layer-rename');
        // TRANSLATORS: This means "The layer has been renamed"
        flash(_('Renamed layer'));
      },
    });
  },

  /** Move Selection to Layer... (win.selection-move-to-layer): the layer to move to. */
  showMove(desktop: SPDesktop, layer: SPObject | null): void {
    const manager = desktop.layerManager();
    presenter?.({
      type: 'move',
      title: _('Move to Layer'),
      apply_label: _('Move'),
      layers: manager.allLayers().map(({ layer, depth }) => ({
        layer,
        label: layer.label() ?? layer.getId() ?? _('Layer'),
        depth,
      })),
      selected: layer && layer !== desktop.getDocument().getRoot() ? (layer as SPGroup) : null,
      apply(moveto) {
        desktop.getSelection().toLayer(moveto);
        DocumentUndo.done(
          desktop.getDocument(),
          C_('Undo', 'Move selection to layer'),
          'selection-move-to-layer',
        );
      },
    });
  },
};
