// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-text.cpp, src/actions/actions-text.h
/*
 * Actions Related to Text
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *
 * Copyright (C) 2021 Authors
 */
import { N_, NC_, text_remove_all_kerns } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';

const SECTION = NC_('Action Section', 'Text');

/**
 * Action id, label, section and tooltip (untranslated), of the ported text actions.
 * TODO: text-put-on-path, text-remove-from-path (textPath), text-flow-into-frame,
 * text-flow-subtract-frame, text-unflow, text-unflow-and-keep-shape,
 * text-convert-to-regular, text-convert-to-glyphs, text-select-by-font.
 */
export const raw_data_text: readonly (readonly [string, string, string, string])[] = [
  [
    'app.text-unkern',
    N_('Remove Manual Kerns'),
    SECTION,
    N_('Remove all manual kerns and glyph rotations from a text object'),
  ],
];

/** Register the text actions. The menu shows the actions that are not ported disabled. */
export function add_actions_text(app: InkscapeApplication): void {
  app.actions.app.add_action('text-unkern', () => {
    const selection = app.get_active_selection();
    if (selection) text_remove_all_kerns(selection);
  });
  app.get_action_extra_data().add_data(raw_data_text);
}
