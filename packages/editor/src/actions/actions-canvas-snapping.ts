// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-canvas-snapping.cpp, src/actions/actions-canvas-snapping.h
/*
 * Gio::Actions for toggling snapping preferences. Not tied to a particular document.
 *
 * Copyright (C) 2019 Tavmjong Bah
 */
import { N_, NC_, Preferences, SimpleSnap, SnapPreferences, SnapTargetType as T } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';
import type { ActionMap } from './action-map.ts';

// There are two snapping lists that must be connected:
// 1. The Inkscape::SNAPTARGET value:  e.g. Inkscape::SNAPTARGET_BBOX_CATEGORY.
// 2. The Gio::Action name:            e.g. "snap-bbox"

interface SnapInfo {
  /** action name without "win." prefix */
  action_name: string;
  /** corresponding snapping type */
  type: T;
  /** default for when "simple snapping" is ON and also initial value when preferences are deleted */
  set: boolean;
}

const snap_bbox: SnapInfo[] = [
  { action_name: 'snap-bbox', type: T.SNAPTARGET_BBOX_CATEGORY, set: true },
  { action_name: 'snap-bbox-edge', type: T.SNAPTARGET_BBOX_EDGE, set: true },
  { action_name: 'snap-bbox-corner', type: T.SNAPTARGET_BBOX_CORNER, set: true },
  { action_name: 'snap-bbox-edge-midpoint', type: T.SNAPTARGET_BBOX_EDGE_MIDPOINT, set: false },
  { action_name: 'snap-bbox-center', type: T.SNAPTARGET_BBOX_MIDPOINT, set: false },
];

const snap_node: SnapInfo[] = [
  { action_name: 'snap-node-category', type: T.SNAPTARGET_NODE_CATEGORY, set: true },
  { action_name: 'snap-path', type: T.SNAPTARGET_PATH, set: true },
  // Note: OFF by default, as it is extremely slow in large documents!
  { action_name: 'snap-path-intersection', type: T.SNAPTARGET_PATH_INTERSECTION, set: false },
  { action_name: 'snap-node-cusp', type: T.SNAPTARGET_NODE_CUSP, set: true },
  { action_name: 'snap-node-smooth', type: T.SNAPTARGET_NODE_SMOOTH, set: true },
  { action_name: 'snap-line-midpoint', type: T.SNAPTARGET_LINE_MIDPOINT, set: true },
  { action_name: 'snap-line-tangential', type: T.SNAPTARGET_PATH_TANGENTIAL, set: false },
  { action_name: 'snap-line-perpendicular', type: T.SNAPTARGET_PATH_PERPENDICULAR, set: false },
];

const snap_alignment: SnapInfo[] = [
  { action_name: 'snap-alignment', type: T.SNAPTARGET_ALIGNMENT_CATEGORY, set: true },
  { action_name: 'snap-alignment-self', type: T.SNAPTARGET_ALIGNMENT_HANDLE, set: false },
  // separate category:
  { action_name: 'snap-distribution', type: T.SNAPTARGET_DISTRIBUTION_CATEGORY, set: true },
];

const snap_all_the_rest: SnapInfo[] = [
  { action_name: 'snap-others', type: T.SNAPTARGET_OTHERS_CATEGORY, set: true },
  { action_name: 'snap-object-midpoint', type: T.SNAPTARGET_OBJECT_MIDPOINT, set: false },
  { action_name: 'snap-rotation-center', type: T.SNAPTARGET_ROTATION_CENTER, set: false },
  { action_name: 'snap-text-baseline', type: T.SNAPTARGET_TEXT_BASELINE, set: true },
  { action_name: 'snap-path-mask', type: T.SNAPTARGET_PATH_MASK, set: true },
  { action_name: 'snap-path-clip', type: T.SNAPTARGET_PATH_CLIP, set: true },
  { action_name: 'snap-page-border', type: T.SNAPTARGET_PAGE_EDGE_BORDER, set: true },
  { action_name: 'snap-page-margin', type: T.SNAPTARGET_PAGE_MARGIN_BORDER, set: true },
  { action_name: 'snap-grid', type: T.SNAPTARGET_GRID, set: true },
  { action_name: 'snap-grid-line', type: T.SNAPTARGET_GRID_LINE, set: true },
  { action_name: 'snap-guide', type: T.SNAPTARGET_GUIDE, set: true },
];

