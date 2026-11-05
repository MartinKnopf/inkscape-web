// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-node-align.cpp, src/actions/actions-node-align.h
/*
 * Gio::Actions for aligning and distributing nodes.
 *
 * Copyright (C) 2020 Tavmjong Bah
 *
 * Some code and ideas from src/ui/dialogs/align-and-distribute.cpp
 *   Authors: Bryce Harrington
 *            Martin Owens
 *            John Smith
 *            Patrick Storz
 *            Jabier Arraiza
 */
import { N_, NC_, Preferences } from '@inkscape-web/core';
import { type Dim2, X, Y } from '@inkscape-web/geom';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { AlignTargetNode } from '../ui/tool/node-types.ts';
import { show_output } from './actions-helper.ts';
import { node_multipath } from './actions-node-tool.ts';

/**
 * Align the selected nodes of the node tool (win.node-align-horizontal and -vertical). value is
 * zero or one word: last, first, middle, min, max or pref (the preference
 * /dialogs/align/nodes-align-to); the default is middle.
 */
export function node_align(app: InkscapeApplication, value: string, direction: Dim2): void {
  const desktop = app.get_active_desktop();
  const multipath = desktop && node_multipath(desktop, 'node_align');
  if (!multipath) return;

  const tokens = value.split(' ');
  if (tokens.length > 1) {
    show_output('node_align: too many arguments!');
    return;
  }

  let target = AlignTargetNode.MID_NODE;
  let token = tokens[0] ?? '';
  if (token === 'pref') token = Preferences.get().getString('/dialogs/align/nodes-align-to', 'first');
  if (token === 'last') target = AlignTargetNode.LAST_NODE;
  else if (token === 'first') target = AlignTargetNode.FIRST_NODE;
  else if (token === 'middle') target = AlignTargetNode.MID_NODE;
  else if (token === 'min') target = AlignTargetNode.MIN_NODE;
  else if (token === 'max') target = AlignTargetNode.MAX_NODE;
  multipath.alignNodes(direction, target);
}

/** Distribute the selected nodes of the node tool (win.node-distribute-horizontal and -vertical). */
export function node_distribute(app: InkscapeApplication, direction: Dim2): void {
  const desktop = app.get_active_desktop();
  if (desktop) node_multipath(desktop, 'node_distribute')?.distributeNodes(direction);
}

const SECTION = NC_('Action Section', 'Node');

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_node_align: readonly (readonly [string, string, string, string])[] = [
  [
    'win.node-align-horizontal',
    N_('Align nodes horizontally'),
    SECTION,
    N_('Align selected nodes horizontally; usage [last|first|middle|min|max|pref]'),
  ],
  [
    'win.node-align-vertical',
    N_('Align nodes vertically'),
    SECTION,
    N_('Align selected nodes vertically; usage [last|first|middle|min|max|pref]'),
  ],
  [
    'win.node-distribute-horizontal',
    N_('Distribute nodes horizontally'),
    SECTION,
    N_('Distribute selected nodes horizontally'),
  ],
  [
    'win.node-distribute-vertical',
    N_('Distribute nodes vertically'),
    SECTION,
    N_('Distribute selected nodes vertically'),
  ],
];

/** Register the win.node-align-* and win.node-distribute-* actions; they need the node tool and selected nodes. */
export function add_actions_node_align(app: InkscapeApplication): void {
  const win = app.actions.win;
  win.add_action_with_parameter('node-align-horizontal', 's', (value) => node_align(app, value, X));
  win.add_action_with_parameter('node-align-vertical', 's', (value) => node_align(app, value, Y));
  win.add_action('node-distribute-horizontal', () => node_distribute(app, X));
  win.add_action('node-distribute-vertical', () => node_distribute(app, Y));
  app.get_action_extra_data().add_data(raw_data_node_align);
}
