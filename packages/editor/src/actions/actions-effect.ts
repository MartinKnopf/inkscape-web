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
import { Effect } from '../extension/effect.ts';
import type { Filter } from '../extension/internal/filter/filter.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { removeFilter } from '../selection-chemistry.ts';

function edit_remove_filter(app: InkscapeApplication): void {
  const selection = app.get_active_selection();
  // Remove Filter
  if (selection) removeFilter(selection, app.get_active_desktop());
}

function last_effect(app: InkscapeApplication): void {
  const effect = Effect.get_last_effect();
  if (effect === null) return;
  // Last Effect
  void effect.effect(app.get_active_desktop());
}

function last_effect_pref(app: InkscapeApplication): void {
  const effect = Effect.get_last_effect();
  if (effect === null) return;
  // Last Effect Pref
  effect.prefs(app.get_active_desktop());
}

/** Enable or disable the "Previous Extension" actions (upstream enable_effect_actions). */
export function enable_effect_actions(app: InkscapeApplication, enabled: boolean): void {
  const le_action = app.actions.app.lookup_action('last-effect');
  const lep_action = app.actions.app.lookup_action('last-effect-pref');
  if (!le_action || !lep_action) {
    console.warn('Unable to find Extension actions.');
    return;
  }
  // Enable/disable menu items.
  le_action.set_enabled(enabled);
  lep_action.set_enabled(enabled);
}

const SECTION_FILTERS = NC_('Action Section', 'Filters');
const SECTION_EXT = NC_('Action Section', 'Extensions');

/** Action id, label, section and tooltip of the effect actions (untranslated). */
export const raw_data_effect: readonly (readonly [string, string, string, string])[] = [
  [
    'app.edit-remove-filter',
    N_('Remove Filters'),
    SECTION_FILTERS,
    N_('Remove any filters from selected objects'),
  ],
  [
    'app.last-effect',
    N_('Previous Extension'),
    SECTION_EXT,
    N_('Repeat the last extension with the same settings'),
  ],
  [
    'app.last-effect-pref',
    N_('Previous Extension Settings'),
    SECTION_EXT,
    N_('Repeat the last extension with new settings'),
  ],
];

export function add_actions_effect(app: InkscapeApplication): void {
  app.actions.app.add_action('edit-remove-filter', () => edit_remove_filter(app));
  app.actions.app.add_action('last-effect', () => last_effect(app));
  app.actions.app.add_action('last-effect-pref', () => last_effect_pref(app));
  app.get_action_extra_data().add_data(raw_data_effect);
  enable_effect_actions(app, Effect.get_last_effect() !== null);
  Effect.last_effect_changed = (effect) => {
    if (effect) enable_effect_actions(app, true);
  };
}

/** Run an effect with its dialog, or with the given parameters (upstream action_effect). */
export function action_effect(
  app: InkscapeApplication,
  effect: Effect,
  prefs: ReadonlyMap<string, string> | null,
): void {
  const desktop = app.get_active_desktop();
  if (!effect.check()) {
    console.warn(`${effect.get_name()}: ${effect.getErrorReason()}`);
  } else if (effect._workingDialog && !prefs?.size && desktop) {
    effect.prefs(desktop);
  } else {
    // Set each of the given preferences
    for (const [key, val] of prefs ?? []) effect.set_param_any(key, val);
    void effect.effect(desktop, desktop ? null : app.get_active_document());
  }
}

/**
 * Register the actions app.<id> and app.<id>.noprefs of each effect and their action data
 * (upstream init_extension_action_data).
 * TODO: app.<id>.prefs (a dictionary parameter).
 */
export function init_extension_action_data(app: InkscapeApplication, effects: readonly Effect[]): void {
  for (const effect of effects) {
    const aid = effect.get_sanitized_id();
    const action_id = `app.${aid}`;
    if (!app.actions.app.lookup_action(aid)) {
      app.actions.app.add_action(aid, () => action_effect(app, effect, null));
      app.actions.app.add_action(`${aid}.noprefs`, () => action_effect(app, effect, null));
    }
    if (effect.hidden_from_menu()) continue;
    // Setting initial value of description to name of action in case there is no description
    const description = effect.get_menu_tip() || effect.get_name();
    app.get_action_extra_data().add_data([
      [action_id, effect.get_name(), 'Extensions', description],
      [
        `${action_id}.noprefs`,
        `${effect.get_name()} ${_('(No preferences)')}`,
        'Extensions (no prefs)',
        description,
      ],
    ]);
  }
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