const simple_snap_options: { action_name: string; option: SimpleSnap; set: boolean }[] = [
  { action_name: 'simple-snap-bbox', option: SimpleSnap.BBox, set: true },
  { action_name: 'simple-snap-nodes', option: SimpleSnap.Nodes, set: true },
  { action_name: 'simple-snap-alignment', option: SimpleSnap.Alignment, set: false },
];

const snap_vect: SnapInfo[] = [...snap_bbox, ...snap_node, ...snap_alignment, ...snap_all_the_rest];
const snap_map = new Map(snap_vect.map((info) => [info.type, info.action_name]));

const snap_pref_path = '/options/snapping/';
const global_toggle = 'snap-global-toggle';

let preferences: SnapPreferences | null = null;

/** The global and single location of the snapping preferences, read from the preferences at first use. */
export function get_snapping_preferences(): SnapPreferences {
  if (preferences) return preferences;
  preferences = new SnapPreferences();
  // after starting up restore all snapping preferences:
  const prefs = Preferences.get();
  for (const info of snap_vect) {
    preferences.setTargetSnappable(info.type, prefs.getBool(snap_pref_path + info.action_name, info.set));
  }
  for (const info of simple_snap_options) {
    preferences.set_simple_snap(info.option, prefs.getBool(snap_pref_path + info.action_name, info.set));
  }
  preferences.setSnapEnabledGlobally(prefs.getBool(snap_pref_path + global_toggle, false));
  return preferences;
}

/** Forget the snapping preferences, so that they are read again (for tests). */
export function reset_snapping_preferences(): void {
  preferences = null;
}

function store_snapping_action(action_name: string, enabled: boolean): void {
  Preferences.get().setBool(snap_pref_path + action_name, enabled);
}

/** Turn the snap target type on or off, and store it in the preferences. */
export function set_canvas_snapping(type: T, enabled: boolean): void {
  get_snapping_preferences().setTargetSnappable(type, enabled);
  const action_name = snap_map.get(type);
  if (action_name === undefined) console.warn(`No action for snap target type ${type}`);
  else store_snapping_action(action_name, enabled);
}

/** Turn snapping on or off globally (the % key). */
export function set_snapping_globally(enabled: boolean): void {
  get_snapping_preferences().setSnapEnabledGlobally(enabled);
  store_snapping_action(global_toggle, enabled);
}

function canvas_snapping_toggle(type: T): void {
  const enabled = get_snapping_preferences().isSnapButtonEnabled(type);
  set_canvas_snapping(type, !enabled);
}

/** Turn a "simple snapping" group on or off: its targets get their simple defaults, or off. */
export function set_simple_snap(option: SimpleSnap, value: boolean): void {
  const vect =
    option === SimpleSnap.BBox
      ? snap_bbox
      : option === SimpleSnap.Nodes
        ? snap_node
        : option === SimpleSnap.Alignment
          ? snap_alignment
          : snap_all_the_rest;
  for (const info of vect) set_canvas_snapping(info.type, value && info.set);
  // simple snap option 'Rest' does not have an action; only save other ones
  const action_name = simple_snap_options.find((info) => info.option === option)?.action_name;
  if (action_name) {
    get_snapping_preferences().set_simple_snap(option, value);
    Preferences.get().setBool(snap_pref_path + action_name, value);
  }
}

function toggle_simple_snap_option(option: SimpleSnap): void {
  // toggle desired option
  set_simple_snap(option, !get_snapping_preferences().get_simple_snap(option));
  // reset others not visible / not exposed to their "simple" defaults
  for (const info of snap_all_the_rest) set_canvas_snapping(info.type, info.set);
}

const SECTION = NC_('Action Section', 'Snap');

