// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/calligraphy-toolbar.cpp, src/ui/toolbar/calligraphy-toolbar.h, share/ui/toolbar-calligraphy.ui
/*
 * Calligraphy toolbar
 *
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Frank Felfe <innerspace@iname.com>
 *   John Cliff <simarilius@yahoo.com>
 *   David Turner <novalis@gnu.org>
 *   Josh Andler <scislac@scislac.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *   Tavmjong Bah <tavmjong@free.fr>
 *   Abhishek Sharma
 *   Kris De Gussem <Kris.DeGussem@gmail.com>
 *   Vaibhav Malik <vaibhavmalik2018@gmail.com>
 *
 * Copyright (C) 2004 David Turner
 * Copyright (C) 2003 MenTaLguY
 * Copyright (C) 1999-2011 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { _, convertUnit, Preferences, UnitType, unitsOfType } from '@inkscape-web/core';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, PrefToggleButton, usePreferencesUpdates } from './toolbar.tsx';

const TOOL = '/tools/calligraphic';

/** The number widgets: preference name, default, lower, upper, step, digits (setup_derived_spin_button and the .ui adjustments). */
const ADJUSTMENTS = [
  ['width', 15.118, 0.001, 100, 1, 3],
  ['thinning', 10, -100, 100, 1, 0],
  ['mass', 2.0, 0, 100, 1, 0],
  ['angle', 30, -90, 90, 1, 0],
  ['flatness', -90, -100, 100, 1, 0],
  ['cap_rounding', 0.0, 0, 5, 0.01, 2],
  ['tremor', 0.0, 0, 100, 1, 0],
  ['wiggle', 0.0, 0, 100, 1, 0],
] as const;

/** The toggle widgets of the presets. */
const TOGGLES = ['usepressure', 'tracebackground', 'usetilt'] as const;

type AdjustmentName = (typeof ADJUSTMENTS)[number][0];

/** The unit of the width field: % for a width relative to the visible area, else the unit preference. */
export function width_unit(): string {
  const prefs = Preferences.get();
  return prefs.getBool(`${TOOL}/abs_width`) ? prefs.getString(`${TOOL}/unit`) : '%';
}

/** The value of a widget of the presets: the number field value, or the toggle state. */
export function widget_value(name: string): number | boolean {
  const prefs = Preferences.get();
  if ((TOGGLES as readonly string[]).includes(name)) return prefs.getBool(`${TOOL}/${name}`);
  const adj = ADJUSTMENTS.find((a) => a[0] === name);
  const val = prefs.getDouble(`${TOOL}/${name}`, adj?.[1] ?? 0);
  return name === 'width' ? convertUnit(val, 'px', width_unit()) : val;
}

/** Set a number field (upstream *_value_changed); the width is in the unit of the field. */
export function adjustment_value_changed(name: AdjustmentName, value: number): void {
  const prefs = Preferences.get();
  if (name === 'width') {
    const unit = width_unit();
    prefs.setBool(`${TOOL}/abs_width`, unit !== '%');
    prefs.setDouble(`${TOOL}/width`, convertUnit(value, unit, 'px'));
  } else {
    prefs.setDouble(`${TOOL}/${name}`, value);
  }
}

/** Upstream unit_changed: switch the width field between % and absolute units. */
export function unit_changed(unit: string): void {
  const prefs = Preferences.get();
  prefs.setBool(`${TOOL}/abs_width`, unit !== '%');
  prefs.setDouble(
    `${TOOL}/width`,
    Math.min(
      Math.max(prefs.getDouble(`${TOOL}/width`), convertUnit(0.001, unit, 'px')),
      convertUnit(100, unit, 'px'),
    ),
  );
  prefs.setString(`${TOOL}/unit`, unit);
}

/** The preference paths of the presets (upstream get_presets_list). */
export function get_presets_list(): string[] {
  return Preferences.get().getAllDirs(`${TOOL}/preset`);
}

/** The index of the preset that matches the widgets (1-based), or 0 for "No preset" (upstream update_presets_list). */
export function update_presets_list(): number {
  const presets = get_presets_list();
  for (const [i, preset] of presets.entries()) {
    let match = true;
    for (const [entry_name, v] of Preferences.get().getAllEntries(preset)) {
      if (entry_name === 'id' || entry_name === 'name') continue;
      const value = widget_value(entry_name);
      if (typeof value === 'boolean') {
        if (value !== (v === 'true' || v === '1')) match = false;
      } else if (Math.abs(value - Number.parseFloat(v)) > 1e-6) {
        match = false;
      }
      if (!match) break;
    }
    if (match) return i + 1;
  }
  // no match found
  return 0;
}

/** Set the widgets to the values of preset number mode (1-based; upstream change_profile). */
export function change_profile(mode: number): void {
  const preset_path = get_presets_list()[mode - 1];
  if (!preset_path) return;
  const prefs = Preferences.get();
  for (const [entry_name, v] of prefs.getAllEntries(preset_path)) {
    if (entry_name === 'id' || entry_name === 'name') continue;
    if ((TOGGLES as readonly string[]).includes(entry_name)) {
      prefs.setBool(`${TOOL}/${entry_name}`, v === 'true' || v === '1');
    } else if (ADJUSTMENTS.some((a) => a[0] === entry_name)) {
      adjustment_value_changed(entry_name as AdjustmentName, Number.parseFloat(v));
    } else {
      console.warn(`Bad key found in a preset record: ${entry_name}`);
    }
  }
}

