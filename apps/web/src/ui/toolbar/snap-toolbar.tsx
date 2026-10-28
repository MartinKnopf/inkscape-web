// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/snap-toolbar.cpp, src/ui/toolbar/snap-toolbar.h, share/ui/toolbar-snap.ui
/*
 * Authors:
 *   Mike Kowalski
 *
 * Copyright (C) 2021 Authors
 */
import { _ } from '@inkscape-web/core';
import { InkscapeApplication } from '@inkscape-web/editor';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { iconUrl } from '../icon-loader.ts';

/** A number that changes when actions change (their states), to render again. */
let version = 0;
function useActionStates(): number {
  return useSyncExternalStore(
    (cb) =>
      InkscapeApplication.instance().actions.signal_changed.connect(() => {
        version++;
        cb();
      }),
    () => version,
  );
}

/** The options of the simple popover ("simple" in toolbar-snap.ui): action, label, icon. */
const SIMPLE: readonly (readonly [string, string, string])[] = [
  ['win.simple-snap-bbox', 'Bounding boxes', 'snap-bounding-box'],
  ['win.simple-snap-nodes', 'Nodes', 'snap-nodes'],
  ['win.simple-snap-alignment', 'Alignment', 'snap-alignment'],
];

/** The datum targets of the advanced popover, shown below the simple options. */
const DATUMS: readonly (readonly [string, string, string])[] = [
  ['win.snap-grid', 'Grid intersections', 'snap-grid-intersection'],
  ['win.snap-grid-line', 'Grid lines', 'snap-grid-lines'],
  ['win.snap-guide', 'Guides', 'snap-guides'],
  ['win.snap-page-border', 'Page borders', 'snap-page'],
];

function SnapCheck({ action, label, icon }: { action: string; label: string; icon: string }) {
  const app = InkscapeApplication.instance();
  const a = app.actions.lookup_action(action);
  return (
    <label className="snap-option" aria-disabled={!a?.get_enabled()}>
      <input
        type="checkbox"
        checked={a?.get_state() ?? false}
        disabled={!a?.get_enabled()}
        onChange={() => app.activate_action(action)}
      />
      <img src={iconUrl(icon)} alt="" width={16} height={16} />
      <span>{_(label)}</span>
    </label>
  );
}

/**
 * The snap controls in the commands bar (upstream SnapToolbar in simple mode):
 * the global snapping toggle (%) and a popover with the simple snap options
 * and the datum targets.
 * TODO: the advanced and permanent modes; alignment and distribution snapping is not ported.
 */
export function SnapToolbar() {
  useActionStates();
  const app = InkscapeApplication.instance();
  const global = app.actions.lookup_action('win.snap-global-toggle');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="snap-toolbar" ref={ref}>
      <button
        type="button"
        className="toolbar-button"
        aria-pressed={global?.get_state() ?? false}
        title={app.get_action_extra_data().get_tooltip_for_action('win.snap-global-toggle', true, true)}
        onClick={() => app.activate_action('win.snap-global-toggle')}
      >
        <img src={iconUrl('snap')} alt={_('Snapping')} width={16} height={16} />
      </button>
      <button
        type="button"
        className="toolbar-button snap-popover-button"
        aria-expanded={open}
        aria-label={_('Snap options')}
        onClick={() => setOpen(!open)}
      >
        ▾
      </button>
      {open && (
        <div className="snap-popover" role="dialog" aria-label={_('Snap options')}>
          <SnapCheck action="win.snap-global-toggle" label="Enable snapping" icon="snap" />
          <hr />
          {SIMPLE.map(([action, label, icon]) => (
            <SnapCheck key={action} action={action} label={label} icon={icon} />
          ))}
          <hr />
          {DATUMS.map(([action, label, icon]) => (
            <SnapCheck key={action} action={action} label={label} icon={icon} />
          ))}
        </div>
      )}
    </div>
  );
}
