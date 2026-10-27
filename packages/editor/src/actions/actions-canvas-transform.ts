// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-canvas-transform.cpp
/*
 * Actions for transforming the canvas view.
 *
 * Copyright (C) 2020 Tavmjong Bah
 */
import { Preferences } from '@inkscape-web/core';
import type { SPDesktop } from '../desktop.ts';

// Only the options that the desktop supports so far.
// TODO: 1:2, 2:1, selection, page width, center page, prev/next, snapshot, rotate, flip.
export enum CanvasTransform {
  INK_CANVAS_ZOOM_IN,
  INK_CANVAS_ZOOM_OUT,
  INK_CANVAS_ZOOM_1_1,
  INK_CANVAS_ZOOM_DRAWING,
  INK_CANVAS_ZOOM_PAGE,
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
    case CanvasTransform.INK_CANVAS_ZOOM_DRAWING:
      dt.zoom_drawing();
      break;
    case CanvasTransform.INK_CANVAS_ZOOM_PAGE:
      dt.zoom_page();
      break;
  }
}

/** Action ids (without the "win." prefix) and their options. */
export const canvas_transform_actions: ReadonlyArray<readonly [string, CanvasTransform]> = [
  ['canvas-zoom-in', CanvasTransform.INK_CANVAS_ZOOM_IN],
  ['canvas-zoom-out', CanvasTransform.INK_CANVAS_ZOOM_OUT],
  ['canvas-zoom-1-1', CanvasTransform.INK_CANVAS_ZOOM_1_1],
  ['canvas-zoom-drawing', CanvasTransform.INK_CANVAS_ZOOM_DRAWING],
  ['canvas-zoom-page', CanvasTransform.INK_CANVAS_ZOOM_PAGE],
];
