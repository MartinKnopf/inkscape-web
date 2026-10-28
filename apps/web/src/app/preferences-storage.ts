// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/preferences.cpp
// Persist the preferences in localStorage (upstream: preferences.xml in the profile folder).
import { Preferences, type PreferencesStorage } from '@inkscape-web/core';

/** Key prefix: the preference "/options/transform/stroke" is stored as "inkscape:prefs:/options/transform/stroke". */
export const PREFS_KEY_PREFIX = 'inkscape:prefs:';

/** The part of the Storage interface that we use. */
export interface StringStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Store each changed preference under its path below PREFS_KEY_PREFIX. */
export function localPreferencesStorage(storage: StringStorage): PreferencesStorage {
  return {
    load() {
      const entries: [string, string][] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        const value = key?.startsWith(PREFS_KEY_PREFIX) ? storage.getItem(key) : null;
        if (key && value !== null) entries.push([key.slice(PREFS_KEY_PREFIX.length), value]);
      }
      return entries;
    },
    save(path, value) {
      try {
        storage.setItem(PREFS_KEY_PREFIX + path, value);
      } catch (e) {
        console.error('Preferences: could not store', path, e);
      }
    },
    remove(path) {
      storage.removeItem(PREFS_KEY_PREFIX + path);
    },
  };
}

/** Load the stored preferences. Call before anything reads a preference. */
export function loadPreferences(): void {
  Preferences.get().attachStorage(localPreferencesStorage(localStorage));
}
