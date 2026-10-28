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
import { C_, DocumentUndo, N_, NC_ } from '@inkscape-web/core';
import type { SPDesktop } from '../desktop.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { ClipboardManager } from '../ui/clipboard.ts';

const SECTION = NC_('Action Section', 'Edit');

/** Action id, label, section and tooltip (untranslated). TODO: paste-on-page, path-effect-parameter-next. */
export const raw_data_edit_window: readonly (readonly [string, string, string, string])[] = [
  ['win.paste', N_('Paste'), SECTION, N_('Paste objects from clipboard to mouse point, or paste text')],
  [
    'win.paste-in-place',
    N_('Paste In Place'),
    SECTION,
    N_('Paste objects from clipboard to the original position of the copied objects'),
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

export function add_actions_edit_window(app: InkscapeApplication): void {
  const add = (name: string, run: (dt: SPDesktop) => void) =>
    app.actions.win.add_action(name, () => {
      const dt = app.get_active_desktop();
      if (dt) run(dt);
    });
  add('paste', (dt) => void sp_selection_paste(dt, false));
  add('paste-in-place', (dt) => void sp_selection_paste(dt, true));
  app.get_action_extra_data().add_data(raw_data_edit_window);
}
