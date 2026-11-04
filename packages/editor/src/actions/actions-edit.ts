// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-edit.cpp, src/actions/actions-edit.h
/*
 * Actions for editing an object.
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *
 * Copyright (C) 2021 Authors
 */
import { C_, DocumentUndo, N_, NC_, Preferences, type Selection } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { relinkClones, swapFillStroke } from '../selection-chemistry.ts';
import { ClipboardManager } from '../ui/clipboard.ts';
import { NodeDeleteMode } from '../ui/tool/path-manipulator.ts';
import { NodeTool } from '../ui/tools/node-tool.ts';

const SECTION = NC_('Action Section', 'Edit');

/**
 * Action id, label, section and tooltip (untranslated).
 * TODO: object-to-pattern/marker/guides, duplicate-transform, clone-link,
 * path effects, swap-fill-and-stroke, fit-canvas-to-selection, chameleon-fill.
 */
export const raw_data_edit: readonly (readonly [string, string, string, string])[] = [
  ['app.cut', N_('Cut'), SECTION, N_('Cut selection to clipboard')],
  ['app.copy', N_('Copy'), SECTION, N_('Copy selection to clipboard')],
  ['app.paste-style', N_('Paste Style'), SECTION, N_('Apply the style of the copied object to selection')],
  ['app.paste-size', N_('Paste Size'), SECTION, N_('Scale selection to match the size of the copied object')],
  [
    'app.paste-width',
    N_('Paste Width'),
    SECTION,
    N_('Scale selection horizontally to match the width of the copied object'),
  ],
  [
    'app.paste-height',
    N_('Paste Height'),
    SECTION,
    N_('Scale selection vertically to match the height of the copied object'),
  ],
  [
    'app.paste-size-separately',
    N_('Paste Size Separately'),
    SECTION,
    N_('Scale each selected object to match the size of the copied object'),
  ],
  [
    'app.paste-width-separately',
    N_('Paste Width Separately'),
    SECTION,
    N_('Scale each selected object horizontally to match the width of the copied object'),
  ],
  [
    'app.paste-height-separately',
    N_('Paste Height Separately'),
    SECTION,
    N_('Scale each selected object vertically to match the height of the copied object'),
  ],
  ['app.duplicate', N_('Duplicate'), SECTION, N_('Duplicate Selected Objects')],
  [
    'app.object-to-pattern',
    N_('Objects to Pattern'),
    SECTION,
    N_('Convert selection to a rectangle with tiled pattern fill'),
  ],
  [
    'app.pattern-to-object',
    N_('Pattern to Objects'),
    SECTION,
    N_('Extract objects from a tiled pattern fill'),
  ],
  [
    'app.clone',
    N_('Create Clone'),
    SECTION,
    N_('Create a clone (a copy linked to the original) of selected object'),
  ],
  [
    'app.clone-unlink',
    N_('Unlink Clone'),
    SECTION,
    N_("Cut the selected clones' links to the originals, turning them into standalone objects"),
  ],
  [
    'app.clone-unlink-recursively',
    N_('Unlink Clones recursively'),
    SECTION,
    N_('Unlink all clones in the selection, even if they are in groups.'),
  ],
  [
    'app.clone-link-lpe',
    N_('Clone original path (LPE)'),
    SECTION,
    N_('Creates a new path, applies the Clone original LPE, and refers it to the selected path'),
  ],
  [
    'app.select-original',
    N_('Select Original'),
    SECTION,
    N_('Select the object to which the selected clone is linked'),
  ],
  ['app.object-to-marker', N_('Objects to Marker'), SECTION, N_('Convert selection to a line marker')],
  [
    'app.object-to-guides',
    N_('Objects to Guides'),
    SECTION,
    N_('Convert selected objects to a collection of guidelines aligned with their edges'),
  ],
  [
    'app.duplicate-transform',
    N_('Duplicate and Transform'),
    SECTION,
    N_('Duplicate selected objects and reapply last transformation'),
  ],
  [
    'app.clone-link',
    N_('Relink to Copied'),
    SECTION,
    N_('Relink the selected clones to the object currently on the clipboard'),
  ],
  [
    'app.paste-path-effect',
    N_('Paste Path Effect'),
    SECTION,
    N_('Apply the path effect of the copied object to selection'),
  ],
  [
    'app.remove-path-effect',
    N_('Remove Path Effect'),
    SECTION,
    N_('Remove any path effects from selected objects'),
  ],
  ['app.swap-fill-and-stroke', N_('Swap fill and stroke'), SECTION, N_('Swap fill and stroke of an object')],
  [
    'app.fit-canvas-to-selection',
    N_('Fit Page to Selection'),
    SECTION,
    N_('Fit the page to the current selection'),
  ],
  ['app.delete', N_('Delete'), SECTION, N_('Delete selected items, nodes or text.')],
  ['app.delete-selection', N_('Delete Items'), SECTION, N_('Delete selected items')],
];

