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

/** A key combination. The primary modifier (Ctrl, or Cmd on macOS) is always held. */
export interface Accelerator {
  /** Lower case KeyboardEvent.key. */
  key: string;
  shift?: boolean;
  alt?: boolean;
}

/**
 * Default keys of the file and undo actions, from share/keys/inkscape.xml
 * (<primary> is Ctrl). TODO: replace with the shortcut system.
 */
export const ACTION_KEYS: Record<string, Accelerator[]> = {
  'app.document-new': [{ key: 'n' }],
  'app.document-open': [{ key: 'o' }],
  'win.document-save': [{ key: 's' }],
  'win.document-save-as': [{ key: 's', shift: true }],
  'doc.undo': [{ key: 'z' }],
  'doc.redo': [{ key: 'z', shift: true }, { key: 'y' }],
};

/** The first key of an action as shown in menus ("Ctrl+Shift+Z"), or null. */
export function shortcutLabel(actionId: string): string | null {
  const acc = ACTION_KEYS[actionId]?.[0];
  if (!acc) return null;
  const key = acc.key.length === 1 ? acc.key.toUpperCase() : acc.key;
  return ['Ctrl', acc.shift && 'Shift', acc.alt && 'Alt', key].filter(Boolean).join('+');
}

/** The action id for a key press, or null. */
export function actionForKeyEvent(event: KeyboardEvent): string | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  for (const [id, accs] of Object.entries(ACTION_KEYS)) {
    if (accs.some((a) => a.key === key && !!a.shift === event.shiftKey && !!a.alt === event.altKey))
      return id;
  }
  return null;
}

/**
 * Run the actions of key presses in the window with run. This replaces the
 * browser keys (save page, open file), except in text fields. Returns a
 * function that removes the handler.
 */
export function attachActionShortcuts(run: (actionId: string) => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]')) return;
    const id = actionForKeyEvent(event);
    if (!id) return;
    event.preventDefault();
    run(id);
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
