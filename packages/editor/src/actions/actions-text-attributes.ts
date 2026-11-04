// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-text-attributes.cpp, src/actions/actions-text-attributes.h
/*
 * Actions Related to Text Attributes (decoration, etc.)
 *
 * Authors:
 *   Tavmjong Bah
 *
 * Copyright (C) 2026 Authors
 */
import {
  C_,
  DocumentUndo,
  N_,
  NC_,
  type SPStyle,
  spReprCssAttrNew,
  spReprCssSetProperty,
} from '@inkscape-web/core';
import { sp_desktop_set_style } from '../desktop-style.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';

const SECTION = NC_('Action Section', 'Text');

export const text_decoration_line_values = ['underline', 'line-through', 'overline'] as const;

/**
 * Set text-decoration for current selection.
 * Eventually to be tied to an App level action for use from command line (requires validating string).
 */
function text_decoration_set_css(app: InkscapeApplication, attribute: string, value: string): void {
  const desktop = app.get_active_desktop();
  if (!desktop) return;
  const css = spReprCssAttrNew();
  spReprCssSetProperty(css, attribute, value || 'none');
  sp_desktop_set_style(desktop, css, true, false);
  // Save for undo
  DocumentUndo.maybeDone(
    desktop.getDocument(),
    'text-decoration',
    C_('Undo', 'Text: Change text-decoration'),
    'draw-text',
  );
}

/** Set the states of the decoration actions from the queried style (the text toolbar calls it on selection change). */
export function text_decoration_line_set(app: InkscapeApplication, query: SPStyle): void {
  for (const value of text_decoration_line_values) {
    const action = app.actions.win.lookup_action(`text-decoration-line-${value}`);
    if (!action) continue;
    const line = query.text_decoration_line;
    if (value === 'underline') action.change_state(line.underline);
    if (value === 'line-through') action.change_state(line.line_through);
    if (value === 'overline') action.change_state(line.overline);
  }
}

/** Toggle the decoration at position and set text-decoration-line of the selection from all states. */
function text_decoration_line(app: InkscapeApplication, position: number): void {
  const out: string[] = [];
  text_decoration_line_values.forEach((value, pos) => {
    const action = app.actions.win.lookup_action(`text-decoration-line-${value}`);
    if (!action) return;
    let state = action.get_state() ?? false;
    if (pos === position) {
      state = !state;
      action.change_state(state);
    }
    if (state) out.push(value);
  });
  text_decoration_set_css(app, 'text-decoration-line', out.join(' '));
}

export const raw_data_text_attributes: readonly (readonly [string, string, string, string])[] = [
  ['win.text-decoration-line-underline', N_('Text Underline'), SECTION, N_('Toggle text underline')],
  [
    'win.text-decoration-line-line-through',
    N_('Text Strikethrough'),
    SECTION,
    N_('Toggle text strikethrough'),
  ],
  ['win.text-decoration-line-overline', N_('Text Overline'), SECTION, N_('Toggle text overline')],
];

export function add_actions_text_attributes(app: InkscapeApplication): void {
  text_decoration_line_values.forEach((value, pos) => {
    app.actions.win.add_action_bool(
      `text-decoration-line-${value}`,
      () => text_decoration_line(app, pos),
      false,
    );
  });
  app.get_action_extra_data().add_data(raw_data_text_attributes);
}
