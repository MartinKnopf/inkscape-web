// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/measure-toolbar.cpp, src/ui/toolbar/measure-toolbar.h, share/ui/toolbar-measure.ui
/*
 * Measure aux toolbar
 *
 * Authors:
 *   Vaibhav Malik <vaibhavmalik2018@gmail.com>
 *   Tavmjong Bah
 *
 * Copyright (C) 2003-2011 authors
 */
import { _, Preferences } from '@inkscape-web/core';
import { MeasureTool, PAGE_UNITS, type SPDesktop } from '@inkscape-web/editor';
import { useEffect, useReducer } from 'react';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton } from './toolbar.tsx';

/** The toggle buttons: preference key, default, icon and tooltip. */
const TOGGLES: readonly [key: string, def: boolean, icon: string, tooltip: string][] = [
  ['only_selected', false, 'snap-bounding-box-center', 'Measure only selected'],
  ['ignore_1st_and_last', true, 'draw-geometry-line-segment', 'Ignore first and last'],
  ['show_in_between', true, 'distribute-randomize', 'Show measures between items'],
  ['show_hidden', true, 'object-hidden', 'Show hidden intersections'],
  ['all_layers', true, 'dialog-layers', 'Measure all layers'],
];

/** Draw the measurement again after a setting changed (upstream: mt->showCanvasItems()). */
function redraw(desktop: SPDesktop): void {
  const tool = desktop.getTool();
  if (tool instanceof MeasureTool) tool.showCanvasItems();
}

/**
 * Controls of the measure tool: font size, precision, scale, unit and the toggles of
 * /tools/measure.
 * TODO: reverse, phantom, to guides, convert to item, mark dimension, the offset and the
 * settings popover.
 */
export function MeasureToolbar({ desktop }: { desktop: SPDesktop }) {
  const [, update] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () => Preferences.get().changedSignal.connect((path) => path.startsWith('/tools/measure/') && update()),
    [],
  );
  const prefs = Preferences.get();
  const set = (f: () => void) => {
    f();
    redraw(desktop);
  };
  const unit = prefs.getString('/tools/measure/unit') || desktop.getNamedView().getDisplayUnit();

  return (
    <>
      <SpinButton
        label={_('Font Size')}
        tooltip={_('The font size to be used in the measurement labels')}
        value={prefs.getDouble('/tools/measure/fontsize', 10)}
        min={1}
        max={36}
        step={1}
        digits={0}
        onChange={(v) => set(() => prefs.setDouble('/tools/measure/fontsize', v))}
      />
      <SpinButton
        label={_('Precision')}
        tooltip={_('Decimal precision of measure')}
        value={prefs.getInt('/tools/measure/precision', 2)}
        min={0}
        max={10}
        step={1}
        digits={0}
        onChange={(v) => set(() => prefs.setInt('/tools/measure/precision', v))}
      />
      <SpinButton
        label={_('Scale')}
        tooltip={_('Scale the results')}
        value={prefs.getDouble('/tools/measure/scale', 100)}
        min={0}
        max={90000}
        step={1}
        digits={2}
        onChange={(v) => set(() => prefs.setDouble('/tools/measure/scale', v))}
      />
      <label className="spinbutton" title={_('Measure only selected')}>
        <span className="spinbutton-label">{_('Units')}</span>
        <select
          value={unit}
          onChange={(e) => set(() => prefs.setString('/tools/measure/unit', e.target.value))}
        >
          {PAGE_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <span className="toolbar-separator" />
      {TOGGLES.map(([key, def, icon, tooltip]) => {
        const path = `/tools/measure/${key}`;
        const active = prefs.getBool(path, def);
        return (
          <IconButton
            key={key}
            icon={icon}
            tooltip={_(tooltip)}
            active={active}
            onClick={() => set(() => prefs.setBool(path, !active))}
          />
        );
      })}
    </>
  );
}
