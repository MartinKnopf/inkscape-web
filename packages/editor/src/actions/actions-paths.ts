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
  Preferences,
  pathCut,
  pathDiff,
  pathFlatten,
  pathFracture,
  pathIntersect,
  pathReverse,
  pathSlice,
  pathSymDiff,
  pathUnion,
  simplifyPaths,
  sp_selected_path_create_offset_object,
  sp_selected_path_inset,
  sp_selected_path_inset_screen,
  sp_selected_path_offset,
  sp_selected_path_offset_screen,
} from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { set_active_tool } from './actions-tools.ts';

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
  'path-fracture': (s) => pathFracture(s),
  'path-flatten': (s) => pathFlatten(s),
  'path-fill-between-paths': (s) => s.fillBetweenMany(),
  'path-simplify': (s) => void simplifyPaths(s),
  'path-inset': (s) => {
    s.unlinkRecursive(true);
    sp_selected_path_inset(s, default_offset_width());
  },
  'path-offset': (s) => {
    s.unlinkRecursive(true);
    sp_selected_path_offset(s, default_offset_width());
  },
};

/** The preference "default offset width" in px. */
function default_offset_width(): number {
  return Preferences.get().getDouble('/options/defaultoffsetwidth/value', 1.0);
}

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
  [
    'app.path-fracture',
    N_('Fracture'),
    SECTION,
    N_('Fracture one or more overlapping objects into all possible segments'),
  ],
  [
    'app.path-flatten',
    NC_('Path flatten', 'Flatten'),
    SECTION,
    N_('Flatten one or more overlapping objects into their visible parts'),
  ],
  [
    'app.path-fill-between-paths',
    N_('Fill between paths'),
    SECTION,
    N_('Create a fill object using the selected paths'),
  ],
  ['app.path-simplify', N_('Simplify'), SECTION, N_('Simplify selected paths (remove extra nodes)')],
  ['app.path-inset', N_('Inset'), SECTION, N_('Inset selected paths')],
  ['app.path-offset', N_('Offset'), SECTION, N_('Offset selected paths')],
  ['win.path-offset-dynamic', N_('Dynamic Offset'), SECTION, N_('Create a dynamic offset object')],
  [
    'win.path-offset-linked',
    N_('Linked Offset'),
    SECTION,
    N_('Create a dynamic offset object linked to the original path'),
  ],
  ['win.path-inset-screen', N_('Inset Screen'), SECTION, N_('Inset selected paths by screen pixels')],
  ['win.path-offset-screen', N_('Offset Screen'), SECTION, N_('Offset selected paths by screen pixels')],
  [
    'win.path-reverse',
    N_('Reverse'),
    SECTION,
    N_('Reverse the direction of selected paths (useful for flipping markers)'),
  ],
];

/** Register the app.path-* actions. */
export function add_actions_path(app: InkscapeApplication): void {
  for (const [name, run] of Object.entries(path_actions)) {
    app.actions.app.add_action(name, () => {
      const selection = app.get_active_selection();
      if (selection) run(selection);
    });
  }
  app.actions.win.add_action('path-reverse', () => {
    const selection = app.get_active_selection();
    if (selection) pathReverse(selection);
  });
  // The screen variants divide the pixels by the zoom of the desktop.
  const screen = (name: string, run: (s: ObjectSet, pixels: number, zoom: number) => void) =>
    app.actions.win.add_action_with_parameter(name, 'd', (pixels) => {
      const dt = app.get_active_desktop();
      const selection = app.get_active_selection();
      if (!dt || !selection) return;
      selection.unlinkRecursive(true);
      run(selection, pixels, dt.current_zoom());
    });
  screen('path-inset-screen', sp_selected_path_inset_screen);
  screen('path-offset-screen', sp_selected_path_offset_screen);
  const dynamic = (name: string, updating: boolean) =>
    app.actions.win.add_action(name, () => {
      const dt = app.get_active_desktop();
      const selection = app.get_active_selection();
      if (!dt || !selection) return;
      selection.unlinkRecursive(true);
      sp_selected_path_create_offset_object(selection, 0, updating, 0);
      set_active_tool(dt, 'Node');
    });
  dynamic('path-offset-dynamic', false);
  dynamic('path-offset-linked', true);
  app.get_action_extra_data().add_data(raw_data_path);
}
