// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/shortcuts.cpp, share/keys/inkscape.xml
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { actionForKeyEvent, shortcutLabel } from './shortcuts.ts';

const key = (k: string, mods: KeyboardEventInit = {}) =>
  actionForKeyEvent(new KeyboardEvent('keydown', { key: k, ...mods }));

describe('actionForKeyEvent', () => {
  it('maps the tool keys and the primary-modifier keys, with exact modifiers for letters', () => {
    expect(key('r')).toBe("win.tool-switch('Rect')");
    expect(key('F9', { shiftKey: true })).toBe("win.tool-switch('Star')");
    // Shift is part of "*" on most layouts.
    expect(key('*', { shiftKey: true })).toBe("win.tool-switch('Star')");
    expect(key('S', { shiftKey: true })).toBeNull();
    expect(key('s', { ctrlKey: true })).toBe('win.document-save');
    expect(key('Z', { metaKey: true, shiftKey: true })).toBe('doc.redo');
    expect([shortcutLabel("win.tool-switch('Arc')"), shortcutLabel('doc.redo')]).toEqual([
      'E',
      'Ctrl+Shift+Z',
    ]);
  });
});
