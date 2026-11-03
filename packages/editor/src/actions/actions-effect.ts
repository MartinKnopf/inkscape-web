// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-effect.cpp, src/actions/actions-effect.h
/*
 * Actions for Filters and Extension menu items
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *
 * Copyright (C) 2021 Authors
 */
import { _, N_, NC_ } from '@inkscape-web/core';
import type { Filter } from '../extension/internal/filter/filter.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { removeFilter } from '../selection-chemistry.ts';

function edit_remove_filter(app: InkscapeApplication): void {
  const selection = app.get_active_selection();
  // Remove Filter
  if (selection) removeFilter(selection, app.get_active_desktop());
}

const SECTION_FILTERS = NC_('Action Section', 'Filters');

/**
 * Action id, label, section and tooltip of the effect actions (untranslated).
 * TODO: app.last-effect and app.last-effect-pref (the extensions).
 */
export const raw_data_effect: readonly (readonly [string, string, string, string])[] = [
  [
    'app.edit-remove-filter',
    N_('Remove Filters'),
    SECTION_FILTERS,
    N_('Remove any filters from selected objects'),
  ],
];

export function add_actions_effect(app: InkscapeApplication): void {
  app.actions.app.add_action('edit-remove-filter', () => edit_remove_filter(app));
  app.get_action_extra_data().add_data(raw_data_effect);
}

/**
 * Register the action app.<id> of each filter effect (upstream add_document_actions_effect and
 * the effects of the menus): it applies the filter to the selection.
 */
export function add_actions_filter_effects(app: InkscapeApplication, effects: readonly Filter[]): void {
  for (const effect of effects) {
    const id = effect.get_sanitized_id();
    if (app.actions.app.lookup_action(id)) continue;
    app.actions.app.add_action(id, () => {
      const selection = app.get_active_selection();
      if (selection) effect.effect(selection, _(effect.name));
    });
  }
  app
    .get_action_extra_data()
    .add_data(effects.map((e) => [`app.${e.get_sanitized_id()}`, e.name, SECTION_FILTERS, e.menu_tip]));
}
