// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/spray-toolbar.cpp, src/ui/toolbar/spray-toolbar.h, share/ui/toolbar-spray.ui
/*
 * Spray toolbar
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
 *   Jabiertxo Arraiza <jabier.arraiza@marker.es>
 *   Vaibhav Malik <vaibhavmalik2018@gmail.com>
 *
 * Copyright (C) 2004 David Turner
 * Copyright (C) 2003 MenTaLguY
 * Copyright (C) 1999-2015 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { _, Preferences } from '@inkscape-web/core';
import { SprayMode } from '@inkscape-web/editor';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, PrefToggleButton, usePreferencesUpdates } from './toolbar.tsx';

const TOOL = '/tools/spray';

/** The mode buttons of mode_buttons_box: icon and tooltip, in the order of SprayMode. */
const MODES: readonly [icon: string, tooltip: string][] = [
  ['spray-mode-copy', 'Spray copies of the initial selection'],
  ['spray-mode-clone', 'Spray clones of the initial selection'],
  ['spray-mode-union', 'Spray objects in a single path'],
  ['draw-eraser', 'Delete sprayed items from selection'],
];

/** A number field of the preference name (setup_derived_spin_button and the .ui adjustment). */
function Field(props: {
  name: string;
  def: number;
  min: number;
  max: number;
  label: string;
  tooltip: string;
  disabled?: boolean;
}) {
  const prefs = Preferences.get();
  return (
    <SpinButton
      label={_(props.label)}
      tooltip={_(props.tooltip)}
      value={prefs.getDouble(`${TOOL}/${props.name}`, props.def)}
      min={props.min}
      max={props.max}
      step={1}
      digits={0}
      disabled={props.disabled ?? false}
      onChange={(v) => prefs.setDouble(`${TOOL}/${props.name}`, v)}
    />
  );
}

/**
 * Controls of the spray tool: the mode, width, amount, rotation, scale,
 * scatter and focus, the pressure switches and "prevent overlapping" with its offset.
 * The width pressure button sets /tools/spray/usepressurewidth (upstream's
 * toggle handler sets over_no_transparent by mistake).
 * TODO: the color picker buttons (over transparent, pick fill/stroke, ...);
 * the tool does not pick colors yet. The numeric menus of the fields.
 */
export function SprayToolbar() {
  usePreferencesUpdates(TOOL);
  const prefs = Preferences.get();
  const mode = Math.min(Math.max(prefs.getInt(`${TOOL}/mode`, 1), 0), MODES.length - 1);
  // upstream init(): the options for copies and clones
  const show = mode !== SprayMode.SPRAY_MODE_SINGLE_PATH && mode !== SprayMode.SPRAY_MODE_ERASER;
  const show_rotation = show || mode === SprayMode.SPRAY_MODE_SINGLE_PATH;
  const usepressurescale = prefs.getBool(`${TOOL}/usepressurescale`, false);
  const no_overlap = prefs.getBool(`${TOOL}/no_overlap`, false);

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
      <Field
        name="width"
        def={15}
        min={1}
        max={100}
        label="Width"
        tooltip="The width of the spray area (relative to the visible canvas area)"
      />
      <PrefToggleButton
        icon="draw-use-pressure"
        tooltip={_('Use the pressure of the input device to alter the width of spray area')}
        path={`${TOOL}/usepressurewidth`}
      />
      <Field
        name="population"
        def={70}
        min={1}
        max={100}
        label="Amount"
        tooltip="Adjusts the number of items sprayed per click"
      />
      <PrefToggleButton
        icon="draw-use-pressure"
        tooltip={_('Use the pressure of the input device to alter the amount of objects sprayed per click')}
        path={`${TOOL}/usepressurepopulation`}
      />
      <span className="toolbar-separator" />
      {show_rotation && (
        <Field
          name="rotation_variation"
          def={0}
          min={0}
          max={100}
          label="Rotation"
          tooltip="Variation of the rotation of the sprayed objects; 0% for the same rotation than the original object"
        />
      )}
      <Field
        name="scale_variation"
        def={0}
        min={0}
        max={100}
        label="Scale"
        tooltip="Variation in the scale of the sprayed objects; 0% for the same scale than the original object"
        disabled={usepressurescale}
      />
      <PrefToggleButton
        icon="draw-use-pressure"
        tooltip={_('Use the pressure of the input device to alter the scale of new items')}
        path={`${TOOL}/usepressurescale`}
        onToggled={(active) => {
          if (active) prefs.setDouble(`${TOOL}/scale_variation`, 0);
        }}
      />
      <span className="toolbar-separator" />
      <Field
        name="standard_deviation"
        def={70}
        min={1}
        max={100}
        label="Scatter"
        tooltip="Increase to scatter sprayed objects"
      />
      <Field
        name="mean"
        def={0}
        min={0}
        max={100}
        label="Focus"
        tooltip="0 to spray a spot; increase to enlarge the ring radius"
      />
      {show && (
        <>
          <span className="toolbar-separator" />
          <PrefToggleButton
            icon="distribute-randomize"
            tooltip={_('Prevent overlapping objects')}
            path={`${TOOL}/no_overlap`}
            onToggled={() => prefs.setDouble(`${TOOL}/offset`, 100)}
          />
          {no_overlap && (
            <Field
              name="offset"
              def={100}
              min={0}
              max={1000}
              label="Offset"
              tooltip="Increase to segregate objects more (value in percent)"
            />
          )}
        </>
      )}
    </>
  );
}
