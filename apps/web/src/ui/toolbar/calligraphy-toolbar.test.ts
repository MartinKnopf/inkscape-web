// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/calligraphy-toolbar.cpp
import { Preferences } from '@inkscape-web/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  adjustment_value_changed,
  change_profile,
  get_presets_list,
  save_profile,
  update_presets_list,
  widget_value,
} from './calligraphy-toolbar.tsx';

const NAMES = ['mass', 'wiggle', 'angle', 'thinning', 'tremor', 'flatness', 'cap_rounding', 'width'];
const TOGGLES = ['tracebackground', 'usepressure', 'usetilt', 'abs_width'];

afterEach(() => {
  const prefs = Preferences.get();
  for (const n of [...NAMES, ...TOGGLES]) prefs.remove(`/tools/calligraphic/${n}`);
  for (const p of get_presets_list()) for (const [e] of prefs.getAllEntries(p)) prefs.remove(`${p}/${e}`);
});

describe('CalligraphyToolbar presets', () => {
  it('a preset sets the tool preferences and is then shown as selected', () => {
    // The skeleton defaults match no preset (usetilt is off, Dip pen has it on).
    expect(update_presets_list()).toBe(0);
    const marker =
      get_presets_list().findIndex((p) => Preferences.get().getString(`${p}/name`) === 'Marker') + 1;
    change_profile(marker);
    expect(Preferences.get().getDouble('/tools/calligraphic/angle')).toBe(90);
    expect(Preferences.get().getDouble('/tools/calligraphic/cap_rounding')).toBe(1);
    expect(Preferences.get().getBool('/tools/calligraphic/usepressure')).toBe(false);
    expect(update_presets_list()).toBe(marker);
    // Any change leaves the preset.
    adjustment_value_changed('angle', 80);
    expect(update_presets_list()).toBe(0);
  });

  it('the width field shows the width in the unit preference (mm), the preference is px', () => {
    expect(widget_value('width')).toBeCloseTo(4, 3); // 15.118 px
    adjustment_value_changed('width', 10);
    expect(Preferences.get().getDouble('/tools/calligraphic/width')).toBeCloseTo(37.795, 3);
  });

  it('save_profile adds a preset with the current values, or replaces the preset of the same name', () => {
    const n = get_presets_list().length;
    adjustment_value_changed('mass', 33);
    save_profile('Mine');
    expect(get_presets_list()).toHaveLength(n + 1);
    expect(update_presets_list()).toBe(n + 1);
    adjustment_value_changed('mass', 44);
    save_profile('Mine');
    expect(get_presets_list()).toHaveLength(n + 1);
    expect(Preferences.get().getDouble(`/tools/calligraphic/preset/dcc${n + 1}/mass`)).toBe(44);
  });
});
