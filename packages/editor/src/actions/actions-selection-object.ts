// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-selection-object.cpp, src/actions/actions-selection-object.h
/*
 * Actions related to manipulation a selection of objects which don't require desktop.
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *
 * Copyright (C) 2021 Authors
 */
import { C_, DocumentUndo, N_, NC_, type Selection } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';

const SECTION_SELECT = NC_('Action Section', 'Select');

/** Action id, label, section and tooltip (untranslated). TODO: ungroup-pop, link, stack up/down, bitmap copy. */
export const raw_data_selection_object: readonly (readonly [string, string, string, string])[] = [
  ['app.selection-group', NC_('Verb', 'Group'), SECTION_SELECT, N_('Group selected objects')],
  ['app.selection-ungroup', N_('Ungroup'), SECTION_SELECT, N_('Ungroup selected objects')],
  ['app.selection-top', N_('Raise to Top'), SECTION_SELECT, N_('Raise selection to top')],
  ['app.selection-raise', N_('Raise'), SECTION_SELECT, N_('Bring selection up one step')],
  ['app.selection-lower', N_('Lower'), SECTION_SELECT, N_('Bring selection down one step')],
  ['app.selection-bottom', N_('Lower to Bottom'), SECTION_SELECT, N_('Lower selection to bottom')],
];

function select_object_group(selection: Selection): void {
  selection.group();
  const doc = selection.document();
  if (doc) DocumentUndo.done(doc, C_('Undo', 'Group'), 'object-group');
}

function select_object_ungroup(selection: Selection): void {
  selection.ungroup();
  const doc = selection.document();
  if (doc) DocumentUndo.done(doc, C_('Undo', 'Ungroup'), 'object-ungroup');
}

export function add_actions_selection_object(app: InkscapeApplication): void {
  const add = (name: string, run: (selection: Selection) => void) =>
    app.actions.app.add_action(name, () => {
      const selection = app.get_active_selection();
      if (selection) run(selection);
    });
  add('selection-group', select_object_group);
  add('selection-ungroup', select_object_ungroup);
  add('selection-top', (s) => s.raiseToTop());
  add('selection-raise', (s) => s.raise());
  add('selection-lower', (s) => s.lower());
  add('selection-bottom', (s) => s.lowerToBottom());
  app.get_action_extra_data().add_data(raw_data_selection_object);
}
