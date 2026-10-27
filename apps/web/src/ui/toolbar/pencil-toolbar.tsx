// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/pencil-toolbar.cpp, src/ui/toolbar/pencil-toolbar.h, share/ui/toolbar-pencil.ui
/*
 * Pencil and pen toolbars
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
import { PenTool, type SPDesktop } from '@inkscape-web/editor';
import { useEffect, useReducer } from 'react';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton } from './toolbar.tsx';

/** The mode buttons of mode_buttons_box: icon, tooltip, and whether the pencil has it. */
const MODES: readonly [icon: string, tooltip: string, pencil: boolean][] = [
  ['path-mode-bezier', 'Create regular Bezier path', true],
  ['path-mode-spiro', 'Create Spiro path', true],
  ['path-mode-bspline', 'Create BSpline path', true],
  ['path-mode-polyline', 'Create a sequence of straight line segments', false],
  ['path-mode-polyline-paraxial', 'Create a sequence of paraxial line segments', false],
];

/** Set the freehand mode of the tool (upstream mode_changed). */
function mode_changed(desktop: SPDesktop, tool_path: string, mode: number): void {
  Preferences.get().setInt(`${tool_path}/freehand-mode`, mode);
  // Recall, the PencilToolbar is also used as the PenToolbar with minor changes.
  const pt = desktop.getTool();
  if (pt instanceof PenTool) pt.setPolylineMode();
}

/**
 * Controls of the pen tool and (pencil_mode) the pencil tool: the mode of
 * new paths and, for the pencil, the smoothing.
 * TODO: the Spiro, BSpline, polyline and paraxial modes (disabled until the
 * tools have them), pressure, simplify, shapes, the flatten buttons.
 */
export function PencilToolbar({ desktop, pencil_mode }: { desktop: SPDesktop; pencil_mode: boolean }) {
  const tool_path = pencil_mode ? '/tools/freehand/pencil' : '/tools/freehand/pen';
  const [, update] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () => Preferences.get().changedSignal.connect((path) => path.startsWith(tool_path) && update()),
    [tool_path],
  );

  const prefs = Preferences.get();
  const freehandMode = prefs.getInt(`${tool_path}/freehand-mode`, 0);
  const modes = pencil_mode ? MODES.filter((m) => m[2]) : MODES;
  const active = freehandMode < modes.length ? freehandMode : 0;

  return (
    <>
      <span title={_('Mode of new lines drawn by this tool')}>{_('Mode')}</span>
      {modes.map(([icon, tooltip], i) => (
        <IconButton
          key={icon}
          icon={icon}
          tooltip={_(tooltip)}
          active={active === i}
          disabled={i !== 0}
          onClick={() => mode_changed(desktop, tool_path, i)}
        />
      ))}
      {pencil_mode && (
        <>
          <span className="toolbar-separator" />
          <SpinButton
            label={_('Smoothing')}
            tooltip={_('How much smoothing (simplifying) is applied to the line')}
            value={prefs.getDouble('/tools/freehand/pencil/tolerance', 3.0)}
            min={0}
            max={100}
            step={0.5}
            digits={2}
            onChange={(v) => prefs.setDouble('/tools/freehand/pencil/tolerance', v)}
          />
        </>
      )}
    </>
  );
}
