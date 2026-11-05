// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-hint-data.cpp, src/actions/actions-hint-data.h
/*
 * Command Palette input placeholder hint data: what to enter for the parameter of an action.
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *
 * Copyright (C) 2021 Authors
 */
import { _ } from '@inkscape-web/core';
import { canonical_detailed_name } from './action-map.ts';

/** Raw hint data of the upstream action files: action name and hint (untranslated). */
export type ActionHintRawData = readonly (readonly [action: string, hint: string])[];

/** Hints for the parameters of actions, by action name. */
export class InkActionHintData {
  readonly #data = new Map<string, string>();

  get_actions(): string[] {
    return [...this.#data.keys()];
  }

  /** The hint of an action, or an empty string. */
  get_tooltip_hint_for_action(action_name: string, translated = true): string {
    const hint = this.#data.get(canonical_detailed_name(action_name)) ?? '';
    return translated && hint ? _(hint) : hint;
  }

  /** Add hints; like upstream, the first hint of an action stays. */
  add_data(raw_data: ActionHintRawData): void {
    for (const [action, hint] of raw_data) {
      const name = canonical_detailed_name(action);
      if (!this.#data.has(name)) this.#data.set(name, hint);
    }
  }
}
