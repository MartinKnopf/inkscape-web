// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/node-toolbar.cpp, src/ui/toolbar/node-toolbar.h, share/ui/toolbar-node.ui
/*
 * Node toolbar
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
import { _, C_, N_, Preferences } from '@inkscape-web/core';
import { NodeTool, raw_data_node_tool, type SPDesktop, shortcutLabel } from '@inkscape-web/editor';
import { Point } from '@inkscape-web/geom';
import { useEffect, useReducer } from 'react';
import { runAction } from '../../app/actions.ts';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, useSelectionUpdates } from './toolbar.tsx';

/** Label and tooltip of the actions that are not node tool actions (upstream actions-object.cpp). */
const OTHER_ACTIONS: Record<string, [string, string]> = {
  'app.object-to-path': [N_('Object to Path'), N_('Convert shapes to paths')],
};

/** The tooltip of a button: label, tooltip and first key of the action. */
function tooltip(action: string): string {
  const data = raw_data_node_tool.find((d) => d[0] === action);
  const [label, tip] = data ? [data[1], data[3]] : (OTHER_ACTIONS[action] ?? ['', '']);
  const text = `${_(label)}\n${_(tip)}`;
  const key = shortcutLabel(action);
  return key ? `${text} (${key})` : text;
}

/** The button groups of share/ui/toolbar-node.ui: action and icon. */
const BUTTON_GROUPS: readonly (readonly [action: string, icon: string][])[] = [
  [
    ['win.node-nodes-insert', 'node-add'],
    ['win.node-nodes-delete', 'node-delete'],
  ],
  [
    ['win.node-nodes-join', 'node-join'],
    ['win.node-nodes-break', 'node-break'],
  ],
  [
    ['win.node-segments-join', 'node-join-segment'],
    ['win.node-segments-delete', 'node-delete-segment'],
  ],
  [
    ['win.node-nodes-to-cusp', 'node-type-cusp'],
    ['win.node-nodes-to-smooth', 'node-type-smooth'],
    ['win.node-nodes-to-symmetric', 'node-type-symmetric'],
    ['win.node-nodes-to-auto', 'node-type-auto-smooth'],
  ],
  [
    ['win.node-segments-to-lines', 'node-segment-line'],
    ['win.node-segments-to-curves', 'node-segment-curve'],
  ],
  [['app.object-to-path', 'object-to-path']],
];

/** Re-render when the node selection or the node positions change. */
function useNodeUpdates(tool: NodeTool | null): void {
  const [, update] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!tool) return;
    const off = [
      tool._multipath.signal_coords_changed.connect(update),
      tool._selected_nodes.signal_selection_changed.connect(update),
      Preferences.get().changedSignal.connect((path) => {
        if (path.startsWith('/tools/nodes/')) update();
      }),
    ];
    return () => {
      for (const f of off) f();
    };
  }, [tool]);
}

/**
 * Controls of the node tool: node and segment operations, node types, Object
 * to Path, the position of the selected nodes (X, Y) and their distance (D,
 * for two nodes), and the handle display.
 * TODO: insert at extrema menu, simplify, corners LPE, stroke to path, units,
 * page origin, LPE parameter, outline, transform handles, masks and clips toggles.
 */
export function NodeToolbar({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  const tool = desktop.getTool();
  const nt = tool instanceof NodeTool ? tool : null;
  useNodeUpdates(nt);

  const nodes = nt?._selected_nodes;
  const bounds = nodes?.pointwiseBounds() ?? null;
  const mid = bounds?.midpoint();
  const show_handles = Preferences.get().getBool('/tools/nodes/show_handles', true);

  /** Move the selected nodes so that their midpoint has the coordinate value in dimension d. */
  const setCoordinate = (d: 0 | 1, value: number) => {
    if (!nt || !mid) return;
    const delta = d === 0 ? new Point(value - mid.x, 0) : new Point(0, value - mid.y);
    nt._multipath.move(delta);
  };
  /** Scale the two selected nodes to the distance value, around the first selected point. */
  const setDistance = (value: number) => {
    if (!nt || !bounds) return;
    const delta = value / bounds.diameter();
    if (delta > 0) {
      const center = nodes?.firstSelectedPoint() ?? bounds.midpoint();
      nt._multipath.scale(center, new Point(delta, delta));
    }
  };

  return (
    <>
      {BUTTON_GROUPS.map((group, i) => (
        <span key={group[0]?.[0]} style={{ display: 'contents' }}>
          {i > 0 && <span className="toolbar-separator" />}
          {group.map(([action, icon]) => (
            <IconButton
              key={action}
              icon={icon}
              tooltip={tooltip(action)}
              onClick={() => void runAction(action)}
            />
          ))}
        </span>
      ))}
      <span className="toolbar-separator" />
      <SpinButton
        label={_('X')}
        tooltip={_('X - Horizontal position of selected node(s)')}
        value={mid?.x ?? 0}
        min={-1e6}
        max={1e6}
        step={0.1}
        digits={3}
        disabled={!mid}
        onChange={(v) => setCoordinate(0, v)}
      />
      <SpinButton
        label={_('Y')}
        tooltip={_('Y - Vertical position of selected node(s)')}
        value={mid?.y ?? 0}
        min={-1e6}
        max={1e6}
        step={0.1}
        digits={3}
        disabled={!mid}
        onChange={(v) => setCoordinate(1, v)}
      />
      {nodes?.size() === 2 && (
        // Length is only visible when exactly two nodes are selected
        <SpinButton
          label={C_('Abbreviation of Distance', 'D')}
          tooltip={_('Distance between two selected nodes.')}
          value={bounds?.diameter() ?? 0}
          min={0}
          max={1e6}
          step={0.1}
          digits={3}
          onChange={setDistance}
        />
      )}
      <span className="toolbar-separator" />
      <IconButton
        icon="show-node-handles"
        tooltip={_('Show Bezier handles of selected nodes')}
        active={show_handles}
        onClick={() => Preferences.get().setBool('/tools/nodes/show_handles', !show_handles)}
      />
    </>
  );
}
