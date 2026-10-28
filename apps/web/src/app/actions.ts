// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-file-gui.cpp, src/actions/actions-undo-document.cpp
// The file and undo actions, by upstream action id.
import { DocumentUndo } from '@inkscape-web/core';
import { getActiveDesktop, replaceDocument } from './active-desktop.ts';
import { sp_file_new_default, sp_file_open_dialog, sp_file_save, sp_file_save_as } from './file.ts';

/**
 * Run an action on the active desktop. Ids are the upstream ids of
 * actions-file-gui.cpp and actions-undo-document.cpp.
 * TODO: the action system (Gio::Action replacement) with all actions.
 */
export async function runAction(id: string): Promise<void> {
  const dt = getActiveDesktop();
  if (!dt) return;
  switch (id) {
    case 'app.document-new':
      // TODO: open the new document in a new window.
      replaceDocument(dt, await sp_file_new_default());
      dt.zoom_page();
      break;
    case 'app.document-open': {
      const doc = await sp_file_open_dialog();
      if (!doc) return;
      replaceDocument(dt, doc);
      dt.zoom_page();
      break;
    }
    case 'win.document-save':
      await sp_file_save(dt.doc);
      break;
    case 'win.document-save-as':
      await sp_file_save_as(dt.doc);
      break;
    case 'doc.undo':
      DocumentUndo.undo(dt.doc);
      break;
    case 'doc.redo':
      DocumentUndo.redo(dt.doc);
      break;
  }
}
