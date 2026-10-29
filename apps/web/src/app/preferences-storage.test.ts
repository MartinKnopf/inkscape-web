// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/preferences.cpp
import { Preferences } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { localPreferencesStorage, PREFS_KEY_PREFIX, type StringStorage } from './preferences-storage.ts';

/** A Storage in memory (what localStorage offers). */
function fakeStorage(): StringStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
}

describe('localPreferencesStorage', () => {
  it('keeps a preference across sessions under its upstream path', () => {
    const storage = fakeStorage();
    storage.setItem('unrelated', 'x');

    const first = new Preferences();
    first.attachStorage(localPreferencesStorage(storage));
    first.setBool('/options/transform/stroke', false);
    first.setString('/ui/language', 'de');
    expect(storage.getItem(`${PREFS_KEY_PREFIX}/options/transform/stroke`)).toBe('0');

    const second = new Preferences();
    second.attachStorage(localPreferencesStorage(storage));
    expect(second.getBool('/options/transform/stroke', true)).toBe(false);
    expect(second.getString('/ui/language')).toBe('de');

    second.remove('/ui/language');
    expect(storage.getItem(`${PREFS_KEY_PREFIX}/ui/language`)).toBeNull();
    expect(storage.getItem('unrelated')).toBe('x');
  });
});
