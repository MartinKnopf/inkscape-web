// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-file-gui.cpp, src/actions/actions-undo-document.cpp, src/actions/actions-tools.cpp, src/actions/actions-dialogs.cpp, src/actions/actions-object.cpp, src/actions/actions-node-tool.cpp, src/actions/actions-paths.cpp, src/actions/actions-object-align.cpp
// The file, undo, tool and dialog actions, by upstream action id.
import { DocumentUndo, toCurves } from '@inkscape-web/core';
import {
  node_tool_actions,
  object_align_actions,
  path_actions,
  tool_switch,
  toolSwitchTarget,
} from '@inkscape-web/editor';
import { openDialog } from '../ui/dialog/dialog-manager.ts';
import { getActiveDesktop, replaceDocument } from './active-desktop.ts';
import { sp_file_new_default, sp_file_open_dialog, sp_file_save, sp_file_save_as } from './file.ts';

/**
 * Run an action on the active desktop. Ids are the upstream ids of
 * actions-file-gui.cpp, actions-undo-document.cpp and actions-tools.cpp.
 * TODO: the action system (Gio::Action replacement) with all actions.
 */
export async function runAction(id: string): Promise<void> {
  // Detailed action name, as in share/keys/inkscape.xml: win.dialog-open('XMLEditor')
  const dialog = /^win\.dialog-open\('(\w+)'\)$/.exec(id);
  if (dialog?.[1]) return openDialog(dialog[1]);
  const dt = getActiveDesktop();
  if (!dt) return;
  const tool = toolSwitchTarget(id);
  if (tool) {
    tool_switch(tool, dt);
    return;
  }
  // win.node-* (actions-node-tool.cpp)
  const node_action = id.startsWith('win.') ? node_tool_actions[id.slice(4)] : undefined;
  if (node_action) {
    node_action(dt);
    return;
  }
  // app.path-* (actions-paths.cpp)
  const path_action = id.startsWith('app.') ? path_actions[id.slice(4)] : undefined;
  if (path_action) {
    path_action(dt.getSelection());
    return;
  }
  // Detailed names with a string target: app.object-align('left pref') (actions-object-align.cpp)
  const target = /^app\.([\w-]+)\('([^']*)'\)$/.exec(id);
  const align_action = target?.[1] ? object_align_actions[target[1]] : undefined;
  if (align_action) {
    align_action(dt.getSelection(), target?.[2] ?? '');
    return;
  }
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
    case 'app.object-to-path':
      // TODO: /options/clonestocurvesjustunlink/value (clones).
      toCurves(dt.getSelection());
      break;
  }
}
