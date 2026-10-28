// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-file-gui.cpp, src/actions/actions-file-window.cpp, src/actions/actions-dialogs.cpp
// The actions that need the web app: files and dialogs. The other actions are
// registered by InkscapeApplication in @inkscape-web/editor.
import { N_, NC_ } from '@inkscape-web/core';
import { InkscapeApplication, type SPDesktop } from '@inkscape-web/editor';
import { hasDialog, openDialog } from '../ui/dialog/dialog-manager.ts';
import { replaceDocument } from './active-desktop.ts';
import {
  sp_file_import,
  sp_file_new_default,
  sp_file_open_dialog,
  sp_file_save,
  sp_file_save_as,
} from './file.ts';

const SECTION_FILE = NC_('Action Section', 'File');
const SECTION_DIALOG = NC_('Action Section', 'Dialog');

const raw_data_file: readonly (readonly [string, string, string, string])[] = [
  ['app.document-new', N_('New'), SECTION_FILE, N_('Create new document from the default template')],
  ['app.document-open', N_('Open File Dialog'), SECTION_FILE, N_('Open an existing document')],
  ['win.document-save', N_('Save'), SECTION_FILE, N_('Save document')],
  ['win.document-save-as', N_('Save As'), SECTION_FILE, N_('Save document under a new name')],
  ['win.document-import', N_('Import'), SECTION_FILE, N_('Import a bitmap or SVG image into this document')],
  [
    "win.dialog-open('FillStroke')",
    N_('Open Fill and Stroke'),
    SECTION_DIALOG,
    N_("Edit objects' colors, gradients, arrowheads, and other fill and stroke properties..."),
  ],
  [
    "win.dialog-open('Export')",
    N_('Open Export'),
    SECTION_DIALOG,
    N_('Export this document or a selection as a PNG image'),
  ],
  ["win.dialog-open('Objects')", N_('Open Objects'), SECTION_DIALOG, N_('View Objects')],
  [
    "win.dialog-open('Text')",
    N_('Open Text'),
    SECTION_DIALOG,
    N_('View and select font family, font size and other text properties'),
  ],
  [
    "win.dialog-open('AlignDistribute')",
    N_('Open Align and Distribute'),
    SECTION_DIALOG,
    N_('Align and distribute objects'),
  ],
  [
    "win.dialog-open('DocumentProperties')",
    N_('Open Document Properties'),
    SECTION_DIALOG,
    N_('Edit properties of this document (to be saved with the document)'),
  ],
  [
    "win.dialog-open('XMLEditor')",
    N_('Open XML Editor'),
    SECTION_DIALOG,
    N_('View and edit the XML tree of the document'),
  ],
];

/** Register the file and dialog actions of the web app. Call once at startup. */
export function add_actions_web(app = InkscapeApplication.instance()): void {
  const withDesktop = (run: (dt: SPDesktop) => unknown) => () => {
    const dt = app.get_active_desktop();
    if (dt) void run(dt);
  };

  // TODO: open the new document in a new window.
  app.actions.app.add_action(
    'document-new',
    withDesktop(async (dt) => {
      replaceDocument(dt, await sp_file_new_default());
      dt.zoom_page();
    }),
  );
  app.actions.app.add_action(
    'document-open',
    withDesktop(async (dt) => {
      const doc = await sp_file_open_dialog();
      if (!doc) return;
      replaceDocument(dt, doc);
      dt.zoom_page();
    }),
  );
  app.actions.win.add_action(
    'document-save',
    withDesktop((dt) => sp_file_save(dt.doc)),
  );
  app.actions.win.add_action(
    'document-save-as',
    withDesktop((dt) => sp_file_save_as(dt.doc)),
  );
  app.actions.win.add_action(
    'document-import',
    withDesktop((dt) => sp_file_import(dt)),
  );
  // Dialogs that are not ported yet are disabled.
  app.actions.win.add_action_with_parameter('dialog-open', 's', openDialog, hasDialog);
  app.get_action_extra_data().add_data(raw_data_file);
}

/** Run an action by detailed name, e.g. "win.tool-switch('Rect')". */
export function runAction(id: string): void {
  InkscapeApplication.instance().activate_action(id);
}
