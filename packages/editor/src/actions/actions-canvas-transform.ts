// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-canvas-transform.cpp
/*
 * Actions for transforming the canvas view.
 *
 * Copyright (C) 2020 Tavmjong Bah
 */
import { N_, NC_, Preferences } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { CanvasFlip } from '../canvas-flip.ts';
import type { SPDesktop } from '../desktop.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';

// Only the options that the desktop supports so far.
// TODO: prev/next, snapshot, rotate, flip (the canvas does not rotate yet).
export enum CanvasTransform {
  INK_CANVAS_ZOOM_IN,
  INK_CANVAS_ZOOM_OUT,
  INK_CANVAS_ZOOM_1_1,
  INK_CANVAS_ZOOM_1_2,
  INK_CANVAS_ZOOM_2_1,
  INK_CANVAS_ZOOM_SELECTION,
  INK_CANVAS_ZOOM_DRAWING,
  INK_CANVAS_ZOOM_PAGE,
  INK_CANVAS_ZOOM_PAGE_WIDTH,
  INK_CANVAS_ZOOM_CENTER_PAGE,
  INK_CANVAS_ZOOM_PREV,
  INK_CANVAS_ZOOM_NEXT,
  INK_CANVAS_SNAPSHOT_SET,
  INK_CANVAS_SNAPSHOT_TOGGLE,
  INK_CANVAS_ROTATE_CW,
  INK_CANVAS_ROTATE_CCW,
  INK_CANVAS_ROTATE_RESET,
  INK_CANVAS_FLIP_HORIZONTAL,
  INK_CANVAS_FLIP_VERTICAL,
  INK_CANVAS_FLIP_RESET,
}

/** Upstream getDoubleLimited: def if the value is outside [min, max]. */
export function getDoubleLimited(path: string, def: number, min: number, max: number): number {
  const v = Preferences.get().getDouble(path, def);
  return v >= min && v <= max ? v : def;
}

/** Run a canvas transform option on dt. */
export function canvas_transform(dt: SPDesktop, option: CanvasTransform): void {
  const zoom_inc = getDoubleLimited('/options/zoomincrement/value', Math.SQRT2, 1.01, 10);
  // Midpoint of drawing on canvas.
  const midpoint = dt.w2d(dt.getCanvas().get_area_world().midpoint());
  const rotate_inc = (getDoubleLimited('/options/rotateincrement/value', 15, 1, 90) * Math.PI) / 180;
  const prefs = Preferences.get();

  switch (option) {
    case CanvasTransform.INK_CANVAS_ZOOM_IN:
      // TODO: zoom around the end of an unfinished path (pen and pencil tools).
      dt.zoom_relative(midpoint, zoom_inc, false);
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_OUT:
      dt.zoom_relative(midpoint, 1.0 / zoom_inc, false); // zoom_inc > 1
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_1_1:
      dt.zoom_realworld(midpoint, 1.0);
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_1_2:
      dt.zoom_realworld(midpoint, 0.5);
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_2_1:
      dt.zoom_realworld(midpoint, 2.0);
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_SELECTION:
      dt.zoom_selection();
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_DRAWING:
      dt.zoom_drawing();
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_PAGE:
      dt.zoom_page();
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_PAGE_WIDTH:
      dt.zoom_page_width();
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_CENTER_PAGE:
      dt.center_page();
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_PREV:
      dt.prev_transform();
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_NEXT:
      dt.next_transform(); // Is this only zoom? Yes!
      break;
    case CanvasTransform.INK_CANVAS_SNAPSHOT_SET:
      prefs.setDouble('/options/snapshot/zoom/value', dt.current_zoom());
      prefs.setDouble('/options/snapshot/angle/value', dt.current_rotation());
      prefs.setString(
        '/options/snapshot/pointbase/value',
        `${dt.getCanvas().get_pos().x},${dt.getCanvas().get_pos().y}`,
      );
      prefs.setString('/options/snapshot/midpoint/value', `${midpoint.x},${midpoint.y}`);
      prefs.setBool('/options/snapshot/toggled/value', false);
      break;
    case CanvasTransform.INK_CANVAS_SNAPSHOT_TOGGLE: {
      const point = (path: string) => {
        const [x, y] = prefs.getString(path).split(',').map(Number);
        return new Point(x ?? 0, y ?? 0);
      };
      if (prefs.getDouble('/options/snapshot/zoom/value', 0) === 0) break;
      const mid = point('/options/snapshot/midpoint/value');
      const angle = prefs.getDouble('/options/snapshot/angle/value');
      const zoom = prefs.getDouble('/options/snapshot/zoom/value');
      if (
        prefs.getBool('/options/snapshot/toggled/value', false) &&
        dt.current_center().sub(mid).length() < 4 &&
        Math.abs(dt.current_zoom() - zoom) < 1 &&
        Math.abs(dt.current_rotation() - angle) < 1
      ) {
        prefs.setBool('/options/snapshot/toggled/value', false);
        dt.prev_transform();
        dt.prev_transform();
        dt.scroll_absolute(point('/options/snapshot/pointbase/value'));
        break;
      }
      prefs.setBool('/options/snapshot/toggled/value', true);
      const base = dt.getCanvas().get_pos();
      prefs.setString('/options/snapshot/pointbase/value', `${base.x},${base.y}`);
      dt.rotate_absolute_center_point(mid, angle);
      dt.zoom_absolute(mid, zoom, true);
      break;
    }
    case CanvasTransform.INK_CANVAS_ROTATE_CW:
      dt.rotate_relative_center_point(midpoint, rotate_inc);
      break;
    case CanvasTransform.INK_CANVAS_ROTATE_CCW:
      dt.rotate_relative_center_point(midpoint, -rotate_inc);
      break;
    case CanvasTransform.INK_CANVAS_ROTATE_RESET:
      dt.rotate_absolute_center_point(midpoint, 0);
      break;
    case CanvasTransform.INK_CANVAS_FLIP_HORIZONTAL:
      dt.flip_relative_center_point(midpoint, CanvasFlip.FLIP_HORIZONTAL);
      break;
    case CanvasTransform.INK_CANVAS_FLIP_VERTICAL:
      dt.flip_relative_center_point(midpoint, CanvasFlip.FLIP_VERTICAL);
      break;
    case CanvasTransform.INK_CANVAS_FLIP_RESET:
      dt.flip_absolute_center_point(midpoint, CanvasFlip.FLIP_NONE);
      break;
  }
}

