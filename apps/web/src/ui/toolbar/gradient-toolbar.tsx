// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/gradient-toolbar.cpp, src/ui/toolbar/gradient-toolbar.h, share/ui/toolbar-gradient.ui
/*
 * Gradient toolbar
 *
 * Authors:
 *   bulia byak <bulia@dr.com>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Abhishek Sharma
 *   Vaibhav Malik <vaibhavmalik2018@gmail.com>
 *
 * Copyright (C) 2007 Johan Engelen
 * Copyright (C) 2005 authors
 */
import {
  _,
  C_,
  cssNumber,
  DocumentUndo,
  getGradient,
  PaintTarget,
  Preferences,
  type SPGradient,
  SPGradientSpread,
  SPGradientType,
  SPStop,
  sp_item_gradient_get_spread,
  sp_item_gradient_get_vector,
} from '@inkscape-web/core';
import { GradientTool, type SPDesktop, sp_gradient_reverse_selected_gradients } from '@inkscape-web/editor';
import { useEffect, useReducer } from 'react';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, useSelectionUpdates } from './toolbar.tsx';

const ICON = 'color-gradient';

/** The repeat (spreadMethod) choices (upstream sp_get_spread_repeats). */
export const SPREAD_REPEATS: readonly [SPGradientSpread, string][] = [
  [SPGradientSpread.SP_GRADIENT_SPREAD_PAD, C_('Gradient repeat type', 'None')],
  [SPGradientSpread.SP_GRADIENT_SPREAD_REPEAT, C_('Gradient repeat type', 'Direct')],
  [SPGradientSpread.SP_GRADIENT_SPREAD_REFLECT, C_('Gradient repeat type', 'Reflected')],
];

/** The gradient (vector) and spread of the selected dragger, or else of the selection (upstream gr_read_selection). */
export function gr_read_selection(desktop: SPDesktop): {
  gr_selected: SPGradient | null;
  gr_multi: boolean;
  spr_selected: SPGradientSpread;
} {
  let gr_selected: SPGradient | null = null;
  let gr_multi = false;
  let spr_selected = SPGradientSpread.SP_GRADIENT_SPREAD_UNDEFINED;
  const add = (gradient: SPGradient | null, spread: SPGradientSpread) => {
    if (gradient?.isSolid()) gradient = null;
    if (gradient && gradient !== gr_selected) {
      if (gr_selected) gr_multi = true;
      else gr_selected = gradient;
    }
    if (spr_selected === SPGradientSpread.SP_GRADIENT_SPREAD_UNDEFINED) spr_selected = spread;
  };
  const drag = desktop.getTool()?.get_drag();
  const dragger = drag?.selected.values().next().value;
  if (dragger) {
    // GRADIENTFIXME: make this work for more than one selected dragger?
    for (const d of dragger.draggables) {
      add(
        sp_item_gradient_get_vector(d.item, d.fill_or_stroke),
        sp_item_gradient_get_spread(d.item, d.fill_or_stroke),
      );
    }
  } else {
    // If no selected dragger, read desktop selection
    for (const item of desktop.getSelection().items()) {
      for (const target of [PaintTarget.FOR_FILL, PaintTarget.FOR_STROKE]) {
        const server = getGradient(item, target);
        if (server) add(server.getVector(), server.fetchSpread());
      }
    }
  }
  return { gr_selected, gr_multi, spr_selected };
}

/** Set the spread of the gradients of the selection (upstream spread_changed). */
export function spread_changed(desktop: SPDesktop, spread: SPGradientSpread): void {
  const list = desktop
    .getSelection()
    .items()
    .flatMap((item) => [getGradient(item, PaintTarget.FOR_FILL), getGradient(item, PaintTarget.FOR_STROKE)])
    .filter((g): g is SPGradient => g !== null && !g.isSolid());
  if (!list.length) return;
  for (const g of list) {
    g.setSpread(spread);
    g.updateRepr();
  }
  DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Set gradient repeat'), ICON);
}

/** Set the offset of stop (upstream stop_offset_adjustment_changed). */
export function stop_offset_changed(stop: SPStop, offset: number): void {
  stop.offset = offset;
  stop.getRepr().setAttribute('offset', cssNumber(offset));
  DocumentUndo.maybeDone(
    stop.document,
    'gradient:stop:offset',
    C_('Undo', 'Change gradient stop offset'),
    ICON,
  );
}

/** The stop of the selected dragger (upstream select_stop_by_draggers), or null. */
function selected_stop(desktop: SPDesktop, gradient: SPGradient | null): SPStop | null {
  const drag = desktop.getTool()?.get_drag();
  const dragger = drag?.selected.values().next().value;
  const d = dragger?.draggables[0];
  if (!drag || !dragger || !d || drag.selected.size !== 1) return null;
  const stop = drag.getStop(dragger, getGradient(d.item, d.fill_or_stroke));
  return stop && stop.parent === gradient ? stop : null;
}

/** Re-render when a gradient stop is selected on the canvas (desktop.connect_gradient_stop_selected). */
function useStopSelection(desktop: SPDesktop): void {
  const [, update] = useReducer((n: number) => n + 1, 0);
  useEffect(() => desktop.connect_gradient_stop_selected(update), [desktop]);
}

