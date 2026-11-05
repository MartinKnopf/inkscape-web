// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/booleans-toolbar.cpp, src/ui/toolbar/booleans-toolbar.h, share/ui/toolbar-booleans.ui
/*
 * A toolbar for the Builder tool.
 *
 * Authors:
 *   Martin Owens
 *   Vaibhav Malik <vaibhavmalik2018@gmail.com>
 *
 * Copyright (C) 2022 authors
 */
import { _, Preferences } from '@inkscape-web/core';
import { InteractiveBooleansTool, type SPDesktop } from '@inkscape-web/editor';
import { runAction } from '../../app/actions.ts';
import { iconUrl } from '../icon-loader.ts';
import { IconButton, usePreferencesUpdates } from './toolbar.tsx';

/** The shape builder tool of desktop, or null. */
function booleans_tool(desktop: SPDesktop): InteractiveBooleansTool | null {
  const tool = desktop.getTool();
  return tool instanceof InteractiveBooleansTool ? tool : null;
}

/** Set the opacity of the rest of the drawing, in percent (the opacity scale of upstream). */
export function opacity_changed(desktop: SPDesktop, percent: number): void {
  const value = percent / 100.0;
  Preferences.get().setDouble('/tools/booleans/opacity', value);
  booleans_tool(desktop)?.set_opacity(value);
}

/**
 * Controls of the shape builder: add or remove mode (win.shape-builder-mode), finish (accept
 * or cancel), the opacity of the rest of the drawing and whether the selected objects are
 * replaced (win.shape-builder-replace).
 */
export function BooleansToolbar({ desktop }: { desktop: SPDesktop }) {
  usePreferencesUpdates('/tools/booleans/');
  const prefs = Preferences.get();
  const mode = prefs.getInt('/tools/booleans/mode', 0);
  const replace = prefs.getBool('/tools/booleans/replace', true);
  const opacity = Math.round(prefs.getDouble('/tools/booleans/opacity', 0.5) * 100);

  return (
    <>
      <IconButton
        icon="shapebuilder-tool-union"
        tooltip={_('Add to the Shape')}
        active={mode === 0}
        onClick={() => runAction('win.shape-builder-mode(0)')}
      />
      <IconButton
        icon="shapebuilder-tool-difference"
        tooltip={_('Remove from Shape')}
        active={mode === 1}
        onClick={() => runAction('win.shape-builder-mode(1)')}
      />
      <span className="toolbar-separator" />
      <span>{_('Finish:')}</span>
      <IconButton icon="on" tooltip={_('Accept')} onClick={() => booleans_tool(desktop)?.shape_commit()} />
      <IconButton icon="off" tooltip={_('Cancel')} onClick={() => booleans_tool(desktop)?.shape_cancel()} />
      <span className="toolbar-separator" />
      <label className="spinbutton" title={_('Opacity')}>
        <img src={iconUrl('object-visible')} alt="" width={16} height={16} />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={opacity}
          onChange={(e) => opacity_changed(desktop, Number(e.target.value))}
        />
      </label>
      <IconButton
        icon="layer-delete"
        tooltip={_('Remove selected objects when shape building is completed')}
        active={replace}
        onClick={() => runAction('win.shape-builder-replace')}
      />
    </>
  );
}
