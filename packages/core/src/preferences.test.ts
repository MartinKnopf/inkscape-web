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
