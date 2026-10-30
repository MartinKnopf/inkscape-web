// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/connector-toolbar.cpp, src/ui/toolbar/connector-toolbar.h, share/ui/toolbar-connector.ui
/*
 * Connector aux toolbar
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
import {
  _,
  avoid_item_move,
  C_,
  DocumentUndo,
  defaultConnCurvature,
  defaultConnSpacing,
  get_avoided_items,
  Preferences,
  SPPath,
} from '@inkscape-web/core';
import { cc_item_is_connector, cc_selection_set_avoid, type SPDesktop } from '@inkscape-web/editor';
import { Affine } from '@inkscape-web/geom';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, useSelectionUpdates } from './toolbar.tsx';

/** Set the type of the selected connectors, or of new ones (upstream orthogonal_toggled). */
export function orthogonal_toggled(desktop: SPDesktop, is_orthog: boolean): void {
  const doc = desktop.getDocument();
  if (!DocumentUndo.getUndoSensitive(doc)) return;
  let modified = false;
  for (const item of desktop.getSelection().items()) {
    if (!cc_item_is_connector(item)) continue;
    item.setAttribute('inkscape:connector-type', is_orthog ? 'orthogonal' : 'polyline');
    item.getAvoidRef().handleSettingChange();
    modified = true;
  }
  if (!modified) Preferences.get().setBool('/tools/connector/orthogonal', is_orthog);
  else
    DocumentUndo.done(
      doc,
      is_orthog ? C_('Undo', 'Set connector type: orthogonal') : C_('Undo', 'Set connector type: polyline'),
      'draw-connector',
    );
}

/** Set the curvature of the selected connectors, or of new ones (upstream curvature_changed). */
export function curvature_changed(desktop: SPDesktop, newValue: number): void {
  const doc = desktop.getDocument();
  if (!DocumentUndo.getUndoSensitive(doc)) return;
  let modified = false;
  for (const item of desktop.getSelection().items()) {
    if (!cc_item_is_connector(item)) continue;
    item.setAttribute('inkscape:connector-curvature', String(newValue));
    item.getAvoidRef().handleSettingChange();
    modified = true;
  }
  if (!modified) Preferences.get().setDouble('/tools/connector/curvature', newValue);
  else DocumentUndo.done(doc, C_('Undo', 'Change connector curvature'), 'draw-connector');
}

/** Set inkscape:connector-spacing and move the avoided shapes' outlines (upstream spacing_changed). */
export function spacing_changed(desktop: SPDesktop, value: number): void {
  const doc = desktop.getDocument();
  if (!DocumentUndo.getUndoSensitive(doc)) return;
  const repr = doc.getNamedView().getRepr();
  // Don't need to update the repr if the attribute doesn't
  // exist and it is being set to the default value -- as will
  // happen at startup.
  if (!repr.attribute('inkscape:connector-spacing') && value === defaultConnSpacing) return;
  repr.setAttributeSvgDouble('inkscape:connector-spacing', value);
  let modified = false;
  const lm = desktop.layerManager();
  for (const item of get_avoided_items(lm.currentRoot() ?? doc.getRoot(), (i) => lm.isLayer(i))) {
    avoid_item_move(Affine.identity(), item);
    modified = true;
  }
  if (modified) DocumentUndo.done(doc, C_('Undo', 'Change connector spacing'), 'draw-connector');
}

/**
 * Controls of the connector tool: avoid and ignore the selected objects, orthogonal or
 * polyline, curvature and spacing. The orthogonal toggle and the curvature show the selected
 * connector.
 * TODO: the graph layout (libcola) with its length, directed and remove overlaps options.
 */
export function ConnectorToolbar({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  const prefs = Preferences.get();
  const single = desktop.getSelection().singleItem();
  const conn = single instanceof SPPath ? single.connEndPair : null;
  const orthogonal = conn ? conn.isOrthogonal() : prefs.getBool('/tools/connector/orthogonal');
  const curvature = conn
    ? conn.getCurvature()
    : prefs.getDouble('/tools/connector/curvature', defaultConnCurvature);
  const spacing = desktop.getDocument().getNamedView().connector_spacing;
  return (
    <>
      <IconButton
        icon="connector-avoid"
        tooltip={_('Make connectors avoid selected objects')}
        onClick={() => cc_selection_set_avoid(desktop, true)}
      />
      <IconButton
        icon="connector-ignore"
        tooltip={_('Make connectors ignore selected objects')}
        onClick={() => cc_selection_set_avoid(desktop, false)}
      />
      <IconButton
        icon="connector-orthogonal"
        tooltip={_('Make connector orthogonal or polyline')}
        active={orthogonal}
        onClick={() => orthogonal_toggled(desktop, !orthogonal)}
      />
      <SpinButton
        label={_('Curvature')}
        tooltip={_('The amount of connectors curvature')}
        value={curvature}
        min={0}
        max={100}
        step={1}
        digits={0}
        onChange={(v) => curvature_changed(desktop, v)}
      />
      <SpinButton
        label={_('Spacing')}
        tooltip={_('The amount of space left around objects by auto-routing connectors')}
        value={spacing}
        min={0}
        max={100}
        step={1}
        digits={0}
        onChange={(v) => spacing_changed(desktop, v)}
      />
    </>
  );
}
