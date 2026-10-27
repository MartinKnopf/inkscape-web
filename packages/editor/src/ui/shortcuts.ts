// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/shortcuts.cpp, share/keys/inkscape.xml
/*
 * Shortcuts
 *
 * Copyright (C) 2020 Tavmjong Bah
 */
import { CanvasTransform, canvas_transform } from '../actions/actions-canvas-transform.ts';
import type { SPDesktop } from '../desktop.ts';

/**
 * Default keys of the canvas zoom actions, from share/keys/inkscape.xml, as
 * KeyboardEvent.key values (keypad keys give the same values).
 * TODO: the shortcut system: read share/keys/*.xml and user keys, all actions.
 */
const CANVAS_KEYS: Record<string, CanvasTransform> = {
  // win.canvas-zoom-in: plus, equal, KP_Add
  '+': CanvasTransform.INK_CANVAS_ZOOM_IN,
  '=': CanvasTransform.INK_CANVAS_ZOOM_IN,
  // win.canvas-zoom-out: minus, underscore, KP_Subtract
  '-': CanvasTransform.INK_CANVAS_ZOOM_OUT,
  _: CanvasTransform.INK_CANVAS_ZOOM_OUT,
  // win.canvas-zoom-1-1: 1, KP_1
  '1': CanvasTransform.INK_CANVAS_ZOOM_1_1,
  // win.canvas-zoom-drawing: 4, KP_4
  '4': CanvasTransform.INK_CANVAS_ZOOM_DRAWING,
  // win.canvas-zoom-page: 5, KP_5
  '5': CanvasTransform.INK_CANVAS_ZOOM_PAGE,
};

/**
 * Run the canvas zoom shortcuts for key presses in element. Returns a
 * function that removes the handler.
 */
export function attachCanvasShortcuts(element: HTMLElement, getDesktop: () => SPDesktop | null): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const option = CANVAS_KEYS[event.key];
    const dt = getDesktop();
    if (option === undefined || !dt) return;
    event.preventDefault();
    canvas_transform(dt, option);
  };
  element.addEventListener('keydown', onKeyDown);
  return () => element.removeEventListener('keydown', onKeyDown);
}
