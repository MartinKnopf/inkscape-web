// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/preferences.cpp
import { describe, expect, it } from 'vitest';
import { Preferences } from './preferences.ts';
import { spReprCssWriteString } from './xml/repr-css.ts';

describe('Preferences', () => {
  it('falls back to the skeleton and merges inherited styles from the parent groups', () => {
    const prefs = Preferences.get();
    expect(prefs.getInt('/tools/shapes/star/magnitude', 3)).toBe(5);
    expect(spReprCssWriteString(prefs.getInheritedStyle('/tools/shapes/rect/style'))).toBe(
      'fill-rule:evenodd;fill:blue',
    );
    prefs.setString('/tools/shapes/rect/style', 'fill:green;fill-rule:nonzero');
    expect(spReprCssWriteString(prefs.getInheritedStyle('/tools/shapes/rect/style'))).toBe(
      'fill-rule:nonzero;fill:green',
    );
    prefs.remove('/tools/shapes/rect/style');
    expect(spReprCssWriteString(prefs.getInheritedStyle('/tools/nothing/style'))).toBe('');
  });
});

describe('Preferences storage', () => {
  /** In-memory PreferencesStorage that records writes. */
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      data,
      load: () => [...data],
      save: (path: string, value: string) => void data.set(path, value),
      remove: (path: string) => void data.delete(path),
    };
  }

  it('loads stored values over the skeleton and notifies listeners', () => {
    const prefs = new Preferences();
    const changed: string[] = [];
    prefs.changedSignal.connect((path) => changed.push(path));
    prefs.attachStorage(memoryStorage({ '/options/dragtolerance/value': '9', '/custom/flag': '1' }));
    expect(prefs.getDouble('/options/dragtolerance/value')).toBe(9);
    expect(prefs.getBool('/custom/flag')).toBe(true);
    expect(changed).toEqual(['/options/dragtolerance/value', '/custom/flag']);
    // Untouched paths still come from the skeleton.
    expect(prefs.getDouble('/options/rotationsnapsperpi/value')).toBe(12);
  });

  it('writes changes and removals; bools are stored as 1 and 0', () => {
    const prefs = new Preferences();
    const storage = memoryStorage();
    prefs.attachStorage(storage);
    prefs.setBool('/options/transform/stroke', false);
    prefs.setInt('/options/cloneorphans/value', 2);
    expect([...storage.data]).toEqual([
      ['/options/transform/stroke', '0'],
      ['/options/cloneorphans/value', '2'],
    ]);
    prefs.remove('/options/transform/stroke');
    expect([...storage.data.keys()]).toEqual(['/options/cloneorphans/value']);
    expect(prefs.getBool('/options/transform/stroke', true)).toBe(true);
  });
});

describe('getAllDirs and getAllEntries', () => {
  it('list the groups and entries of the skeleton and of the user values', () => {
    const prefs = new Preferences();
    prefs.setString('/tools/calligraphic/preset/dcc7/name', 'Mine');
    const dirs = prefs.getAllDirs('/tools/calligraphic/preset');
    expect(dirs.slice(0, 2)).toEqual(['/tools/calligraphic/preset/cp0', '/tools/calligraphic/preset/cp1']);
    expect(dirs.at(-1)).toBe('/tools/calligraphic/preset/dcc7');
    expect(prefs.getAllEntries('/tools/calligraphic/preset/cp1').slice(0, 2)).toEqual([
      ['name', 'Marker'],
      ['mass', '2'],
    ]);
  });
});
