// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-transform.cpp, src/actions/actions-transform.h
/*
 * Gio::Actions for selection tied to the application and without GUI.
 *
 * Copyright (C) 2018 Tavmjong Bah
 */
import { N_, NC_ } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';

const SECTION = NC_('Action Section', 'Transform');

/** Action id, label, section and tooltip (untranslated). TODO: translate, scale, grow, remove, reapply, … */
export const raw_data_transform: readonly (readonly [string, string, string, string])[] = [
  ['app.transform-rotate', N_('Rotate'), SECTION, N_('Rotate selected objects')],
  [
    'app.transform-rotate(90.0)',
    N_('Rotate Object 90°'),
    SECTION,
    N_('Rotate selected objects 90° clockwise'),
  ],
  [
    'app.transform-rotate(-90.0)',
    N_('Rotate Object 90° CCW'),
    SECTION,
    N_('Rotate selected objects 90° counter-clockwise'),
  ],
];

export function add_actions_transform(app: InkscapeApplication): void {
  app.actions.app.add_action_with_parameter('transform-rotate', 'd', (angle) => {
    const selection = app.get_active_selection();
    const doc = app.get_active_document();
    if (selection && doc) selection.rotateAnchored(angle * doc.yaxisdir());
  });
  app.get_action_extra_data().add_data(raw_data_transform);
}
