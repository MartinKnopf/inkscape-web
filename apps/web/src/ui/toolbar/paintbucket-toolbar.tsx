// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/paintbucket-toolbar.cpp, src/ui/toolbar/paintbucket-toolbar.h, share/ui/toolbar-paintbucket.ui
/*
 * Paint bucket toolbar
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
import { _, C_, Preferences, UnitType, unitsOfType } from '@inkscape-web/core';
import { channel_list, FloodTool, gap_list, PaintBucketChannels } from '@inkscape-web/editor';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, usePreferencesUpdates } from './toolbar.tsx';

const TOOL = '/tools/paintbucket';

/** Reset paint bucket parameters to defaults (upstream defaults()). */
export function paintbucket_defaults(): void {
  const prefs = Preferences.get();
  // FIXME: make defaults settable via Inkscape Options
  prefs.setInt(`${TOOL}/threshold`, 15);
  prefs.setDouble(`${TOOL}/offset`, 0.0);
  FloodTool.set_channels(PaintBucketChannels.FLOOD_CHANNELS_RGB);
  prefs.setInt(`${TOOL}/autogap`, 0);
}

/**
 * Controls of the paint bucket: fill by (visible colors, a channel or alpha), threshold,
 * grow/shrink with its unit, close gaps, reset.
 * TODO: the numeric menus of the fields.
 */
export function PaintbucketToolbar() {
  usePreferencesUpdates(TOOL);
  const prefs = Preferences.get();
  const unit = prefs.getString(`${TOOL}/offsetunits`) || 'px';
  return (
    <>
      <label className="spinbutton">
        <span className="spinbutton-label">{_('Fill by')}</span>
        <select
          value={prefs.getInt(`${TOOL}/channels`, 0)}
          onChange={(e) => FloodTool.set_channels(Number(e.target.value))}
        >
          {channel_list.map((item, i) => (
            <option key={item} value={i}>
              {_(item)}
            </option>
          ))}
        </select>
      </label>
      <SpinButton
        label={_('Threshold')}
        tooltip={_(
          'The maximum allowed difference between the clicked pixel and the neighboring pixels to be counted in the fill',
        )}
        value={prefs.getInt(`${TOOL}/threshold`, 5)}
        min={0}
        max={100}
        step={1}
        digits={0}
        onChange={(v) => prefs.setInt(`${TOOL}/threshold`, v)}
      />
      <SpinButton
        label={_('Grow/shrink by')}
        tooltip={_('The amount to grow (positive) or shrink (negative) the created fill path')}
        value={prefs.getDouble(`${TOOL}/offset`, 0)}
        min={-10000}
        max={10000}
        step={0.1}
        digits={2}
        onChange={(v) => {
          // Don't adjust the offset value because we're saving the
          // unit and it'll be correctly handled on load.
          prefs.setDouble(`${TOOL}/offset`, v);
          prefs.setString(`${TOOL}/offsetunits`, unit);
        }}
      />
      <select
        aria-label={_('Unit')}
        value={unit}
        onChange={(e) => prefs.setString(`${TOOL}/offsetunits`, e.target.value)}
      >
        {unitsOfType(UnitType.LINEAR).map((u) => (
          <option key={u.abbr} value={u.abbr}>
            {u.abbr}
          </option>
        ))}
      </select>
      <label className="spinbutton">
        <span className="spinbutton-label">{_('Close gaps')}</span>
        <select
          value={prefs.getInt(`${TOOL}/autogap`, 0)}
          onChange={(e) => prefs.setInt(`${TOOL}/autogap`, Number(e.target.value))}
        >
          {gap_list.map((item, i) => (
            <option key={item} value={i}>
              {C_('Flood autogap', item)}
            </option>
          ))}
        </select>
      </label>
      <IconButton
        icon="edit-clear"
        tooltip={_(
          'Reset paint bucket parameters to defaults (use Inkscape Preferences > Tools to change defaults)',
        )}
        onClick={paintbucket_defaults}
      />
    </>
  );
}
