// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-paths.cpp, src/actions/actions-paths.h
/*
 * Gio::Actions for Path Actions
 *
 * Copyright (C) 2021 Sushant A.A.
 */
import {
  breakApart,
  combine,
  N_,
  NC_,
  type ObjectSet,
  pathCut,
  pathDiff,
  pathIntersect,
  pathSlice,
  pathSymDiff,
  pathUnion,
} from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';

/**
 * The app.path-* actions by name, without the "app." prefix. They work on
 * the selection and need the path boolop backend (setPathBoolopBackend).
 * TODO: removeLPESRecursive and unlinkRecursive before the operations,
 * the other path actions (fracture, flatten, simplify, offsets, ...).
 */
export const path_actions: Readonly<Record<string, (selection: ObjectSet) => void>> = {
  'path-union': (s) => pathUnion(s),
  'path-difference': (s) => pathDiff(s),
  'path-intersection': (s) => pathIntersect(s),
  'path-exclusion': (s) => pathSymDiff(s),
  'path-division': (s) => pathCut(s),
  'path-cut': (s) => pathSlice(s),
  'path-combine': (s) => combine(s),
  'path-break-apart': (s) => breakApart(s),
  'path-split': (s) => breakApart(s, false, false),
};

const SECTION = NC_('Action Section', 'Path');

/** Action id, label, section and tooltip of the path actions (untranslated). */
export const raw_data_path: readonly (readonly [string, string, string, string])[] = [
  ['app.path-union', N_('Union'), SECTION, N_('Create union of selected paths')],
  [
    'app.path-difference',
    N_('Difference'),
    SECTION,
    N_('Create difference of selected paths (bottom minus top)'),
  ],
  ['app.path-intersection', N_('Intersection'), SECTION, N_('Create intersection of selected paths')],
  [
    'app.path-exclusion',
    N_('Exclusion'),
    SECTION,
    N_('Create exclusive OR of selected paths (those parts that belong to only one path)'),
  ],
  ['app.path-division', N_('Division'), SECTION, N_('Cut the bottom path into pieces')],
  ['app.path-cut', N_('Cut Path'), SECTION, N_("Cut the bottom path's stroke into pieces, removing fill")],
  ['app.path-combine', N_('Combine'), SECTION, N_('Combine several paths into one')],
  ['app.path-break-apart', N_('Break Apart'), SECTION, N_('Break selected paths into subpaths')],
  ['app.path-split', N_('Split Apart'), SECTION, N_('Split selected paths into non-overlapping sections')],
];

/** Register the app.path-* actions. */
export function add_actions_path(app: InkscapeApplication): void {
  for (const [name, run] of Object.entries(path_actions)) {
    app.actions.app.add_action(name, () => {
      const selection = app.get_active_selection();
      if (selection) run(selection);
    });
  }
  app.get_action_extra_data().add_data(raw_data_path);
}