/** Action id, label, section and tooltip of the snapping actions (untranslated). */
export const raw_data_canvas_snapping: readonly (readonly [string, string, string, string])[] = [
  ['win.snap-global-toggle', N_('Snapping'), SECTION, N_('Toggle snapping on/off')],
  ['win.snap-alignment', N_('Snap Objects that Align'), SECTION, N_('Toggle alignment snapping')],
  [
    'win.snap-alignment-self',
    N_('Snap Nodes that Align'),
    SECTION,
    N_('Toggle alignment snapping to nodes in the same path'),
  ],
  [
    'win.snap-distribution',
    N_('Snap Objects at Equal Distances'),
    SECTION,
    N_('Toggle snapping objects at equal distances'),
  ],
  ['win.snap-bbox', N_('Snap Bounding Boxes'), SECTION, N_('Toggle snapping to bounding boxes (global)')],
  ['win.snap-bbox-edge', N_('Snap Bounding Box Edges'), SECTION, N_('Toggle snapping to bounding-box edges')],
  [
    'win.snap-bbox-corner',
    N_('Snap Bounding Box Corners'),
    SECTION,
    N_('Toggle snapping to bounding-box corners'),
  ],
  [
    'win.snap-bbox-edge-midpoint',
    N_('Snap Bounding Box Edge Midpoints'),
    SECTION,
    N_('Toggle snapping to bounding-box edge mid-points'),
  ],
  [
    'win.snap-bbox-center',
    N_('Snap Bounding Box Centers'),
    SECTION,
    N_('Toggle snapping to bounding-box centers'),
  ],
  ['win.snap-node-category', N_('Snap Nodes'), SECTION, N_('Toggle snapping to nodes (global)')],
  ['win.snap-path', N_('Snap Paths'), SECTION, N_('Toggle snapping to paths')],
  [
    'win.snap-path-intersection',
    N_('Snap Path Intersections'),
    SECTION,
    N_('Toggle snapping to path intersections'),
  ],
  [
    'win.snap-node-cusp',
    N_('Snap Cusp Nodes'),
    SECTION,
    N_('Toggle snapping to cusp nodes, including rectangle corners'),
  ],
  [
    'win.snap-node-smooth',
    N_('Snap Smooth Node'),
    SECTION,
    N_('Toggle snapping to smooth nodes, including quadrant points of ellipses'),
  ],
  ['win.snap-line-midpoint', N_('Snap Line Midpoints'), SECTION, N_('Toggle snapping to midpoints of lines')],
  [
    'win.snap-line-perpendicular',
    N_('Snap Perpendicular Lines'),
    SECTION,
    N_('Toggle snapping to perpendicular lines'),
  ],
  [
    'win.snap-line-tangential',
    N_('Snap Tangential Lines'),
    SECTION,
    N_('Toggle snapping to tangential lines'),
  ],
  ['win.snap-others', N_('Snap Others'), SECTION, N_('Toggle snapping to misc. points (global)')],
  ['win.snap-object-midpoint', N_('Snap Object Midpoint'), SECTION, N_('Toggle snapping to object midpoint')],
  [
    'win.snap-rotation-center',
    N_('Snap Rotation Center'),
    SECTION,
    N_('Toggle snapping to object rotation center'),
  ],
  [
    'win.snap-text-baseline',
    N_('Snap Text Baselines'),
    SECTION,
    N_('Toggle snapping to text baseline and text anchors'),
  ],
  ['win.snap-page-border', N_('Snap Page Border'), SECTION, N_('Toggle snapping to page border')],
  ['win.snap-page-margin', N_('Snap Page Margin'), SECTION, N_('Toggle snapping to page margin')],
  ['win.snap-grid', N_('Snap Grids'), SECTION, N_('Toggle snapping to grids')],
  ['win.snap-grid-line', N_('Snap Grid Lines'), SECTION, N_('Toggle snapping to grid lines')],
  ['win.snap-guide', N_('Snap Guide Lines'), SECTION, N_('Toggle snapping to guide lines')],
  ['win.snap-path-mask', N_('Snap Mask Paths'), SECTION, N_('Toggle snapping to mask paths')],
  ['win.snap-path-clip', N_('Snap Clip Paths'), SECTION, N_('Toggle snapping to clip paths')],
  ['win.simple-snap-bbox', N_('Simple Snap Bounding Box'), SECTION, N_('Toggle snapping to bounding boxes')],
  ['win.simple-snap-nodes', N_('Simple Snap Nodes'), SECTION, N_('Toggle snapping to nodes')],
  ['win.simple-snap-alignment', N_('Simple Snap Alignment'), SECTION, N_('Toggle alignment snapping')],
];

