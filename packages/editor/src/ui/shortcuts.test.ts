// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/shortcuts.cpp
// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { accel_abbrev, get_from_event, get_label, parse_accelerator, Shortcuts } from './shortcuts.ts';

const KEYS = `<?xml version="1.0"?>
<keys name="Test">
  <modifier action="canvas-pan-y" modifiers=""/>
  <bind gaction="win.tool-switch('Star')" keys="asterisk, &lt;shift&gt;F9, KP_Multiply"/>
  <bind gaction="win.tool-switch('Rect')" keys="r, F4"/>
  <bind gaction="doc.redo" keys="&lt;primary&gt;&lt;shift&gt;z, &lt;primary&gt;y" />
  <bind gaction="app.selection-raise" keys="Page_Up, KP_Page_Up" />
  <bind gaction="app.transform-rotate(-90.0)" keys="&lt;primary&gt;bracketleft" />
  <bind gaction="win.select-invert" keys="exclam, &lt;shift&gt;exclam"/>
  <bind gaction="app.object-set-inverse-clip" keys="&lt;primary&gt;alt&gt;m" />
  <bind gaction="win.dialog-open('Find')" keys="&lt;primary&gt;f" />
  <bind gaction="app.other" keys="&lt;primary&gt;f" />
</keys>`;

const key = (k: string, code: string, mods: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, code, ...mods });

const abbrev = (e: KeyboardEvent) => {
  const accel = get_from_event(e);
  return accel && accel_abbrev(accel);
};

describe('parse_accelerator', () => {
  it('parses GTK accelerators, <primary> by platform, and rejects malformed ones', () => {
    const p = (s: string, mac = false) => {
      const a = parse_accelerator(s, mac);
      return a && accel_abbrev(a);
    };
    expect(p('<primary><shift>z')).toBe('<Shift><Control>z');
    expect(p('<primary><shift>z', true)).toBe('<Shift><Meta>z');
    expect(p('<alt>X')).toBe('<Alt>x');
    // Shift is part of symbol keys.
    expect(p('<primary><shift>asterisk')).toBe('<Control>asterisk');
    expect(p('<ctrl><meta>f')).toBe('<Control><Meta>f');
    expect(p(' KP_Add')).toBe('KP_Add');
    expect(p('<primary>alt>m')).toBeNull();
    expect(p('<hyper>a')).toBeNull();
  });
});

describe('get_from_event', () => {
  it('maps key events to GDK key names and modifiers', () => {
    expect(abbrev(key('A', 'KeyA', { shiftKey: true, ctrlKey: true }))).toBe('<Shift><Control>a');
    expect(abbrev(key('*', 'Digit8', { shiftKey: true }))).toBe('asterisk');
    expect(abbrev(key('[', 'BracketLeft', { ctrlKey: true }))).toBe('<Control>bracketleft');
    expect(abbrev(key('*', 'NumpadMultiply'))).toBe('KP_Multiply');
    expect(abbrev(key('5', 'Numpad5'))).toBe('KP_5');
    expect(abbrev(key('PageUp', 'Numpad9'))).toBe('KP_Page_Up');
    expect(abbrev(key('PageUp', 'PageUp', { shiftKey: true }))).toBe('<Shift>Page_Up');
    expect(abbrev(key('Backspace', 'Backspace'))).toBe('BackSpace');
    // macOS Option changes the character; the key position gives the letter.
    expect(abbrev(key('∫', 'KeyB', { altKey: true }))).toBe('<Alt>b');
    expect(get_from_event(key('Shift', 'ShiftLeft', { shiftKey: true }))).toBeNull();
  });
});

describe('get_label', () => {
  it('labels keys as GTK does', () => {
    const l = (s: string, mac = false) =>
      get_label(
        parse_accelerator(s, mac) ?? { key: '', shift: false, ctrl: false, alt: false, meta: false },
        mac,
      );
    expect(l('<primary><shift>z')).toBe('Shift+Ctrl+Z');
    expect(l('<primary><shift>z', true)).toBe('⇧⌘Z');
    expect(l('<primary>bracketleft')).toBe('Ctrl+[');
    expect(l('KP_Add')).toBe('Numpad +');
    expect(l('Page_Up')).toBe('Page Up');
  });
});

describe('Shortcuts', () => {
  const shortcuts = () => {
    const s = new Shortcuts(false);
    expect(s.read(KEYS)).toBe(true);
    return s;
  };

  it('reads bindings; the first key is shown, later uses of a key win', () => {
    const s = shortcuts();
    expect(s.get_shortcut_label("win.tool-switch('Star')")).toBe('*');
    expect(s.get_shortcut_label('doc.redo')).toBe('Shift+Ctrl+Z');
    expect(s.get_shortcut_label('app.transform-rotate(-90)')).toBe('Ctrl+[');
    expect(s.get_shortcut_label('app.object-set-inverse-clip')).toBeNull();
    expect(s.get_shortcut_label("win.dialog-open('Find')")).toBeNull();
    expect(s.get_action_for_event(key('f', 'KeyF', { ctrlKey: true }))).toBe('app.other');
  });

  it('finds the action of key presses, with exact modifiers for letters', () => {
    const s = shortcuts();
    const action = (e: KeyboardEvent) => s.get_action_for_event(e);
    expect(action(key('r', 'KeyR'))).toBe("win.tool-switch('Rect')");
    expect(action(key('R', 'KeyR', { shiftKey: true }))).toBeNull();
    expect(action(key('*', 'Digit8', { shiftKey: true }))).toBe("win.tool-switch('Star')");
    expect(action(key('F9', 'F9', { shiftKey: true }))).toBe("win.tool-switch('Star')");
    expect(action(key('Z', 'KeyZ', { ctrlKey: true, shiftKey: true }))).toBe('doc.redo');
    expect(action(key('!', 'Digit1', { shiftKey: true }))).toBe('win.select-invert');
    expect(action(key('PageUp', 'Numpad9'))).toBe('app.selection-raise');
    expect(action(key('[', 'BracketLeft', { ctrlKey: true }))).toBe('app.transform-rotate(-90)');
  });

  it('invokes the registered action with its target', () => {
    const s = shortcuts();
    const app = new InkscapeApplication();
    const rotate = vi.fn();
    app.actions.app.add_action_with_parameter('transform-rotate', 'd', rotate);
    expect(s.invoke_action(key('[', 'BracketLeft', { ctrlKey: true }), app)).toBe(true);
    expect(rotate).toHaveBeenCalledWith(-90);
    // Bound, but not registered.
    expect(s.invoke_action(key('f', 'KeyF', { ctrlKey: true }), app)).toBe(false);
  });
});