/** Delete the selected nodes with the node tool, else the selected items. TODO: text tool. */
function edit_delete(selection: Selection, app: InkscapeApplication): void {
  // For text and node too special handling.
  const tool = app.get_active_desktop()?.getTool();
  if (tool instanceof NodeTool && !tool._selected_nodes.empty()) {
    tool.deleteSelected();
    return;
  }
  //  Delete select objects only.
  selection.deleteItems();
}

/**
 * Copy the selection to the clipboard and delete it (upstream ObjectSet::cut).
 * With the node tool, the selected nodes are deleted instead (copying nodes is TODO).
 * TODO: text tool.
 */
function cut(selection: Selection, app: InkscapeApplication): void {
  void ClipboardManager.get().copy(selection);
  const tool = app.get_active_desktop()?.getTool();
  if (tool instanceof NodeTool && !tool._selected_nodes.empty()) {
    // This takes care of undo internally
    tool._multipath.deleteNodes(
      Preferences.get().getInt('/tools/node/delete-mode-cut', NodeDeleteMode.gap_lines),
    );
    return;
  }
  selection.deleteItems();
}

/** Paste Style, Paste Size and the other paste actions on the selection (upstream ObjectSet::paste*). */
function paste_style(app: InkscapeApplication): void {
  const desktop = app.get_active_desktop();
  if (!desktop) return;
  void ClipboardManager.get()
    .pasteStyle(desktop)
    .then((pasted) => {
      if (pasted) DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Paste style'), 'edit-paste-style');
    });
}

function paste_size(selection: Selection, separately: boolean, apply_x: boolean, apply_y: boolean): void {
  void ClipboardManager.get()
    .pasteSize(selection, separately, apply_x, apply_y)
    .then((pasted) => {
      const document = selection.document();
      if (!pasted || !document) return;
      if (separately) {
        DocumentUndo.done(document, C_('Undo', 'Paste size separately'), 'edit-paste-size-separately');
      } else {
        DocumentUndo.done(document, C_('Undo', 'Paste size'), 'edit-paste-size');
      }
    });
}

/** Duplicate the selection and apply the last transformation to the copies (upstream duplicate_transform). */
function duplicate_transform(selection: Selection): void {
  selection.duplicate(true);
  selection.reapplyAffine();
  const document = selection.document();
  if (document) DocumentUndo.done(document, C_('Undo', 'Duplicate and Transform'), 'edit-duplicate');
}

export function add_actions_edit(app: InkscapeApplication): void {
  const add = (name: string, run: (selection: Selection) => void) =>
    app.actions.app.add_action(name, () => {
      const selection = app.get_active_selection();
      if (selection) run(selection);
    });
  add('cut', (s) => cut(s, app));
  add('copy', (s) => void ClipboardManager.get().copy(s));
  add('paste-style', () => paste_style(app));
  add('paste-size', (s) => paste_size(s, false, true, true));
  add('paste-width', (s) => paste_size(s, false, true, false));
  add('paste-height', (s) => paste_size(s, false, false, true));
  add('paste-size-separately', (s) => paste_size(s, true, true, true));
  add('paste-width-separately', (s) => paste_size(s, true, true, false));
  add('paste-height-separately', (s) => paste_size(s, true, false, true));
  add('duplicate', (s) => s.duplicate());
  add('object-to-pattern', (s) => s.tile());
  add('pattern-to-object', (s) => s.untile());
  add('clone', (s) => s.clone());
  add('clone-unlink', (s) => s.unlink());
  add('clone-unlink-recursively', (s) => s.unlinkRecursive(false, true));
  add('clone-link-lpe', (s) => s.cloneOriginalPathLPE());
  add('select-original', (s) => s.cloneOriginal());
  add('object-to-marker', (s) => s.toMarker());
  add('object-to-guides', (s) => s.toGuides());
  add('duplicate-transform', duplicate_transform);
  add('clone-link', (s) => void relinkClones(s, ClipboardManager.get().getFirstObjectID()));
  add('paste-path-effect', (s) => {
    void ClipboardManager.get()
      .pastePathEffect(s)
      .then((pasted) => {
        const document = s.document();
        if (pasted && document) DocumentUndo.done(document, C_('Undo', 'Paste live path effect'), '');
      });
  });
  add('remove-path-effect', (s) => s.removeLPE());
  add('swap-fill-and-stroke', (s) => swapFillStroke(s, app.get_active_desktop()));
  add('fit-canvas-to-selection', (s) => void s.fitCanvas(true));
  add('delete', (s) => edit_delete(s, app));
  add('delete-selection', (s) => s.deleteItems());
  app.get_action_extra_data().add_data(raw_data_edit);
}
