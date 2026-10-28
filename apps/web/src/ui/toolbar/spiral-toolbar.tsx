// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/spiral-toolbar.cpp, src/ui/toolbar/spiral-toolbar.h, share/ui/toolbar-spiral.ui
/*
 * Spiral toolbar
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
import { _, C_, DocumentUndo, Preferences, SPSpiral } from '@inkscape-web/core';
import type { SPDesktop } from '@inkscape-web/editor';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, ModeLabel, selectedOfType, useSelectionUpdates } from './toolbar.tsx';

type SpiralField = 'revolution' | 'expansion' | 't0';

/** Upstream defaults of the fields (also used by the reset button). */
const DEFAULTS: Record<SpiralField, number> = { revolution: 3.0, expansion: 1.0, t0: 0.0 };

/** Set sodipodi:<value_name> of the selected spirals and the tool preference. */
export function spiralValueChanged(desktop: SPDesktop, value_name: SpiralField, value: number): void {
  const doc = desktop.getDocument();
  if (DocumentUndo.getUndoSensitive(doc))
    Preferences.get().setDouble(`/tools/shapes/spiral/${value_name}`, value);

  let modified = false;
  for (const item of selectedOfType(desktop, SPSpiral)) {
    item.getRepr().setAttributeSvgDouble(`sodipodi:${value_name}`, value);
    item.updateRepr();
    modified = true;
  }
  if (modified) DocumentUndo.maybeDone(doc, value_name, C_('Undo', 'Change spiral'), 'draw-spiral');
}

/**
 * Controls of the spiral tool: turns, divergence and inner radius of the
 * selected spiral, or of new spirals.
 * TODO: the numeric menus.
 */
export function SpiralToolbar({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  const spirals = selectedOfType(desktop, SPSpiral);
  const repr = spirals.length === 1 ? spirals[0]?.getRepr() : null;
  const value = (name: SpiralField) => {
    const v = Number.parseFloat(repr?.attribute(`sodipodi:${name}`) ?? '');
    return repr && !Number.isNaN(v)
      ? v
      : Preferences.get().getDouble(`/tools/shapes/spiral/${name}`, DEFAULTS[name]);
  };
  const field = (
    name: SpiralField,
    label: string,
    tooltip: string,
    range: [min: number, max: number, step: number, digits: number],
  ) => (
    <SpinButton
      label={label}
      tooltip={tooltip}
      value={value(name)}
      min={range[0]}
      max={range[1]}
      step={range[2]}
      digits={range[3]}
      onChange={(v) => spiralValueChanged(desktop, name, v)}
    />
  );

  return (
    <>
      <ModeLabel n_selected={spirals.length} />
      {field('revolution', _('Turns'), _('Number of revolutions'), [0.01, 1024, 0.1, 2])}
      {field(
        'expansion',
        _('Divergence'),
        _('How much denser/sparser are outer revolutions; 1 = uniform'),
        [0, 1000, 0.1, 3],
      )}
      {field(
        't0',
        _('Inner Radius'),
        _('Radius of the innermost revolution (relative to the spiral size)'),
        [0, 0.999, 0.01, 3],
      )}
      <IconButton
        icon="edit-clear"
        tooltip={_(
          'Reset shape parameters to defaults (use Inkscape Preferences > Tools to change defaults)',
        )}
        onClick={() => {
          for (const name of ['revolution', 'expansion', 't0'] as const) {
            spiralValueChanged(desktop, name, DEFAULTS[name]);
          }
        }}
      />
    </>
  );
}