/** Update the state and the enabled state of all snapping actions (some actions depend on others). */
export function set_actions_canvas_snapping(map: ActionMap): void {
  const snapprefs = get_snapping_preferences();
  const global = snapprefs.getSnapEnabledGlobally();
  const alignment = snapprefs.isTargetSnappable(T.SNAPTARGET_ALIGNMENT_CATEGORY);
  const distribution = snapprefs.isTargetSnappable(T.SNAPTARGET_DISTRIBUTION_CATEGORY);
  const bbox = snapprefs.isTargetSnappable(T.SNAPTARGET_BBOX_CATEGORY);
  const node = snapprefs.isTargetSnappable(T.SNAPTARGET_NODE_CATEGORY);
  const other = snapprefs.isTargetSnappable(T.SNAPTARGET_OTHERS_CATEGORY);
  const grid = snapprefs.isTargetSnappable(T.SNAPTARGET_GRID);
  const button = (t: T) => snapprefs.isSnapButtonEnabled(t);

  const snap_options: [string, boolean, boolean][] = [
    ['snap-global-toggle', global, true], // Always enabled
    ['snap-alignment', alignment, global],
    ['snap-alignment-self', button(T.SNAPTARGET_ALIGNMENT_HANDLE), global && alignment],
    ['snap-distribution', distribution, global && alignment],
    ['snap-bbox', bbox, global],
    ['snap-bbox-edge', button(T.SNAPTARGET_BBOX_EDGE), global && bbox],
    ['snap-bbox-corner', button(T.SNAPTARGET_BBOX_CORNER), global && bbox],
    ['snap-bbox-edge-midpoint', button(T.SNAPTARGET_BBOX_EDGE_MIDPOINT), global && bbox],
    ['snap-bbox-center', button(T.SNAPTARGET_BBOX_MIDPOINT), global && bbox],
    ['snap-node-category', node, global],
    ['snap-path', button(T.SNAPTARGET_PATH), global && node],
    ['snap-path-intersection', button(T.SNAPTARGET_PATH_INTERSECTION), global && node],
    ['snap-node-cusp', button(T.SNAPTARGET_NODE_CUSP), global && node],
    ['snap-node-smooth', button(T.SNAPTARGET_NODE_SMOOTH), global && node],
    ['snap-line-midpoint', button(T.SNAPTARGET_LINE_MIDPOINT), global && node],
    ['snap-line-tangential', button(T.SNAPTARGET_PATH_TANGENTIAL), global && node],
    ['snap-line-perpendicular', button(T.SNAPTARGET_PATH_PERPENDICULAR), global && node],
    ['snap-others', other, global],
    ['snap-object-midpoint', button(T.SNAPTARGET_OBJECT_MIDPOINT), global && other],
    ['snap-rotation-center', button(T.SNAPTARGET_ROTATION_CENTER), global && other],
    ['snap-text-baseline', button(T.SNAPTARGET_TEXT_BASELINE), global && other],
    ['snap-path-clip', button(T.SNAPTARGET_PATH_CLIP), global && other],
    ['snap-path-mask', button(T.SNAPTARGET_PATH_MASK), global && other],
    ['snap-page-border', button(T.SNAPTARGET_PAGE_EDGE_BORDER), global],
    ['snap-page-margin', button(T.SNAPTARGET_PAGE_MARGIN_BORDER), global],
    ['snap-grid', button(T.SNAPTARGET_GRID), global],
    ['snap-grid-line', button(T.SNAPTARGET_GRID_LINE), global && grid],
    ['snap-guide', button(T.SNAPTARGET_GUIDE), global],
    ['simple-snap-bbox', bbox, global],
    ['simple-snap-nodes', node, global],
    ['simple-snap-alignment', alignment, global],
  ];
  for (const [name, state, enabled] of snap_options) {
    const action = map.lookup_action(name);
    if (!action) {
      console.warn(`set_actions_canvas_snapping_helper: action ${name} missing!`);
      continue;
    }
    action.change_state(state);
    action.set_enabled(enabled);
  }
}

/** Register the win.snap-* and win.simple-snap-* actions. */
export function add_actions_canvas_snapping(app: InkscapeApplication): void {
  const map = app.actions.win;
  // Some actions depend on others... we need to update everything!
  const update_actions = () => set_actions_canvas_snapping(map);
  map.add_action_bool(global_toggle, () => {
    set_snapping_globally(!get_snapping_preferences().getSnapEnabledGlobally());
    update_actions();
  });
  for (const info of snap_vect) {
    map.add_action_bool(info.action_name, () => {
      canvas_snapping_toggle(info.type);
      update_actions();
    });
  }
  // Simple snapping popover
  for (const info of simple_snap_options) {
    map.add_action_bool(info.action_name, () => {
      toggle_simple_snap_option(info.option);
      update_actions();
    });
  }
  app.get_action_extra_data().add_data(raw_data_canvas_snapping);
  update_actions();
}