/**
 * Controls of the gradient tool: the type and target of new gradients, the repeat, the stops
 * of the selected gradient with the offset of the selected stop, insert, delete and reverse.
 * TODO: the gradient list (assign another vector), stop color previews in the lists.
 */
export function GradientToolbar({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  useStopSelection(desktop);
  const prefs = Preferences.get();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const newType = prefs.getInt('/tools/gradient/newgradient', SPGradientType.SP_GRADIENT_TYPE_LINEAR);
  const newFill = prefs.getInt('/tools/gradient/newfillorstroke', 1) !== 0;
  const linked = !prefs.getBool('/options/forkgradientvectors/value', true);
  const { gr_selected, gr_multi, spr_selected } = gr_read_selection(desktop);
  const drag = desktop.getTool()?.get_drag() ?? null;
  const hasDragSelection = !!drag?.selected.size;
  const stops =
    gr_selected && !gr_multi ? gr_selected.children.filter((c): c is SPStop => c instanceof SPStop) : [];
  const stop = selected_stop(desktop, gr_selected);
  const setPref = (fn: () => void) => {
    fn();
    rerender();
  };

  return (
    <>
      <b className="toolbar-mode">{_('<b>New:</b>').replace(/<\/?b>/g, '')}</b>
      <IconButton
        icon="paint-gradient-linear"
        tooltip={_('Create linear gradient')}
        active={newType !== SPGradientType.SP_GRADIENT_TYPE_RADIAL}
        onClick={() =>
          setPref(() => prefs.setInt('/tools/gradient/newgradient', SPGradientType.SP_GRADIENT_TYPE_LINEAR))
        }
      />
      <IconButton
        icon="paint-gradient-radial"
        tooltip={_('Create radial (elliptic or circular) gradient')}
        active={newType === SPGradientType.SP_GRADIENT_TYPE_RADIAL}
        onClick={() =>
          setPref(() => prefs.setInt('/tools/gradient/newgradient', SPGradientType.SP_GRADIENT_TYPE_RADIAL))
        }
      />
      <IconButton
        icon="object-fill"
        tooltip={_('Create gradient in the fill')}
        active={newFill}
        onClick={() => setPref(() => prefs.setInt('/tools/gradient/newfillorstroke', 1))}
      />
      <IconButton
        icon="object-stroke"
        tooltip={_('Create gradient in the stroke')}
        active={!newFill}
        onClick={() => setPref(() => prefs.setInt('/tools/gradient/newfillorstroke', 0))}
      />
      <span className="toolbar-separator" />
      <IconButton
        icon={linked ? 'object-locked' : 'object-unlocked'}
        tooltip={_('Link gradients to change all related gradients')}
        active={linked}
        onClick={() => setPref(() => prefs.setBool('/options/forkgradientvectors/value', linked))}
      />
      <IconButton
        icon="object-flip-horizontal"
        tooltip={_('Reverse the direction of the gradient')}
        disabled={!gr_selected}
        onClick={() => sp_gradient_reverse_selected_gradients(desktop)}
      />
      <label className="spinbutton" title={_('Repeat')}>
        {_('Repeat')}
        <select
          disabled={!gr_selected}
          value={gr_selected ? spr_selected : SPGradientSpread.SP_GRADIENT_SPREAD_PAD}
          onChange={(e) => spread_changed(desktop, Number(e.target.value) as SPGradientSpread)}
        >
          {SPREAD_REPEATS.map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <span className="toolbar-separator" />
      <label className="spinbutton">
        {_('Stop')}
        <select
          disabled={!stops.length}
          value={stop?.getId() ?? ''}
          onChange={(e) => {
            const s = stops.find((x) => x.getId() === e.target.value) ?? null;
            if (s) drag?.selectByStop(s, false, true);
          }}
        >
          {!stops.length && (
            <option value="">
              {gr_multi
                ? _('Multiple gradients')
                : gr_selected
                  ? _('No stops in gradient')
                  : _('No gradient')}
            </option>
          )}
          {stops.length > 0 && !stop && <option value="" />}
          {stops.map((s) => (
            <option key={s.getId()} value={s.getId() ?? ''}>
              {s.getId()}
            </option>
          ))}
        </select>
      </label>
      <SpinButton
        label={_('Offset')}
        tooltip={_('Offset of selected stop')}
        value={stop?.offset ?? 0}
        min={stop?.getPrevStop()?.offset ?? 0}
        max={stop?.getNextStop()?.offset ?? 1}
        step={0.01}
        digits={2}
        disabled={!stop || gr_multi}
        onChange={(v) => stop && stop_offset_changed(stop, v)}
      />
      <IconButton
        icon="gradient-add-stop"
        tooltip={_('Insert new stop')}
        disabled={!gr_selected || gr_multi || !hasDragSelection}
        onClick={() => {
          const tool = desktop.getTool();
          if (tool instanceof GradientTool) tool.add_stops_between_selected_stops();
        }}
      />
      <IconButton
        icon="gradient-remove-stop"
        tooltip={_('Delete stop')}
        disabled={!gr_selected || gr_multi || !hasDragSelection}
        onClick={() => drag?.deleteSelected()}
      />
    </>
  );
}
