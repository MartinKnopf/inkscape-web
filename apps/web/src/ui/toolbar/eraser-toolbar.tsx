// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/eraser-toolbar.cpp, src/ui/toolbar/eraser-toolbar.h, share/ui/toolbar-eraser.ui
/*
 * Erasor aux toolbar
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
import { DEFAULT_ERASER_MODE, EraserToolMode } from '@inkscape-web/editor';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, PrefToggleButton, usePreferencesUpdates } from './toolbar.tsx';

const TOOL = '/tools/eraser';

/** The mode buttons of mode_buttons_box: icon and tooltip, in the order of EraserToolMode. */
const MODES: readonly [icon: string, tooltip: string][] = [
  ['draw-eraser-delete-objects', 'Delete objects touched by eraser'],
  ['path-difference', 'Cut out from paths and shapes'],
  ['path-intersection', 'Clip from objects'],
];

/** The number fields: preference name, default, lower, upper, step, digits, label, tooltip. */
const FIELDS = [
  ['width', 15, 0, 100, 1, 0, 'Width', 'The width of the eraser pen (relative to the visible canvas area)'],
  [
    'thinning',
    10,
    -100,
    100,
    1,
    0,
    'Thinning',
    'How much velocity thins the stroke (> 0 makes fast strokes thinner, < 0 makes them broader, 0 makes width independent of velocity)',
  ],
  [
    'cap_rounding',
    0.0,
    0,
    5,
    0.01,
    2,
    'Caps',
    'Increase to make caps at the ends of strokes protrude more (0 = no caps, 1 = round caps)',
  ],
  ['tremor', 0.0, 0, 100, 1, 0, 'Tremor', 'Increase to make strokes rugged and trembling'],
  ['mass', 10, 0, 100, 1, 0, 'Mass', 'Increase to make the eraser slowed by inertia'],
] as const;

/**
 * Controls of the eraser: the mode; in cut and clip mode the pen parameters;
 * in cut mode "break apart".
 * TODO: the numeric menus of the fields.
 */
export function EraserToolbar() {
  usePreferencesUpdates(TOOL);
  const prefs = Preferences.get();
  const eraser_mode = prefs.getInt(`${TOOL}/mode`, DEFAULT_ERASER_MODE);
  // Most items are only visible in CLIP and CUT modes (invisible in DELETE mode)
  const params_visibility = eraser_mode !== EraserToolMode.DELETE;
  // Split is only visible in CUT mode
  const split_visibility = eraser_mode === EraserToolMode.CUT;

  return (
    <>
      <span>{_('Mode:')}</span>
      {MODES.map(([icon, tooltip], mode) => (
        <IconButton
          key={icon}
          icon={icon}
          tooltip={_(tooltip)}
          active={eraser_mode === mode}
          onClick={() => prefs.setInt(`${TOOL}/mode`, mode)}
        />
      ))}
      {params_visibility && (
        <>
          <span className="toolbar-separator" />
          {FIELDS.map(([name, def, lower, upper, step, digits, label, tooltip]) => (
            <SpinButton
              key={name}
              label={_(label)}
              tooltip={_(tooltip)}
              value={prefs.getDouble(`${TOOL}/${name}`, def)}
              min={lower}
              max={upper}
              step={step}
              digits={digits}
              onChange={(v) => prefs.setDouble(`${TOOL}/${name}`, v)}
            />
          ))}
          <PrefToggleButton
            icon="draw-use-pressure"
            tooltip={_('Use the pressure of the input device to alter the width of the pen')}
            path={`${TOOL}/usepressure`}
          />
        </>
      )}
      {split_visibility && (
        <>
          <span className="toolbar-separator" />
          <PrefToggleButton
            icon="distribute-randomize"
            tooltip={_('Break apart cut items')}
            path={`${TOOL}/break_apart`}
          />
        </>
      )}
    </>
  );
}
