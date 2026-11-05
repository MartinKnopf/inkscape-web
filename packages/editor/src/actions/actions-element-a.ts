// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-element-a.cpp, src/actions/actions-element-a.h
/*
 * Gio::Actions for use with <a> (for anchor or hyper link).
 *
 * Copyright (C) 2022 Tavmjong Bah
 */
import { N_, NC_, SPAnchor } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { show_output } from './actions-helper.ts';

/**
 * Open the link of each selected anchor in a new browser tab (upstream: the default application of
 * the URI). The XML is not modified. The browser may block the tabs of a script without a user gesture.
 */
export function anchor_open_link(app: InkscapeApplication): void {
  const selection = app.get_active_selection();
  if (!selection) return;
  for (const item of selection.items()) {
    if (!(item instanceof SPAnchor) || !item.href) continue;
    try {
      const base = globalThis.location?.href;
      const url = new URL(item.href, base).href;
      if (!globalThis.open?.(url, '_blank', 'noopener,noreferrer')) {
        show_output(`anchor_open_link: cannot open ${item.href}`);
      }
    } catch (e) {
      show_output(`anchor_open_link: cannot open ${item.href} ${e instanceof Error ? e.message : e}`);
    }
  }
}

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_element_a: readonly (readonly [string, string, string, string])[] = [
  [
    'app.element-a-open-link',
    N_('Open link'),
    NC_('Action Section', 'Anchor'),
    N_('Add an anchor to an object.'),
  ],
];

export function add_actions_element_a(app: InkscapeApplication): void {
  app.actions.app.add_action('element-a-open-link', () => anchor_open_link(app));
  app.get_action_extra_data().add_data(raw_data_element_a);
}
