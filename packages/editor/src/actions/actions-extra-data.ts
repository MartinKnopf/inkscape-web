// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-extra-data.cpp, src/actions/actions-extra-data.h
/*
 * Extra data associated with actions: Label, Section, Tooltip.
 *
 * Copyright (C) 2020 Tavmjong Bah
 *
 * Extra data is indexed by "detailed action names", that is an action
 * with prefix and value (if statefull). For example:
 *   "win.canvas-display-mode(1)"
 */
import { _ } from '@inkscape-web/core';
import { canonical_detailed_name } from './action-map.ts';

/** Raw data of the upstream action files: detailed action name, label, section and tooltip (untranslated). */
export type ActionRawData = readonly (readonly [
  action: string,
  label: string,
  section: string,
  tooltip: string,
])[];

interface InkActionExtraDatum {
  label: string;
  section: string;
  tooltip: string;
}

/** Labels, sections and tooltips of actions, by detailed action name. */
export class InkActionExtraData {
  readonly #data = new Map<string, InkActionExtraDatum>();

  get_actions(): string[] {
    return [...this.#data.keys()];
  }

  get_label_for_action(action_name: string, translated = true): string {
    const label = this.#data.get(canonical_detailed_name(action_name))?.label ?? '';
    return translated && label ? _(label) : label;
  }

  // TODO: Section should be translatable, too
  get_section_for_action(action_name: string): string {
    return this.#data.get(canonical_detailed_name(action_name))?.section ?? '';
  }

  /** The tooltip; with expanded, the label and the tooltip on two lines (upstream: label in bold). */
  get_tooltip_for_action(action_name: string, translated = true, expanded = false): string {
    const datum = this.#data.get(canonical_detailed_name(action_name));
    if (!datum) return '';
    const t = (s: string) => (translated && s ? _(s) : s);
    return expanded ? `${t(datum.label)}\n${t(datum.tooltip)}` : t(datum.tooltip);
  }

  add_data(raw_data: ActionRawData): void {
    for (const [action, label, section, tooltip] of raw_data) {
      this.#data.set(canonical_detailed_name(action), { label, section, tooltip });
    }
  }
}
