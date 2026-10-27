// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/star-toolbar.cpp, src/ui/toolbar/star-toolbar.h, share/ui/toolbar-star.ui
/*
 * Star toolbar
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
import { _, C_, DocumentUndo, type Node, Preferences, SPStar } from '@inkscape-web/core';
import type { SPDesktop } from '@inkscape-web/editor';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, ModeLabel, selectedOfType, useSelectionUpdates } from './toolbar.tsx';

/** The attribute name of repr as a number, or def (upstream Node::getAttributeDouble). */
function attrDouble(repr: Node, name: string, def: number): number {
  const v = Number.parseFloat(repr.attribute(name) ?? '');
  return Number.isNaN(v) ? def : v;
}

/** Make the selected stars polygons (flat) or stars, and set the tool preference. */
export function side_mode_changed(desktop: SPDesktop, flat: boolean, magnitude: number): void {
  const doc = desktop.getDocument();
  if (DocumentUndo.getUndoSensitive(doc)) Preferences.get().setBool('/tools/shapes/star/isflatsided', flat);
  for (const item of selectedOfType(desktop, SPStar)) {
    const repr = item.getRepr();
    if (flat && magnitude < 3) repr.setAttributeInt('sodipodi:sides', 3);
    repr.setAttribute('inkscape:flatsided', flat ? 'true' : 'false');
    item.updateRepr();
  }
  if (flat && magnitude < 3) Preferences.get().setInt('/tools/shapes/star/magnitude', 3);
  DocumentUndo.done(doc, flat ? C_('Undo', 'Make polygon') : C_('Undo', 'Make star'), 'draw-polygon-star');
}

/** Set the number of corners of the selected stars and the tool preference. */
export function magnitude_value_changed(desktop: SPDesktop, value: number): void {
  const doc = desktop.getDocument();
  // do not remember prefs if this call is initiated by an undo change, because undoing object
  // creation sets bogus values to its attributes before it is deleted
  if (DocumentUndo.getUndoSensitive(doc)) Preferences.get().setInt('/tools/shapes/star/magnitude', value);
  for (const item of selectedOfType(desktop, SPStar)) {
    const repr = item.getRepr();
    repr.setAttributeInt('sodipodi:sides', value);
    const arg1 = attrDouble(repr, 'sodipodi:arg1', 0.5);
    repr.setAttributeSvgDouble('sodipodi:arg2', arg1 + Math.PI / value);
    item.updateRepr();
  }
  DocumentUndo.maybeDone(
    doc,
    'star:numcorners',
    C_('Undo', 'Star: Change number of corners'),
    'draw-polygon-star',
  );
}

/** Set the ratio of the base radius to the tip radius of the selected stars and the tool preference. */
export function proportion_value_changed(desktop: SPDesktop, value: number): void {
  const doc = desktop.getDocument();
  if (DocumentUndo.getUndoSensitive(doc) && !Number.isNaN(value)) {
    Preferences.get().setDouble('/tools/shapes/star/proportion', value);
  }
  for (const item of selectedOfType(desktop, SPStar)) {
    const repr = item.getRepr();
    const r1 = attrDouble(repr, 'sodipodi:r1', 1.0);
    const r2 = attrDouble(repr, 'sodipodi:r2', 1.0);
    if (r2 < r1) repr.setAttributeSvgDouble('sodipodi:r2', r1 * value);
    else repr.setAttributeSvgDouble('sodipodi:r1', r2 * value);
    item.updateRepr();
  }
  DocumentUndo.maybeDone(doc, 'star:spokeratio', C_('Undo', 'Star: Change spoke ratio'), 'draw-polygon-star');
}

/** Set inkscape:rounded or inkscape:randomized of the selected stars and the tool preference. */
export function star_value_changed(desktop: SPDesktop, name: 'rounded' | 'randomized', value: number): void {
  const doc = desktop.getDocument();
  if (DocumentUndo.getUndoSensitive(doc)) Preferences.get().setDouble(`/tools/shapes/star/${name}`, value);
  for (const item of selectedOfType(desktop, SPStar)) {
    item.getRepr().setAttributeSvgDouble(`inkscape:${name}`, value);
    item.updateRepr();
  }
  if (name === 'rounded') {
    DocumentUndo.maybeDone(doc, 'star:rounding', C_('Undo', 'Star: Change rounding'), 'draw-polygon-star');
  } else {
    DocumentUndo.maybeDone(
      doc,
      'star:randomisation',
      C_('Undo', 'Star: Change randomization'),
      'draw-polygon-star',
    );
  }
}

/**
 * Controls of the star tool: polygon or star, corners, spoke ratio,
 * rounding and randomization of the selected star, or of new stars.
 * TODO: edge length, turn upright, reset to defaults, the numeric menus.
 */
export function StarToolbar({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  const prefs = Preferences.get();
  const stars = selectedOfType(desktop, SPStar);
  const repr = stars.length === 1 ? stars[0]?.getRepr() : null;

  let flat = prefs.getBool('/tools/shapes/star/isflatsided', false);
  let magnitude = prefs.getInt('/tools/shapes/star/magnitude', flat ? 3 : 2);
  let proportion = prefs.getDouble('/tools/shapes/star/proportion', 0.5);
  let rounded = prefs.getDouble('/tools/shapes/star/rounded', 0.0);
  let randomized = prefs.getDouble('/tools/shapes/star/randomized', 0.0);
  if (repr) {
    flat = repr.attribute('inkscape:flatsided') !== 'false';
    magnitude = attrDouble(repr, 'sodipodi:sides', 0);
    const r1 = attrDouble(repr, 'sodipodi:r1', 1.0);
    const r2 = attrDouble(repr, 'sodipodi:r2', 1.0);
    proportion = r2 < r1 ? r2 / r1 : r1 / r2;
    rounded = attrDouble(repr, 'inkscape:rounded', 0.0);
    randomized = attrDouble(repr, 'inkscape:randomized', 0.0);
  }

  return (
    <>
      <ModeLabel n_selected={stars.length} />
      <IconButton
        icon="draw-polygon"
        tooltip={_('Regular polygon (with one handle) instead of a star')}
        active={flat}
        onClick={() => side_mode_changed(desktop, true, magnitude)}
      />
      <IconButton
        icon="draw-star"
        tooltip={_('Star instead of a regular polygon (with one handle)')}
        active={!flat}
        onClick={() => side_mode_changed(desktop, false, magnitude)}
      />
      <span className="toolbar-separator" />
      <SpinButton
        label={_('Corners')}
        tooltip={_('Number of corners of a polygon or star')}
        value={magnitude}
        min={flat ? 3 : 2}
        max={1024}
        step={1}
        digits={0}
        onChange={(v) => magnitude_value_changed(desktop, Math.round(v))}
      />
      {!flat && (
        <SpinButton
          label={_('Spoke Ratio')}
          tooltip={_('Base radius to tip radius ratio')}
          value={proportion}
          min={0}
          max={1}
          step={0.01}
          digits={3}
          onChange={(v) => proportion_value_changed(desktop, v)}
        />
      )}
      <SpinButton
        label={_('Rounded')}
        tooltip={_('How rounded are the corners (0 for sharp)')}
        value={rounded}
        min={-10}
        max={10}
        step={0.01}
        digits={3}
        onChange={(v) => star_value_changed(desktop, 'rounded', v)}
      />
      <SpinButton
        label={_('Randomized')}
        tooltip={_('Scatter randomly the corners and angles')}
        value={randomized}
        min={0}
        max={1e6}
        step={0.1}
        digits={3}
        onChange={(v) => star_value_changed(desktop, 'randomized', v)}
      />
    </>
  );
}
