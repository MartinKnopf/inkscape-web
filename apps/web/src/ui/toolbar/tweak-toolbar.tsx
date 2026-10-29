// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/tweak-toolbar.cpp, src/ui/toolbar/tweak-toolbar.h, share/ui/toolbar-tweak.ui
/*
 * Tweak toolbar
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
import { _, Preferences } from '@inkscape-web/core';
import { TweakMode } from '@inkscape-web/editor';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, PrefToggleButton, usePreferencesUpdates } from './toolbar.tsx';

const TOOL = '/tools/tweak';

/** The mode buttons of mode_buttons_box: icon and tooltip, in the order of TweakMode. */
const MODES: readonly [icon: string, tooltip: string][] = [
  ['object-tweak-push', 'Move objects in any direction'],
  ['object-tweak-attract', 'Move objects towards cursor; with Shift from cursor'],
  ['object-tweak-randomize', 'Move objects in random directions'],
  ['object-tweak-shrink', 'Shrink objects, with Shift enlarge'],
  ['object-tweak-rotate', 'Rotate objects, with Shift counterclockwise'],
  ['object-tweak-duplicate', 'Duplicate objects, with Shift delete'],
  ['path-tweak-push', 'Push parts of paths in any direction'],
  ['path-tweak-shrink', 'Shrink (inset) parts of paths; with Shift grow (outset)'],
  ['path-tweak-attract', 'Attract parts of paths towards cursor; with Shift from cursor'],
  ['path-tweak-roughen', 'Roughen parts of paths'],
  ['object-tweak-paint', "Paint the tool's color upon selected objects"],
  ['object-tweak-jitter-color', 'Jitter the colors of selected objects'],
  ['object-tweak-blur', 'Blur selected objects more; with Shift, blur less'],
];

/** The channel toggles: preference, label, tooltip. */
const CHANNELS: readonly [name: string, label: string, tooltip: string][] = [
  ['doh', 'H', "In color mode, act on object's hue"],
  ['dos', 'S', "In color mode, act on object's saturation"],
  ['dol', 'L', "In color mode, act on object's lightness"],
  ['doo', 'O', "In color mode, act on object's opacity"],
];

/** A field for a preference of 0..1 shown as 1..100 (width, force, fidelity). */
function PercentField(props: { name: string; label: string; tooltip: string; def: number }) {
  const prefs = Preferences.get();
  return (
    <SpinButton
      label={_(props.label)}
      tooltip={_(props.tooltip)}
      value={prefs.getDouble(`${TOOL}/${props.name}`, props.def) * 100}
      min={1}
      max={100}
      step={1}
      digits={0}
      onChange={(v) => prefs.setDouble(`${TOOL}/${props.name}`, v * 0.01)}
    />
  );
}

/**
 * Controls of the tweak tool: the mode, width, force, pressure, and fidelity
 * (path modes) or the color channels (color modes). The fields show the
 * preferences (0..1) in percent; upstream shows the raw preference.
 * TODO: the numeric menus of the fields.
 */
export function TweakToolbar() {
  usePreferencesUpdates(TOOL);
  const prefs = Preferences.get();
  const mode = Math.min(Math.max(prefs.getInt(`${TOOL}/mode`, 0), 0), MODES.length - 1);
  const flag = mode === TweakMode.TWEAK_MODE_COLORPAINT || mode === TweakMode.TWEAK_MODE_COLORJITTER;

  return (
    <>
      <span>{_('Mode')}</span>
      {MODES.map(([icon, tooltip], i) => (
        <IconButton
          key={icon}
          icon={icon}
          tooltip={_(tooltip)}
          active={mode === i}
          onClick={() => prefs.setInt(`${TOOL}/mode`, i)}
        />
      ))}
      <span className="toolbar-separator" />
      <PercentField
        name="width"
        label="Width"
        tooltip="The width of the tweak area (relative to the visible canvas area)"
        def={0.15}
      />
      <PercentField name="force" label="Force" tooltip="The force of the tweak action" def={0.2} />
      <PrefToggleButton
        icon="draw-use-pressure"
        tooltip={_('Use the pressure of the input device to alter the force of tweak action')}
        path={`${TOOL}/usepressure`}
        def={true}
      />
      <span className="toolbar-separator" />
      {flag ? (
        <>
          <span>{_('Channels:')}</span>
          {CHANNELS.map(([name, label, tooltip]) => {
            const active = prefs.getBool(`${TOOL}/${name}`, true);
            return (
              <button
                key={name}
                type="button"
                className="toolbar-button toolbar-text-button"
                title={_(tooltip)}
                aria-pressed={active}
                onClick={() => prefs.setBool(`${TOOL}/${name}`, !active)}
              >
                {_(label)}
              </button>
            );
          })}
        </>
      ) : (
        <PercentField
          name="fidelity"
          label="Fidelity"
          tooltip="Low fidelity simplifies paths; high fidelity preserves path features but may generate a lot of new nodes"
          def={0.5}
        />
      )}
    </>
  );
}
