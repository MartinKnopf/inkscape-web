// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/dropper-toolbar.cpp, src/ui/toolbar/dropper-toolbar.h, share/ui/toolbar-dropper.ui
/*
 * Dropper aux toolbar
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Frank Felfe <innerspace@iname.com>
 *   John Cliff <simarilius@yahoo.com>
 *   David Turner <novalis@gnu.org>
 *   Josh Andler <scislac@scislac.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *
 * Copyright (C) 2004 David Turner
 * Copyright (C) 2003 MenTaLguY
 * Copyright (C) 1999-2011 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { _, Preferences } from '@inkscape-web/core';
import { useEffect, useReducer } from 'react';

/**
 * Controls of the dropper tool: whether to pick the alpha (transparency) under the cursor
 * (/tools/dropper/pick) and whether to assign a picked alpha to the selection
 * (/tools/dropper/setalpha).
 */
export function DropperToolbar() {
  const [, update] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () => Preferences.get().changedSignal.connect((path) => path.startsWith('/tools/dropper/') && update()),
    [],
  );
  const prefs = Preferences.get();
  const pick = prefs.getInt('/tools/dropper/pick', 1) !== 0;
  const setalpha = prefs.getBool('/tools/dropper/setalpha', true);

  return (
    <>
      <span>{_('Opacity')}</span>
      <button
        type="button"
        className="toolbar-button toolbar-text-button"
        aria-pressed={pick}
        title={_(
          'Pick both the color and the alpha (transparency) under cursor; otherwise, pick only the visible color premultiplied by alpha',
        )}
        onClick={() => prefs.setInt('/tools/dropper/pick', pick ? 0 : 1)}
      >
        {_('Pick')}
      </button>
      <button
        type="button"
        className="toolbar-button toolbar-text-button"
        aria-pressed={setalpha}
        disabled={!pick}
        title={_('If alpha was picked, assign it to selection as fill or stroke transparency')}
        onClick={() => prefs.setBool('/tools/dropper/setalpha', !setalpha)}
      >
        {_('Assign')}
      </button>
    </>
  );
}