/** Action ids (without the "win." prefix) and their options. */
export const canvas_transform_actions: ReadonlyArray<readonly [string, CanvasTransform]> = [
  ['canvas-zoom-in', CanvasTransform.INK_CANVAS_ZOOM_IN],
  ['canvas-zoom-out', CanvasTransform.INK_CANVAS_ZOOM_OUT],
  ['canvas-zoom-1-1', CanvasTransform.INK_CANVAS_ZOOM_1_1],
  ['canvas-zoom-1-2', CanvasTransform.INK_CANVAS_ZOOM_1_2],
  ['canvas-zoom-2-1', CanvasTransform.INK_CANVAS_ZOOM_2_1],
  ['canvas-zoom-selection', CanvasTransform.INK_CANVAS_ZOOM_SELECTION],
  ['canvas-zoom-drawing', CanvasTransform.INK_CANVAS_ZOOM_DRAWING],
  ['canvas-zoom-page', CanvasTransform.INK_CANVAS_ZOOM_PAGE],
  ['canvas-zoom-page-width', CanvasTransform.INK_CANVAS_ZOOM_PAGE_WIDTH],
  ['canvas-zoom-center-page', CanvasTransform.INK_CANVAS_ZOOM_CENTER_PAGE],
  ['canvas-zoom-prev', CanvasTransform.INK_CANVAS_ZOOM_PREV],
  ['canvas-zoom-next', CanvasTransform.INK_CANVAS_ZOOM_NEXT],
  ['canvas-snapshot-set', CanvasTransform.INK_CANVAS_SNAPSHOT_SET],
  ['canvas-snapshot-toggle', CanvasTransform.INK_CANVAS_SNAPSHOT_TOGGLE],
  ['canvas-rotate-cw', CanvasTransform.INK_CANVAS_ROTATE_CW],
  ['canvas-rotate-ccw', CanvasTransform.INK_CANVAS_ROTATE_CCW],
  ['canvas-rotate-reset', CanvasTransform.INK_CANVAS_ROTATE_RESET],
  ['canvas-flip-horizontal', CanvasTransform.INK_CANVAS_FLIP_HORIZONTAL],
  ['canvas-flip-vertical', CanvasTransform.INK_CANVAS_FLIP_VERTICAL],
  ['canvas-flip-reset', CanvasTransform.INK_CANVAS_FLIP_RESET],
];

const SECTION = NC_('Action Section', 'Canvas Geometry');

