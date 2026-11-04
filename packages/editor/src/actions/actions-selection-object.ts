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
import { createBitmapCopy } from '../selection-chemistry.ts';

const SECTION_SELECT = NC_('Action Section', 'Select');
const SECTION_PAGE = NC_('Action Section', 'Page');

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_selection_object: readonly (readonly [string, string, string, string])[] = [
  ['app.selection-group', NC_('Verb', 'Group'), SECTION_SELECT, N_('Group selected objects')],
  ['app.selection-ungroup', N_('Ungroup'), SECTION_SELECT, N_('Ungroup selected objects')],
  [
    'app.selection-ungroup-pop',
    N_('Pop Selected Objects out of Group'),
    SECTION_SELECT,
    N_('Pop selected objects out of group'),
  ],
  [
    'app.selection-link',
    NC_('Hyperlink|Verb', 'Link'),
    SECTION_SELECT,
    N_('Add an anchor to selected objects'),
  ],
  ['app.selection-top', N_('Raise to Top'), SECTION_SELECT, N_('Raise selection to top')],
  ['app.selection-raise', N_('Raise'), SECTION_SELECT, N_('Bring selection up one step')],
  ['app.selection-lower', N_('Lower'), SECTION_SELECT, N_('Bring selection down one step')],
  ['app.selection-bottom', N_('Lower to Bottom'), SECTION_SELECT, N_('Lower selection to bottom')],
  [
    'app.selection-stack-up',
    N_('Move up the Stack'),
    SECTION_SELECT,
    N_('Move the selection up in the stack order'),
  ],
  [
    'app.selection-stack-down',
    N_('Move down the Stack'),
    SECTION_SELECT,
    N_('Move the selection down in the stack order'),
  ],
  [
    'app.selection-make-bitmap-copy',
    N_('Make a Bitmap Copy'),
    SECTION_SELECT,
    N_('Export selection to a bitmap and insert it into document'),
  ],
  [
    'app.page-fit-to-selection',
    N_('Resize Page to Selection'),
    SECTION_PAGE,
    N_('Fit the page to the current selection or the drawing if there is no selection'),
  ],
];

/** Fit the selected page to the selection, or to the drawing without one (upstream page_fit_to_selection). */
export function page_fit_to_selection(selection: Selection): void {
  const document = selection.document();
  if (!document) return;
  document.getPageManager().fitToSelection(selection);
  DocumentUndo.done(document, C_('Undo', 'Resize page to fit'), 'tool-pages');
}

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

/** Group the selection in an anchor and open the Object Properties dialog to add the link (upstream select_object_link). */
function select_object_link(selection: Selection, app: InkscapeApplication): void {
  const anchor = selection.group(true);
  const document = selection.document();
  const object = anchor && document ? document.getObjectByRepr(anchor) : null;
  if (object) selection.set(object);
  app.activate_action('win.dialog-open("ObjectProperties")');
  if (document) DocumentUndo.done(document, C_('Undo', 'Anchor'), 'object-group');
}

export function add_actions_selection_object(app: InkscapeApplication): void {
  const add = (name: string, run: (selection: Selection) => void) =>
    app.actions.app.add_action(name, () => {
      const selection = app.get_active_selection();
      if (selection) run(selection);
    });
  add('selection-group', select_object_group);
  add('selection-ungroup', select_object_ungroup);
  add('selection-ungroup-pop', (s) => s.popFromGroup());
  add('selection-link', (s) => select_object_link(s, app));
  add('selection-stack-up', (s) => s.stackUp());
  add('selection-stack-down', (s) => s.stackDown());
  add('selection-make-bitmap-copy', (s) => void createBitmapCopy(s));
  add('selection-top', (s) => s.raiseToTop());
  add('selection-raise', (s) => s.raise());
  add('selection-lower', (s) => s.lower());
  add('selection-bottom', (s) => s.lowerToBottom());
  add('page-fit-to-selection', page_fit_to_selection);
  app.get_action_extra_data().add_data(raw_data_selection_object);
}
