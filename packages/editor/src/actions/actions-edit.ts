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
import { N_, NC_, type Selection } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { NodeTool } from '../ui/tools/node-tool.ts';

const SECTION = NC_('Action Section', 'Edit');

/** Action id, label, section and tooltip (untranslated). TODO: clipboard, clones, paste size, … */
export const raw_data_edit: readonly (readonly [string, string, string, string])[] = [
  ['app.duplicate', N_('Duplicate'), SECTION, N_('Duplicate Selected Objects')],
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

export function add_actions_edit(app: InkscapeApplication): void {
  const add = (name: string, run: (selection: Selection) => void) =>
    app.actions.app.add_action(name, () => {
      const selection = app.get_active_selection();
      if (selection) run(selection);
    });
  add('duplicate', (s) => s.duplicate());
  add('delete', (s) => edit_delete(s, app));
  add('delete-selection', (s) => s.deleteItems());
  app.get_action_extra_data().add_data(raw_data_edit);
}