/**
 * Save the widgets as the preset new_profile_name: replaces the preset of
 * that name or of current_profile_name, else adds one (upstream save_profile).
 */
export function save_profile(new_profile_name: string, current_profile_name = ''): void {
  if (!new_profile_name) return;
  const prefs = Preferences.get();
  const presets = get_presets_list();
  let save_path = presets.find((p) => {
    const name = prefs.getString(`${p}/name`);
    return name && (name === new_profile_name || name === current_profile_name);
  });
  // no preset with this name, create
  save_path ??= `${TOOL}/preset/dcc${presets.length + 1}`;
  for (const [name] of ADJUSTMENTS) prefs.setDouble(`${save_path}/${name}`, widget_value(name) as number);
  for (const name of TOGGLES) prefs.setBool(`${save_path}/${name}`, widget_value(name) as boolean);
  prefs.setString(`${save_path}/name`, new_profile_name);
}

const LABELS: Record<AdjustmentName, [label: string, tooltip: string]> = {
  width: ['Width', 'The width of the calligraphic pen (relative to the visible canvas area)'],
  thinning: [
    'Thinning',
    'How much velocity thins the stroke (> 0 makes fast strokes thinner, < 0 makes them broader, 0 makes width independent of velocity)',
  ],
  mass: ['Mass', 'Increase to make the pen drag behind, as if slowed by inertia'],
  angle: ['Angle', "The angle of the pen's nib (in degrees; 0 = horizontal; has no effect if fixation = 0)"],
  flatness: [
    'Fixation',
    'Angle behavior (0 = nib always perpendicular to stroke direction, 100 = fixed angle, -100 = fixed angle in opposite direction)',
  ],
  cap_rounding: [
    'Caps',
    'Increase to make caps at the ends of strokes protrude more (0 = no caps, 1 = round caps)',
  ],
  tremor: ['Tremor', 'Increase to make strokes rugged and trembling'],
  wiggle: ['Wiggle', 'Increase to make the pen waver and wiggle'],
};

/**
 * Controls of the calligraphy tool: the presets, the pen parameters and the
 * pressure, trace background and tilt switches.
 * TODO: the numeric menus of the fields, deleting presets (CalligraphicProfileRename).
 */
export function CalligraphyToolbar() {
  usePreferencesUpdates(TOOL);
  const prefs = Preferences.get();
  const presets = get_presets_list();
  const selected = update_presets_list();
  const unit = width_unit();
  const usetilt = prefs.getBool(`${TOOL}/usetilt`, true);

  const field = (name: AdjustmentName) => {
    const adj = ADJUSTMENTS.find((a) => a[0] === name);
    if (!adj) return null;
    const [, , lower, upper, step, digits] = adj;
    const [label, tooltip] = LABELS[name];
    return (
      <SpinButton
        label={_(label)}
        tooltip={_(tooltip)}
        value={widget_value(name) as number}
        min={lower}
        max={upper}
        step={step}
        digits={digits}
        disabled={name === 'angle' && usetilt}
        onChange={(v) => adjustment_value_changed(name, v)}
      />
    );
  };

  return (
    <>
      <select
        title={_('Choose a preset')}
        aria-label={_('Choose a preset')}
        value={selected}
        onChange={(e) => change_profile(Number(e.target.value))}
      >
        <option value={0}>{_('No preset')}</option>
        {presets.map((p, i) => {
          const name = prefs.getString(`${p}/name`);
          return name ? (
            <option key={p} value={i + 1}>
              {_(name)}
            </option>
          ) : null;
        })}
      </select>
      <IconButton
        icon="document-properties"
        tooltip={_('Add or edit calligraphic profile')}
        onClick={() => {
          const current = selected ? prefs.getString(`${presets[selected - 1]}/name`) : '';
          const name = window.prompt(_('Profile name:'), current);
          if (name) save_profile(name, current);
        }}
      />
      <span className="toolbar-separator" />
      {field('width')}
      <select
        title={_('Width')}
        aria-label={_('Unit')}
        value={unit}
        onChange={(e) => unit_changed(e.target.value)}
      >
        {['%', ...unitsOfType(UnitType.LINEAR).map((u) => u.abbr)].map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <PrefToggleButton
        icon="draw-use-pressure"
        tooltip={_('Use the pressure of the input device to alter the width of the pen')}
        path={`${TOOL}/usepressure`}
      />
      <PrefToggleButton
        icon="draw-trace-background"
        tooltip={_(
          'Trace the lightness of the background by the width of the pen (white - minimum width, black - maximum width)',
        )}
        path={`${TOOL}/tracebackground`}
      />
      <span className="toolbar-separator" />
      {field('thinning')}
      {field('mass')}
      <span className="toolbar-separator" />
      {field('angle')}
      <PrefToggleButton
        icon="draw-use-tilt"
        tooltip={_("Use the tilt of the input device to alter the angle of the pen's nib")}
        path={`${TOOL}/usetilt`}
        def={true}
      />
      {field('flatness')}
      <span className="toolbar-separator" />
      {field('cap_rounding')}
      {field('tremor')}
      {field('wiggle')}
    </>
  );
}
