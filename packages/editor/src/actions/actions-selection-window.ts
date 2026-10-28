// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-selection-window.cpp, src/actions/actions-selection-window.h
/*
 * Actions related to selection which require desktop.
 *
 * These are linked to the desktop as they operate differently
 * depending on if the node tool is in use or not.
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *
 * Copyright (C) 2021 Authors
 */
import { N_, NC_ } from '@inkscape-web/core';
import type { SPDesktop } from '../desktop.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { SelectionHelper } from '../selection-chemistry.ts';

const SECTION = NC_('Action Section', 'Select');

/** Action id, label, section and tooltip (untranslated). TODO: select-same-*. */
export const raw_selection_dekstop_data: readonly (readonly [string, string, string, string])[] = [
  ['win.select-all', N_('Select All'), SECTION, N_('Select all objects or all nodes')],
  [
    'win.select-all-layers',
    N_('Select All in All Layers'),
    SECTION,
    N_('Select all objects in all visible and unlocked layers'),
  ],
  [
    'win.select-invert',
    N_('Invert Selection'),
    SECTION,
    N_('Invert selection (unselect what is selected and select everything else)'),
  ],
  [
    'win.select-invert-all',
    N_('Invert in All Layers'),
    SECTION,
    N_('Invert selection in all visible and unlocked layers'),
  ],
  ['win.select-none', N_('Deselect'), SECTION, N_('Deselect any selected objects or nodes')],
];

export function add_actions_select_window(app: InkscapeApplication): void {
  const add = (name: string, run: (dt: SPDesktop) => void) =>
    app.actions.win.add_action(name, () => {
      const dt = app.get_active_desktop();
      if (dt) run(dt);
    });
  add('select-all', SelectionHelper.selectAll);
  add('select-all-layers', SelectionHelper.selectAllInAll);
  add('select-invert', SelectionHelper.invert);
  add('select-invert-all', SelectionHelper.invertAllInAll);
  add('select-none', SelectionHelper.selectNone);
  app.get_action_extra_data().add_data(raw_selection_dekstop_data);
}
