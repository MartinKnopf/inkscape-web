// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-edit-window.cpp, src/actions/actions-edit-window.h
/*
 * Actions for Editing an object which require desktop
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *
 * Copyright (C) 2021 Authors
 */
import { _, C_, DocumentUndo, N_, NC_, PathParam, SPLPEItem } from '@inkscape-web/core';
import type { SPDesktop } from '../desktop.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { ClipboardManager } from '../ui/clipboard.ts';
import { param_editOncanvas } from '../ui/dialog/livepatheffect-editor.ts';
import { show_output } from './actions-helper.ts';

const SECTION = NC_('Action Section', 'Edit');

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_edit_window: readonly (readonly [string, string, string, string])[] = [
  ['win.paste', N_('Paste'), SECTION, N_('Paste objects from clipboard to mouse point, or paste text')],
  [
    'win.paste-in-place',
    N_('Paste In Place'),
    SECTION,
    N_('Paste objects from clipboard to the original position of the copied objects'),
  ],
  [
    'win.paste-on-page',
    N_('Paste On Page'),
    SECTION,
    N_('Paste objects from clipboard into the same place on the selected page.'),
  ],
  [
    'win.path-effect-parameter-next',
    N_('Next path effect parameter'),
    SECTION,
    N_('Show next editable path effect parameter'),
  ],
];

/**
 * Paste the clipboard into desktop with the undo step "Paste" (upstream
 * sp_selection_paste). The clipboard is read asynchronously; the promise
 * resolves when the paste is done.
 */
export async function sp_selection_paste(
  desktop: SPDesktop,
  in_place: boolean,
  on_page = false,
): Promise<void> {
  if (await ClipboardManager.get().paste(desktop, in_place, on_page)) {
    DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Paste'), 'edit-paste');
  }
}

/**
 * Edit the next parameter of the path effect of the selected item on the canvas (upstream
 * sp_selection_next_patheffect_param and SPLPEItem/Effect::editNextParamOncanvas). Only path
 * parameters can be edited on the canvas (with the node tool).
 */
export function sp_selection_next_patheffect_param(desktop: SPDesktop): void {
  const item = desktop.getSelection().singleItem();
  if (!(item instanceof SPLPEItem)) return;
  if (!item.hasPathEffect()) {
    show_output(_('The selection has no applied path effect.'));
    return;
  }
  const lpe = item.getCurrentLPE();
  if (!lpe) return;
  const param = lpe.getNextOncanvasEditableParam();
  if (param) {
    // Only path parameters have something to edit (path array parameters do nothing upstream, too).
    if (param instanceof PathParam) param_editOncanvas(desktop, param, item);
    show_output(_('Editing parameter <b>%s</b>.').replace('%s', param.param_label), false);
  } else {
    show_output(_("None of the applied path effect's parameters can be edited on-canvas."));
  }
}

export function add_actions_edit_window(app: InkscapeApplication): void {
  const add = (name: string, run: (dt: SPDesktop) => void) =>
    app.actions.win.add_action(name, () => {
      const dt = app.get_active_desktop();
      if (dt) run(dt);
    });
  add('paste', (dt) => void sp_selection_paste(dt, false));
  add('paste-in-place', (dt) => void sp_selection_paste(dt, true));
  add('paste-on-page', (dt) => void sp_selection_paste(dt, true, true));
  add('path-effect-parameter-next', sp_selection_next_patheffect_param);
  app.get_action_extra_data().add_data(raw_data_edit_window);
}
