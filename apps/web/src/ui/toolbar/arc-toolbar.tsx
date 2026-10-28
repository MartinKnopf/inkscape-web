// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/arc-toolbar.cpp, src/ui/toolbar/arc-toolbar.h, share/ui/toolbar-arc.ui
/*
 * Arc aux toolbar
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
import { _, C_, DocumentUndo, Preferences, SPGenericEllipse } from '@inkscape-web/core';
import type { SPDesktop } from '@inkscape-web/editor';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, ModeLabel, selectedOfType, useSelectionUpdates } from './toolbar.tsx';

/**
 * Set the radius of the selected ellipses and the tool preference (px).
 * A radius of 0 is ignored.
 */
export function arcValueChanged(desktop: SPDesktop, value_name: 'rx' | 'ry', value: number): void {
  // Per SVG spec "a [radius] value of zero disables rendering of the element".
  // However our implementation does not allow a setting of zero in the UI (not even in the XML editor)
  // and ugly things happen if it's forced here, so better leave the properties untouched.
  if (!value) return;
  Preferences.get().setDouble(`/tools/shapes/arc/${value_name}`, value);

  let modified = false;
  for (const ge of selectedOfType(desktop, SPGenericEllipse)) {
    if (value_name === 'rx') ge.setVisibleRx(value);
    else ge.setVisibleRy(value);
    ge.normalize();
    ge.updateRepr();
    modified = true;
  }
  if (modified) {
    DocumentUndo.maybeDone(
      desktop.getDocument(),
      value_name,
      C_('Undo', 'Ellipse: Change radius'),
      'draw-ellipse',
    );
  }
}

/** Set the start or end angle (degrees) of the selected ellipses and the tool preference. */
export function startendValueChanged(desktop: SPDesktop, value_name: 'start' | 'end', value: number): void {
  Preferences.get().setDouble(`/tools/shapes/arc/${value_name}`, value);

  let modified = false;
  for (const ge of selectedOfType(desktop, SPGenericEllipse)) {
    const val = (value * Math.PI) / 180;
    if (value_name === 'start') ge.start = val;
    else ge.end = val;
    ge.normalize();
    ge.updateRepr();
    modified = true;
  }
  if (modified) {
    DocumentUndo.maybeDone(
      desktop.getDocument(),
      value_name,
      C_('Undo', 'Arc: Change start/end'),
      'draw-ellipse',
    );
  }
}

/** Set the arc type (0 slice, 1 arc, 2 chord) of the selected ellipses and the tool preference. */
export function typeChanged(desktop: SPDesktop, type: number): void {
  Preferences.get().setInt('/tools/shapes/arc/arc_type', type);
  const arc_type = ['slice', 'arc', 'chord'][type] ?? 'slice';
  // For backward compat, chord is not truly open but chord most like arc.
  const open = type !== 0;

  let modified = false;
  for (const item of selectedOfType(desktop, SPGenericEllipse)) {
    const repr = item.getRepr();
    repr.setAttribute('sodipodi:open', open ? 'true' : null);
    repr.setAttribute('sodipodi:arc-type', arc_type);
    item.updateRepr();
    modified = true;
  }
  if (modified) DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Arc: Change arc type'), 'draw-ellipse');
}

/** The angle in degrees in [0, 360) (upstream deg_from_rad(Angle(rad).radians0())). */
const deg0 = (rad: number) => {
  const d = ((rad * 180) / Math.PI) % 360;
  return d < 0 ? d + 360 : d;
};

/**
 * Controls of the ellipse tool: radii, start and end angle, and arc type of
 * the selected ellipse, or of new ellipses.
 * TODO: Cx and Cy, units (values are px), the numeric menus.
 */
export function ArcToolbar({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  const prefs = Preferences.get();
  const ellipses = selectedOfType(desktop, SPGenericEllipse);
  const single = ellipses.length === 1 ? ellipses[0] : null;

  const rx = single ? single.getVisibleRx() : prefs.getDouble('/tools/shapes/arc/rx', 0);
  const ry = single ? single.getVisibleRy() : prefs.getDouble('/tools/shapes/arc/ry', 0);
  const start = single ? deg0(single.start) : prefs.getDouble('/tools/shapes/arc/start', 0);
  const end = single ? deg0(single.end) : prefs.getDouble('/tools/shapes/arc/end', 0);
  const arc_type = single
    ? single.arc_type
    : Math.min(Math.max(prefs.getInt('/tools/shapes/arc/arc_type', 0), 0), 2);
  // only for a single selected ellipse (for now)
  const whole_disabled = start === 0 && end === 0 && !!single;

  const radius = (name: 'rx' | 'ry', value: number, tooltip: string) => (
    <SpinButton
      label={name === 'rx' ? _('Rx') : _('Ry')}
      tooltip={tooltip}
      value={value}
      min={0}
      max={1e6}
      step={0.1}
      digits={3}
      disabled={ellipses.length === 0}
      onChange={(v) => arcValueChanged(desktop, name, v)}
    />
  );
  const angle = (name: 'start' | 'end', value: number, label: string, tooltip: string) => (
    <SpinButton
      label={label}
      tooltip={tooltip}
      value={value}
      min={-360}
      max={360}
      step={1}
      digits={3}
      suffix="°"
      onChange={(v) => startendValueChanged(desktop, name, v)}
    />
  );
  const types = [
    ['draw-ellipse-segment', _('Switch to slice (closed shape with two radii)')],
    ['draw-ellipse-arc', _('Switch to arc (unclosed shape)')],
    ['draw-ellipse-chord', _('Switch to chord (closed shape)')],
  ] as const;

  return (
    <>
      <ModeLabel n_selected={ellipses.length} />
      {radius('rx', rx, _('Horizontal radius of the circle, ellipse, or arc'))}
      {radius('ry', ry, _('Vertical radius of the circle, ellipse, or arc'))}
      <span className="toolbar-separator" />
      {angle(
        'start',
        start,
        _('Start'),
        _("The angle (in degrees) from the horizontal to the arc's start point"),
      )}
      {angle('end', end, _('End'), _("The angle (in degrees) from the horizontal to the arc's end point"))}
      {types.map(([icon, tooltip], i) => (
        <IconButton
          key={icon}
          icon={icon}
          tooltip={tooltip}
          active={arc_type === i}
          disabled={whole_disabled}
          onClick={() => typeChanged(desktop, i)}
        />
      ))}
      <IconButton
        icon="draw-ellipse-whole"
        tooltip={_('Make the shape a whole ellipse, not arc or segment')}
        disabled={whole_disabled}
        onClick={() => {
          startendValueChanged(desktop, 'start', 0);
          startendValueChanged(desktop, 'end', 0);
        }}
      />
    </>
  );
}
