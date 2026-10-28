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

/** A key combination. */
export interface Accelerator {
  /** KeyboardEvent.key, lower case for letters ("s", "F1", "*"). */
  key: string;
  /** The primary modifier: Ctrl, or Cmd on macOS. */
  primary?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/**
 * Default keys of the actions, from share/keys/inkscape.xml (<primary> is
 * Ctrl). The keypad keys give the same KeyboardEvent.key values.
 * TODO: replace with the shortcut system.
 */
export const ACTION_KEYS: Record<string, Accelerator[]> = {
  'app.document-new': [{ key: 'n', primary: true }],
  'app.document-open': [{ key: 'o', primary: true }],
  'win.document-save': [{ key: 's', primary: true }],
  'win.document-save-as': [{ key: 's', primary: true, shift: true }],
  'doc.undo': [{ key: 'z', primary: true }],
  'doc.redo': [
    { key: 'z', primary: true, shift: true },
    { key: 'y', primary: true },
  ],
  "win.tool-switch('Select')": [{ key: 's' }, { key: 'F1' }],
  "win.tool-switch('Node')": [{ key: 'n' }, { key: 'F2' }],
  "win.tool-switch('Rect')": [{ key: 'r' }, { key: 'F4' }],
  "win.tool-switch('Arc')": [{ key: 'e' }, { key: 'F5' }],
  // asterisk, <shift>F9, KP_Multiply
  "win.tool-switch('Star')": [{ key: '*' }, { key: 'F9', shift: true }],
  "win.tool-switch('Spiral')": [{ key: 'i' }, { key: 'F9' }],
  'app.object-to-path': [{ key: 'c', primary: true, shift: true }],
  "win.tool-switch('Pencil')": [{ key: 'p' }, { key: 'F6' }],
  "win.tool-switch('Pen')": [{ key: 'b' }, { key: 'F6', shift: true }],
  "win.dialog-open('FillStroke')": [{ key: 'f', primary: true, shift: true }],
  "win.dialog-open('Objects')": [{ key: 'l', primary: true, shift: true }],
  "win.dialog-open('XMLEditor')": [{ key: 'x', primary: true, shift: true }],
  "win.dialog-open('AlignDistribute')": [{ key: 'a', primary: true, shift: true }],
  // Path booleans: symbol keys match with or without Shift; keypad keys give the same key.
  'app.path-union': [{ key: '+', primary: true }],
  'app.path-difference': [
    { key: '-', primary: true },
    { key: '_', primary: true },
  ],
  'app.path-intersection': [{ key: '*', primary: true }],
  'app.path-exclusion': [{ key: '^', primary: true }],
  'app.path-division': [{ key: '/', primary: true }],
  'app.path-cut': [{ key: '/', primary: true, alt: true }],
  'app.path-combine': [{ key: 'k', primary: true }],
  'app.path-break-apart': [{ key: 'k', primary: true, shift: true }],
  "app.object-align('vcenter pref')": [{ key: '1', primary: true, alt: true }],
  "app.object-align('bottom pref')": [{ key: '2', primary: true, alt: true }],
  "app.object-align('left pref')": [{ key: '4', primary: true, alt: true }],
  "app.object-align('hcenter vcenter pref')": [{ key: '5', primary: true, alt: true }],
  "app.object-align('right pref')": [{ key: '6', primary: true, alt: true }],
  "app.object-align('hcenter pref')": [{ key: '7', primary: true, alt: true }],
  "app.object-align('top pref')": [{ key: '8', primary: true, alt: true }],
};

/** The first key of an action as shown in menus and tooltips ("Ctrl+Shift+Z", "R"), or null. */
export function shortcutLabel(actionId: string): string | null {
  const acc = ACTION_KEYS[actionId]?.[0];
  if (!acc) return null;
  const key = acc.key.length === 1 ? acc.key.toUpperCase() : acc.key;
  return [acc.primary && 'Ctrl', acc.shift && 'Shift', acc.alt && 'Alt', key].filter(Boolean).join('+');
}

/** Whether key is a symbol ("*", "+"), where Shift is part of the key, not a modifier. */
const isSymbol = (key: string) =>
  key.length === 1 && key.toLowerCase() === key.toUpperCase() && !/\d/.test(key);

/** The action id for a key press, or null. */
export function actionForKeyEvent(event: KeyboardEvent): string | null {
  const primary = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  for (const [id, accs] of Object.entries(ACTION_KEYS)) {
    const match = (a: Accelerator) =>
      a.key === key &&
      !!a.primary === primary &&
      (isSymbol(a.key) || !!a.shift === event.shiftKey) &&
      !!a.alt === event.altKey;
    if (accs.some(match)) return id;
  }
  return null;
}

/**
 * Run the actions of key presses in the window with run. This replaces the
 * browser keys (save page, open file), except in text fields and for keys
 * the active tool has handled (default prevented). Returns a function that
 * removes the handler.
 */
export function attachActionShortcuts(run: (actionId: string) => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
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
