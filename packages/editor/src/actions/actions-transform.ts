// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-transform.cpp, src/actions/actions-transform.h
/*
 * Gio::Actions for selection tied to the application and without GUI.
 *
 * Copyright (C) 2018 Tavmjong Bah
 */
import { C_, DocumentUndo, N_, NC_, Preferences } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';

const SECTION = NC_('Action Section', 'Transform');

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_transform: readonly (readonly [string, string, string, string])[] = [
  ['app.transform-translate', N_('Translate'), SECTION, N_('Translate selected objects (dx,dy)')],
  ['app.transform-rotate', N_('Rotate'), SECTION, N_('Rotate selected objects by degrees')],
  ['app.transform-scale', N_('Scale'), SECTION, N_('Scale selected objects by scale factor')],
  ['app.transform-grow', N_('Grow/Shrink'), SECTION, N_('Grow/shrink selected objects')],
  [
    'app.transform-grow-step',
    N_('Grow/Shrink Step'),
    SECTION,
    N_('Grow/shrink selected objects by multiple of step value'),
  ],
  [
    'win.transform-grow-screen',
    N_('Grow/Shrink Screen'),
    SECTION,
    N_('Grow/shrink selected objects relative to zoom level'),
  ],
  ['app.transform-rotate', N_('Rotate'), SECTION, N_('Rotate selected objects')],
  [
    'app.transform-rotate-step',
    N_('Rotate Step'),
    SECTION,
    N_('Rotate selected objects by multiple of step value'),
  ],
  [
    'win.transform-rotate-screen',
    N_('Rotate Screen'),
    SECTION,
    N_('Rotate selected objects relative to zoom level'),
  ],
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
  [
    'app.transform-remove',
    N_('Remove Transforms'),
    SECTION,
    N_('Remove any transforms from selected objects'),
  ],
  [
    'app.transform-reapply',
    N_('Reapply Transforms'),
    SECTION,
    N_('Reapply the last transformation to the selection'),
  ],
  ['app.page-rotate', N_('Rotate Page 90°'), SECTION, N_('Rotate page by 90-degree rotation steps')],
];

/** The window actions of upstream add_actions_transform(InkscapeWindow*): they need the zoom. */
export function add_actions_transform_window(app: InkscapeApplication): void {
  app.actions.win.add_action_with_parameter('transform-grow-screen', 'd', (scale) => {
    const desktop = app.get_active_desktop();
    desktop?.getSelection().scaleAnchored(scale / desktop.current_zoom());
  });
  app.actions.win.add_action_with_parameter('transform-rotate-screen', 'd', (angle) => {
    const desktop = app.get_active_desktop();
    if (!desktop) return;
    desktop.getSelection().rotateAnchored(angle * desktop.yaxisdir(), desktop.current_zoom());
  });
}

export function add_actions_transform(app: InkscapeApplication): void {
  const app_actions = app.actions.app;
  app_actions.add_action_with_parameter('transform-translate', 's', (value) => {
    const tokens = value.split(',');
    const [dx, dy] = tokens.map((t) => (t.trim() === '' ? Number.NaN : Number(t)));
    if (tokens.length !== 2 || dx === undefined || dy === undefined || Number.isNaN(dx) || Number.isNaN(dy)) {
      console.warn('action:transform-translate: requires two comma separated numbers');
      return;
    }
    app.get_active_selection()?.move(dx, dy);
    // Needed to update repr (is this the best way?).
    const doc = app.get_active_document();
    if (doc) DocumentUndo.done(doc, C_('Undo', 'Translate'), '');
  });
  app_actions.add_action_with_parameter('transform-rotate', 'd', (angle) => {
    const selection = app.get_active_selection();
    const doc = app.get_active_document();
    if (selection && doc) selection.rotateAnchored(angle * doc.yaxisdir());
  });
  app_actions.add_action_with_parameter('transform-scale', 'd', (scale) => {
    app.get_active_selection()?.scaleAnchored(scale, false);
  });
  app_actions.add_action_with_parameter('transform-grow', 'd', (scale) => {
    app.get_active_selection()?.scaleAnchored(scale);
  });
  app_actions.add_action_with_parameter('transform-grow-step', 'd', (scale) => {
    const step = Preferences.get().getDoubleLimited('/options/defaultscale/value', 2, 0, 1000);
    app.get_active_selection()?.scaleAnchored(scale * step);
  });
  app_actions.add_action_with_parameter('transform-rotate-step', 'd', (angle) => {
    const selection = app.get_active_selection();
    const doc = app.get_active_document();
    const snaps = Preferences.get().getDoubleLimited('/options/rotationsnapsperpi/value', 12.0, 0.1, 1800.0);
    if (selection && doc) selection.rotateAnchored((angle * doc.yaxisdir()) / snaps);
  });
  app_actions.add_action('transform-remove', () => app.get_active_selection()?.removeTransform());
  app_actions.add_action('transform-reapply', () => {
    const doc = app.get_active_document();
    if (!doc) return;
    app.get_active_selection()?.reapplyAffine();
    DocumentUndo.maybeDone(doc, 'reapply-transform', C_('Undo', 'Reapply Transforms'), 'tool-pointer');
  });
  app_actions.add_action_with_parameter('page-rotate', 'i', (turns) => {
    const doc = app.get_active_document();
    if (!doc) return;
    doc.getPageManager().rotatePage(turns);
    DocumentUndo.done(doc, C_('Undo', 'Rotate Page'), 'tool-pages');
  });
  add_actions_transform_window(app);
  app.get_action_extra_data().add_data(raw_data_transform);
}
