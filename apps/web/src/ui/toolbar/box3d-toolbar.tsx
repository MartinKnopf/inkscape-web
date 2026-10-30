// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/box3d-toolbar.cpp, src/ui/toolbar/box3d-toolbar.h, share/ui/toolbar-box3d.ui
/*
 * 3d box toolbar
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
import { _, C_, DocumentUndo, Persp3D, Preferences, Proj, perspList, SPBox3D } from '@inkscape-web/core';
import type { SPDesktop } from '@inkscape-web/editor';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, useSelectionUpdates } from './toolbar.tsx';

/** The perspective of the toolbar: the first one of the selected boxes (upstream: perspList().front()). */
function selectedPersp(desktop: SPDesktop): Persp3D | null {
  return perspList(desktop.getSelection())[0] ?? null;
}

/** Set the direction of an infinite vanishing point of the selected perspective (upstream angle_value_changed). */
export function angle_value_changed(desktop: SPDesktop, axis: Proj.Axis, angle: number): void {
  // this can happen when the document is created; we silently ignore it
  const persp = selectedPersp(desktop);
  if (!persp) return;
  persp.perspective_impl.tmat.set_infinite_direction(axis, angle);
  persp.updateRepr();
  persp.update_box_reprs();
  // TODO: use the correct axis here, too
  DocumentUndo.maybeDone(
    desktop.getDocument(),
    'perspangle',
    C_('Undo', '3D Box: Change perspective (angle of infinite axis)'),
    'draw-cuboid',
  );
}

/** Make a vanishing point of the selected perspective finite or infinite (upstream vp_state_changed). */
export function vp_state_changed(desktop: SPDesktop, axis: Proj.Axis, set_infinite: boolean): void {
  // TODO: Take all selected perspectives into account
  selectedPersp(desktop)?.set_VP_state(
    axis,
    set_infinite ? Proj.VPState.VP_INFINITE : Proj.VPState.VP_FINITE,
  );
}

/** An angle in degrees in [0, 360) (upstream deg_from_rad(Angle::from_degrees(angle).radians0())). */
function angle0(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Controls of the 3D box tool: per axis, the angle of the perspective lines of an infinite
 * vanishing point and the toggle between finite and infinite, for the perspective of the selected
 * box. Without a selected box the preferences are shown.
 */
export function Box3DToolbar({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  const prefs = Preferences.get();
  const single = desktop.getSelection().singleItem();
  const persp = single instanceof SPBox3D ? single.get_perspective() : null;
  // The tool makes the perspective of the selected box the current one (upstream: _selectionChanged here).
  const axis = (a: Proj.Axis, name: 'x' | 'y' | 'z', label: string, angle_tip: string, state_tip: string) => {
    const is_infinite = persp
      ? !Persp3D.VP_is_finite(persp.perspective_impl, a)
      : prefs.getBool(`/tools/shapes/3dbox/vp_${name}_state`, true);
    const angle =
      persp && is_infinite
        ? angle0(persp.get_infinite_angle(a))
        : prefs.getDouble(`/tools/shapes/3dbox/box3d_angle_${name}`, 30);
    return (
      <>
        <SpinButton
          label={label}
          tooltip={angle_tip}
          value={angle}
          min={-360}
          max={360}
          step={1}
          digits={0}
          disabled={!!persp && !is_infinite}
          onChange={(v) => {
            prefs.setDouble(`/tools/shapes/3dbox/box3d_angle_${name}`, v);
            angle_value_changed(desktop, a, v);
          }}
        />
        <IconButton
          icon="perspective-parallel"
          tooltip={state_tip}
          active={is_infinite}
          onClick={() => {
            prefs.setBool(`/tools/shapes/3dbox/vp_${name}_state`, !is_infinite);
            vp_state_changed(desktop, a, !is_infinite);
          }}
        />
      </>
    );
  };
  return (
    <>
      {axis(
        Proj.Axis.X,
        'x',
        _('Angle X'),
        _('Angle of perspective lines in x-direction'),
        _("Toggle vanishing point in x-direction between 'finite' and 'infinite' (= parallel)"),
      )}
      <span className="toolbar-separator" />
      {axis(
        Proj.Axis.Y,
        'y',
        _('Angle Y'),
        _('Angle of perspective lines in y-direction'),
        _("Toggle vanishing point in y-direction between 'finite' and 'infinite' (= parallel)"),
      )}
      <span className="toolbar-separator" />
      {axis(
        Proj.Axis.Z,
        'z',
        _('Angle Z'),
        _('Angle of perspective lines in z-direction'),
        _("Toggle vanishing point in z-direction between 'finite' and 'infinite' (= parallel)"),
      )}
    </>
  );
}
