// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-canvas-transform.cpp
/*
 * Actions for transforming the canvas view.
 *
 * Copyright (C) 2020 Tavmjong Bah
 */
import { N_, NC_, Preferences } from '@inkscape-web/core';
import type { SPDesktop } from '../desktop.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';

// Only the options that the desktop supports so far.
// TODO: prev/next, snapshot, rotate, flip.
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
];

/** Register the win.canvas-zoom-* actions. */
export function add_actions_canvas_transform(app: InkscapeApplication): void {
  for (const [name, option] of canvas_transform_actions) {
    app.actions.win.add_action(name, () => {
      const dt = app.get_active_desktop();
      if (dt) canvas_transform(dt, option);
    });
  }
  app.get_action_extra_data().add_data(raw_data_canvas_transform);
}
