// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/shortcuts.cpp, src/ui/shortcuts.h
/*
 * Shortcuts
 *
 * Copyright (C) 2020 Tavmjong Bah
 * Rewrite of code (C) MenTalguY and others.
 */
import { type Node, readMem, Signal } from '@inkscape-web/core';
import { canonical_detailed_name } from '../actions/action-map.ts';
import { InkscapeApplication } from '../inkscape-application.ts';

/**
 * A key combination: a GDK key name ("a", "asterisk", "KP_Add", "Page_Up",
 * "F1") with modifiers. Letters are lower case; Shift is never set for
 * symbol keys like "asterisk", where it is part of the key.
 */
export interface AccelKey {
  key: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

/** Whether the platform is macOS, where <primary> is the Command key. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** GDK key names of the printable ASCII symbols. */
const SYMBOL_NAMES: Record<string, string> = {
  '!': 'exclam',
  '"': 'quotedbl',
  '#': 'numbersign',
  $: 'dollar',
  '%': 'percent',
  '&': 'ampersand',
  "'": 'apostrophe',
  '(': 'parenleft',
  ')': 'parenright',
  '*': 'asterisk',
  '+': 'plus',
  ',': 'comma',
  '-': 'minus',
  '.': 'period',
  '/': 'slash',
  ':': 'colon',
  ';': 'semicolon',
  '<': 'less',
  '=': 'equal',
  '>': 'greater',
  '?': 'question',
  '@': 'at',
  '[': 'bracketleft',
  '\\': 'backslash',
  ']': 'bracketright',
  '^': 'asciicircum',
  _: 'underscore',
  '`': 'grave',
  '{': 'braceleft',
  '|': 'bar',
  '}': 'braceright',
  '~': 'asciitilde',
};
const SYMBOL_CHARS = Object.fromEntries(Object.entries(SYMBOL_NAMES).map(([c, n]) => [n, c]));

/** GDK key names of KeyboardEvent.key values of non-printable keys. */
const KEY_NAMES: Record<string, string> = {
  ' ': 'space',
  Backspace: 'BackSpace',
  Enter: 'Return',
  PageUp: 'Page_Up',
  PageDown: 'Page_Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
};

/** GDK key names of keypad keys (KeyboardEvent.code Numpad*), by KeyboardEvent.key. */
const KEYPAD_NAMES: Record<string, string> = {
  '+': 'KP_Add',
  '-': 'KP_Subtract',
  '*': 'KP_Multiply',
  '/': 'KP_Divide',
  '.': 'KP_Decimal',
  ',': 'KP_Separator',
  '=': 'KP_Equal',
  Enter: 'KP_Enter',
  Insert: 'KP_Insert',
  Delete: 'KP_Delete',
  Home: 'KP_Home',
  End: 'KP_End',
  PageUp: 'KP_Page_Up',
  PageDown: 'KP_Page_Down',
  ArrowLeft: 'KP_Left',
  ArrowRight: 'KP_Right',
  ArrowUp: 'KP_Up',
  ArrowDown: 'KP_Down',
  Clear: 'KP_Begin',
};

/** Whether a key name is a symbol key (Shift is part of the key, not a modifier). */
const isSymbol = (key: string) => key in SYMBOL_CHARS;

/** The normalized string of a key combination ("<Shift><Control>z"), used as map key. */
export function accel_abbrev(accel: AccelKey): string {
  return (
    (accel.shift ? '<Shift>' : '') +
    (accel.ctrl ? '<Control>' : '') +
    (accel.alt ? '<Alt>' : '') +
    (accel.meta ? '<Meta>' : '') +
    accel.key
  );
}

/**
 * Parse a GTK accelerator ("<primary><shift>z", "KP_Add", "<alt>bracketleft").
 * <primary> is Ctrl, or Command on macOS. Returns null if it is malformed.
 */
export function parse_accelerator(str: string, mac = IS_MAC): AccelKey | null {
  const accel: AccelKey = { key: '', shift: false, ctrl: false, alt: false, meta: false };
  let rest = str.trim();
  for (let m = /^<([A-Za-z0-9]+)>/.exec(rest); m; m = /^<([A-Za-z0-9]+)>/.exec(rest)) {
    switch (m[1]?.toLowerCase()) {
      case 'shift':
        accel.shift = true;
        break;
      case 'primary':
        if (mac) accel.meta = true;
        else accel.ctrl = true;
        break;
      case 'ctrl':
      case 'control':
        accel.ctrl = true;
        break;
      case 'alt':
      case 'mod1':
        accel.alt = true;
        break;
      case 'meta':
      case 'super':
      case 'command':
        accel.meta = true;
        break;
      default:
        return null;
    }
    rest = rest.slice(m[0].length);
  }
  if (!/^[A-Za-z0-9_]+$/.test(rest)) return null;
  // GTK keeps letters in lower case.
  accel.key = rest.length === 1 ? rest.toLowerCase() : rest;
  if (isSymbol(accel.key)) accel.shift = false;
  return accel;
}

/**
 * The key combination of a key press (upstream Shortcuts::get_from_event):
 * keypad keys get KP_ names, symbols lose Shift, letters are lower case with
 * Shift kept. Non-Latin letters and letters changed by Alt (macOS Option)
 * use the key position instead.
 */
export function get_from_event(event: KeyboardEvent): AccelKey | null {
  let { key } = event;
  if (key === 'Unidentified' || key === 'Dead' || ['Shift', 'Control', 'Alt', 'Meta'].includes(key))
    return null;
  let name: string | undefined;
  if (event.code.startsWith('Numpad')) {
    name = /^\d$/.test(key) ? `KP_${key}` : KEYPAD_NAMES[key];
  }
  if (!name && key.length === 1) {
    const latin = /^Key([A-Z])$/.exec(event.code)?.[1];
    if (latin && (event.altKey || key.charCodeAt(0) > 127)) key = latin;
    name = SYMBOL_NAMES[key] ?? KEY_NAMES[key] ?? key.toLowerCase();
  }
  name ??= KEY_NAMES[key] ?? key;
  return {
    key: name,
    shift: event.shiftKey && !isSymbol(name),
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
}

/** The label of a key combination for menus and tooltips ("Shift+Ctrl+Z", "Numpad +"; "⇧⌘Z" on macOS). */
export function get_label(accel: AccelKey, mac = IS_MAC): string {
  let key = accel.key;
  let prefix = '';
  if (key.startsWith('KP_')) {
    // Upstream: ::get_label shows key pad and numeric keys identically.
    prefix = 'Numpad ';
    key = key.slice(3);
    key = { Add: '+', Subtract: '-', Multiply: '*', Divide: '/', Decimal: '.' }[key] ?? key;
  }
  if (key.length === 1) key = key.toUpperCase();
  else key = SYMBOL_CHARS[key] ?? (key === 'space' ? 'Space' : key.replace(/_/g, ' '));
  if (mac) {
    return `${prefix}${accel.ctrl ? '⌃' : ''}${accel.alt ? '⌥' : ''}${accel.shift ? '⇧' : ''}${accel.meta ? '⌘' : ''}${key}`;
  }
  const mods = [accel.shift && 'Shift', accel.ctrl && 'Ctrl', accel.alt && 'Alt', accel.meta && 'Meta'];
  return prefix + [...mods.filter(Boolean), key].join('+');
}

/**
 * The keyboard shortcuts of actions, read from share/keys/*.xml. Actions are
 * detailed action names ("win.tool-switch('Rect')"); invoke_action() runs
 * them through the action registry of InkscapeApplication.
 * TODO: user shortcuts (add/remove, writing keys files), modifiers (<modifier>).
 */
export class Shortcuts {
  static #instance: Shortcuts | null = null;

  static getInstance(): Shortcuts {
    Shortcuts.#instance ??= new Shortcuts();
    return Shortcuts.#instance;
  }

  readonly mac: boolean;
  /** Triggers by canonical detailed action name; the first is shown in menus. */
  readonly #shortcuts = new Map<string, AccelKey[]>();
  /** Emitted after a keys file was read. */
  readonly signal_changed = new Signal<[]>();

  constructor(mac = IS_MAC) {
    this.mac = mac;
  }

  /** Clear the shortcuts and read the bindings of a keys file (the XML text). Returns false if it is malformed. */
  read(xml: string): boolean {
    const root = readMem(xml, null)?.root();
    if (!root) return false;
    if (root.name() !== 'keys') return false;
    this.#shortcuts.clear();
    this.#read(root);
    this.signal_changed.emit();
    return true;
  }

  #read(keysnode: Node): void {
    for (const iter of keysnode.children()) {
      if (iter.name() === 'keys') {
        this.#read(iter);
        continue;
      }
      if (iter.name() !== 'bind') continue; // Unknown element (or modifier), do not complain.
      const gaction = iter.attribute('gaction');
      const keys = iter.attribute('keys');
      if (!gaction || !keys) continue;
      const key_vector = keys.trim().split(/\s*,\s*/);
      // Last key added will appear in menus, upstream adds them in reverse.
      for (const key of key_vector.reverse()) this.add_shortcut(gaction, key);
    }
  }

  /**
   * Add a trigger (GTK accelerator) to an action; other actions lose it, and
   * it becomes the first trigger of the action. Returns false if it is malformed.
   */
  add_shortcut(detailed_action_name: string, trigger: string): boolean {
    const key = parse_accelerator(trigger, this.mac);
    if (!key) return false;
    // Remove previous use of trigger.
    const abbrev = accel_abbrev(key);
    for (const [action, triggers] of this.#shortcuts) {
      const kept = triggers.filter((t) => accel_abbrev(t) !== abbrev);
      if (kept.length !== triggers.length) this.#shortcuts.set(action, kept);
    }
    const name = canonical_detailed_name(detailed_action_name);
    this.#shortcuts.set(name, [key, ...(this.#shortcuts.get(name) ?? [])]);
    return true;
  }

  /** The triggers of an action. */
  get_triggers(detailed_action_name: string): readonly AccelKey[] {
    return this.#shortcuts.get(canonical_detailed_name(detailed_action_name)) ?? [];
  }

  /** The actions of a trigger. */
  get_actions(trigger: AccelKey): string[] {
    const abbrev = accel_abbrev(trigger);
    const actions: string[] = [];
    for (const [action, triggers] of this.#shortcuts) {
      if (triggers.some((t) => accel_abbrev(t) === abbrev)) actions.push(action);
    }
    return actions;
  }

  /** The label of the first trigger of an action, or null. */
  get_shortcut_label(detailed_action_name: string): string | null {
    const first = this.get_triggers(detailed_action_name)[0];
    return first ? get_label(first, this.mac) : null;
  }

  /** The action of a key press, or null. */
  get_action_for_event(event: KeyboardEvent): string | null {
    const accel = get_from_event(event);
    return accel ? (this.get_actions(accel)[0] ?? null) : null;
  }

  /** Run the action of a key press. Returns whether an enabled action ran. */
  invoke_action(event: KeyboardEvent, app = InkscapeApplication.instance()): boolean {
    const action = this.get_action_for_event(event);
    return !!action && app.activate_action(action);
  }
}

/** The label of the first key of an action ("Shift+Ctrl+Z", "R"), or null. */
export function shortcutLabel(detailed_action_name: string): string | null {
  return Shortcuts.getInstance().get_shortcut_label(detailed_action_name);
}

/** Whether a key event comes from a text field, where keys type text. */
function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable]');
}

/**
 * Run the actions of key presses in the window. Keys typed in text fields
 * and keys the active tool has handled (default prevented) are ignored.
 * Handled keys are default prevented, which replaces browser keys (save
 * page, open file). Returns a function that removes the handler.
 */
export function attachActionShortcuts(app = InkscapeApplication.instance()): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isTextInput(event.target)) return;
    if (Shortcuts.getInstance().invoke_action(event, app)) event.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