/** Action id, label, section and tooltip of the canvas transform actions (untranslated). */
export const raw_data_canvas_transform: readonly (readonly [string, string, string, string])[] = [
  ['win.canvas-zoom-in', N_('Zoom In'), SECTION, N_('Zoom in')],
  ['win.canvas-zoom-out', N_('Zoom Out'), SECTION, N_('Zoom out')],
  ['win.canvas-zoom-1-1', N_('Zoom 1:1'), SECTION, N_('Zoom to 1:1')],
  ['win.canvas-zoom-1-2', N_('Zoom 1:2'), SECTION, N_('Zoom to 1:2')],
  ['win.canvas-zoom-2-1', N_('Zoom 2:1'), SECTION, N_('Zoom to 2:1')],
  ['win.canvas-zoom-selection', N_('Zoom Selection'), SECTION, N_('Zoom to fit selection in window')],
  ['win.canvas-zoom-drawing', N_('Zoom Drawing'), SECTION, N_('Zoom to fit drawing in window')],
  ['win.canvas-zoom-page', N_('Zoom Page'), SECTION, N_('Zoom to fit page in window')],
  ['win.canvas-zoom-page-width', N_('Zoom Page Width'), SECTION, N_('Zoom to fit page width in window')],
  ['win.canvas-zoom-center-page', N_('Center Page'), SECTION, N_('Center page in window')],
  [
    'win.canvas-zoom-prev',
    N_('Zoom Prev'),
    SECTION,
    N_('Go back to previous zoom (from the history of zooms)'),
  ],
  ['win.canvas-zoom-next', N_('Zoom Next'), SECTION, N_('Go to next zoom (from the history of zooms)')],
  ['win.canvas-snapshot-set', N_('Take Snapshot'), SECTION, N_('Take canvas snapshot')],
  ['win.canvas-snapshot-toggle', N_('Toggle Snapshot'), SECTION, N_('Toggle canvas snapshot')],
  ['win.canvas-rotate-cw', N_('Rotate Clockwise'), SECTION, N_('Rotate canvas clockwise')],
  ['win.canvas-rotate-ccw', N_('Rotate Counter-CW'), SECTION, N_('Rotate canvas counter-clockwise')],
  ['win.canvas-rotate-reset', N_('Reset Rotation'), SECTION, N_('Reset canvas rotation')],
  ['win.canvas-flip-horizontal', N_('Flip Horizontal'), SECTION, N_('Flip canvas horizontally')],
  ['win.canvas-flip-vertical', N_('Flip Vertical'), SECTION, N_('Flip canvas vertically')],
  ['win.canvas-flip-reset', N_('Reset Flipping'), SECTION, N_('Reset canvas flipping')],
  [
    'win.canvas-rotate-absolute-radians',
    N_('Rotate Absolute (Radians)'),
    SECTION,
    N_('Rotate to an absolute value (radians)'),
  ],
  [
    'win.canvas-rotate-relative-radians',
    N_('Rotate Relative (Radians)'),
    SECTION,
    N_('Rotate by a relative amount (radians)'),
  ],
  [
    'win.canvas-rotate-absolute-degrees',
    N_('Rotate Absolute (Degrees)'),
    SECTION,
    N_('Rotate to an absolute value (degrees)'),
  ],
  [
    'win.canvas-rotate-relative-degrees',
    N_('Rotate Relative (Degrees)'),
    SECTION,
    N_('Rotate by a relative amount (degrees)'),
  ],
  ['win.canvas-rotate-lock', N_('Lock Rotation'), SECTION, N_('Lock canvas rotation')],
  ['win.canvas-zoom-absolute', N_('Zoom Absolute'), SECTION, N_('Zoom to an absolute value')],
  ['win.canvas-zoom-relative', N_('Zoom Relative'), SECTION, N_('Zoom by a relative amount')],
];

/** Register the win.canvas-zoom-* actions. */
export function add_actions_canvas_transform(app: InkscapeApplication): void {
  for (const [name, option] of canvas_transform_actions) {
    app.actions.win.add_action(name, () => {
      const dt = app.get_active_desktop();
      if (dt) canvas_transform(dt, option);
    });
  }
  app.actions.win.add_action_with_parameter('canvas-zoom-absolute', 'd', (value) => {
    const dt = app.get_active_desktop();
    if (!dt) return;
    if (Preferences.get().getDouble('/options/zoomcorrection/shown', 1))
      dt.zoom_realworld(dt.current_center(), value);
    else dt.zoom_absolute(dt.current_center(), value, false);
  });
  const rotate = (name: string, scale: number, relative: boolean) =>
    app.actions.win.add_action_with_parameter(name, 'd', (value) => {
      const dt = app.get_active_desktop();
      if (!dt) return;
      if (relative) dt.rotate_relative_center_point(dt.current_center(), value * scale);
      else dt.rotate_absolute_center_point(dt.current_center(), value * scale);
    });
  rotate('canvas-rotate-absolute-radians', 1, false);
  rotate('canvas-rotate-relative-radians', 1, true);
  rotate('canvas-rotate-absolute-degrees', Math.PI / 180, false);
  rotate('canvas-rotate-relative-degrees', Math.PI / 180, true);
  const lock = app.actions.win.add_action_bool(
    'canvas-rotate-lock',
    () => {
      const state = !(lock.get_state() ?? false);
      lock.change_state(state);
      // Save value as a preference
      Preferences.get().setBool('/options/rotationlock', state);
      const dt = app.get_active_desktop();
      if (dt) dt.rotation_lock = state;
    },
    Preferences.get().getBool('/options/rotationlock'),
  );
  app.actions.win.add_action_with_parameter('canvas-zoom-relative', 'd', (value) => {
    const dt = app.get_active_desktop();
    dt?.zoom_relative(dt.current_center(), value);
  });
  app.get_action_extra_data().add_data(raw_data_canvas_transform);
}
