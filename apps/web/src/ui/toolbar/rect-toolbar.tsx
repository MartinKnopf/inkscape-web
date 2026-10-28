// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/rect-toolbar.cpp, src/ui/toolbar/rect-toolbar.h, share/ui/toolbar-rect.ui
/*
 * Rectangle toolbar
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
import { _, C_, DocumentUndo, Preferences, SPRect } from '@inkscape-web/core';
import type { SPDesktop } from '@inkscape-web/editor';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, ModeLabel, selectedOfType, useSelectionUpdates } from './toolbar.tsx';

type RectField = 'width' | 'height' | 'rx' | 'ry';

const getters: Record<RectField, (rect: SPRect) => number> = {
  width: (r) => r.getVisibleWidth(),
  height: (r) => r.getVisibleHeight(),
  rx: (r) => r.getVisibleRx(),
  ry: (r) => r.getVisibleRy(),
};
const setters: Record<RectField, (rect: SPRect, v: number) => void> = {
  width: (r, v) => r.setVisibleWidth(v),
  height: (r, v) => r.setVisibleHeight(v),
  rx: (r, v) => r.setVisibleRx(v),
  ry: (r, v) => r.setVisibleRy(v),
};

/**
 * Set a field of the selected rectangles and the tool preference (value in
 * px; 0 removes the attribute), as one undo step per field.
 */
export function rectValueChanged(desktop: SPDesktop, name: RectField, value: number): void {
  const doc = desktop.getDocument();
  if (DocumentUndo.getUndoSensitive(doc)) Preferences.get().setDouble(`/tools/shapes/rect/${name}`, value);

  let modified = false;
  for (const rect of selectedOfType(desktop, SPRect)) {
    if (value !== 0) setters[name](rect, value);
    else rect.removeAttribute(name);
    modified = true;
  }
  if (modified) DocumentUndo.maybeDone(doc, name, C_('Undo', 'Change rectangle'), 'draw-rectangle');
}

/**
 * Controls of the rectangle tool: width, height and the corner radii of the
 * selected rectangle, or of new rectangles.
 * TODO: units (values are px), the numeric menus.
 */
export function RectToolbar({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  const rects = selectedOfType(desktop, SPRect);
  const single = rects.length === 1 ? rects[0] : null;
  const value = (name: RectField) =>
    single ? getters[name](single) : Preferences.get().getDouble(`/tools/shapes/rect/${name}`, 0);
  const field = (name: RectField, label: string, tooltip: string) => (
    <SpinButton
      label={label}
      tooltip={tooltip}
      value={value(name)}
      min={0}
      max={1e6}
      step={0.1}
      digits={3}
      disabled={(name === 'width' || name === 'height') && rects.length === 0}
      onChange={(v) => rectValueChanged(desktop, name, v)}
    />
  );
  // only for a single selected rect (for now)
  const not_rounded_disabled = value('rx') === 0 && value('ry') === 0 && !!single;

  return (
    <>
      <ModeLabel n_selected={rects.length} />
      {field('width', _('W'), _('Width of rectangle'))}
      {field('height', C_('Abbreviation of Height', 'H'), _('Height of rectangle'))}
      {field('rx', _('Rx'), _('Horizontal radius of rounded corners'))}
      {field('ry', _('Ry'), _('Vertical radius of rounded corners'))}
      <IconButton
        icon="rectangle-make-corners-sharp"
        tooltip={_('Make corners sharp')}
        disabled={not_rounded_disabled}
        onClick={() => {
          rectValueChanged(desktop, 'rx', 0);
          rectValueChanged(desktop, 'ry', 0);
        }}
      />
    </>
  );
}
