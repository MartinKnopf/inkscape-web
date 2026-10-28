// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-node-tool.cpp, src/actions/actions-node-tool.h
/*
 * Gio::Actions for operating on nodes without GUI.
 *
 * Requires nodes to be selected which currently can only be done with node tool.
 *
 * Copyright (C) 2026 Tavmjong Bah
 *
 * Some code and ideas from src/ui/dialogs/align-and-distribute.cpp
 *   Authors: Bryce Harrington
 *            Martin Owens
 *            John Smith
 *            Patrick Storz
 *            Jabier Arraiza
 */
import { N_, NC_, Preferences } from '@inkscape-web/core';
import type { SPDesktop } from '../desktop.ts';
import { ExtremumType } from '../ui/tool/manipulator.ts';
import type { MultiPathManipulator } from '../ui/tool/multi-path-manipulator.ts';
import { NodeType, SegmentType } from '../ui/tool/node-types.ts';
import { NodeDeleteMode } from '../ui/tool/path-manipulator.ts';
import { NodeTool } from '../ui/tools/node-tool.ts';

/** The multi path manipulator of the node tool of desktop, or null if the node tool is not active. */
function node_multipath(desktop: SPDesktop, name: string): MultiPathManipulator | null {
  const tool = desktop.getTool();
  if (!(tool instanceof NodeTool)) {
    console.warn(`${name}: tool is not Node tool!`);
    return null;
  }
  return tool._multipath;
}

/**
 * The window actions of the node tool, by action name (without "win."). They
 * require the node tool to be active and nodes to be selected.
 * TODO: win.node-simplify (simplifyInvisible).
 */
export const node_tool_actions: Readonly<Record<string, (desktop: SPDesktop) => void>> = {
  'node-nodes-insert': (dt) => node_multipath(dt, 'node_nodes_insert')?.insertNodes(),
  'node-nodes-delete': (dt) =>
    node_multipath(dt, 'node_nodes_delete')?.deleteNodes(
      Preferences.get().getInt('/tools/node/delete-mode-default', NodeDeleteMode.automatic),
    ),
  'node-nodes-insert-left': (dt) => node_nodes_insert_extrema(dt, ExtremumType.EXTR_MIN_X),
  'node-nodes-insert-right': (dt) => node_nodes_insert_extrema(dt, ExtremumType.EXTR_MAX_X),
  'node-nodes-insert-top': (dt) => node_nodes_insert_extrema(dt, ExtremumType.EXTR_MIN_Y),
  'node-nodes-insert-bottom': (dt) => node_nodes_insert_extrema(dt, ExtremumType.EXTR_MAX_Y),
  'node-nodes-join': (dt) => node_multipath(dt, 'node_nodes_join')?.joinNodes(),
  'node-nodes-break': (dt) => node_multipath(dt, 'node_nodes_break')?.breakNodes(),
  'node-segments-join': (dt) => node_multipath(dt, 'node_segments_join')?.joinSegments(),
  'node-segments-delete': (dt) => node_multipath(dt, 'node_segments_delete')?.deleteSegments(),
  'node-nodes-to-cusp': (dt) => node_multipath(dt, 'node_set_node_type')?.setNodeType(NodeType.NODE_CUSP),
  'node-nodes-to-smooth': (dt) => node_multipath(dt, 'node_set_node_type')?.setNodeType(NodeType.NODE_SMOOTH),
  'node-nodes-to-symmetric': (dt) =>
    node_multipath(dt, 'node_set_node_type')?.setNodeType(NodeType.NODE_SYMMETRIC),
  'node-nodes-to-auto': (dt) => node_multipath(dt, 'node_set_node_type')?.setNodeType(NodeType.NODE_AUTO),
  'node-segments-to-lines': (dt) =>
    node_multipath(dt, 'node_set_segment_type')?.setSegmentType(SegmentType.SEGMENT_STRAIGHT),
  'node-segments-to-curves': (dt) =>
    node_multipath(dt, 'node_set_segment_type')?.setSegmentType(SegmentType.SEGMENT_CUBIC_BEZIER),
};

function node_nodes_insert_extrema(desktop: SPDesktop, type: ExtremumType): void {
  const mpm = node_multipath(desktop, 'node_nodes_insert_extrema');
  if (!mpm) return;
  if (desktop.yaxisdir() < 0) {
    // Flip y coordinate
    if (type === ExtremumType.EXTR_MIN_Y) type = ExtremumType.EXTR_MAX_Y;
    else if (type === ExtremumType.EXTR_MAX_Y) type = ExtremumType.EXTR_MIN_Y;
  }
  mpm.insertNodesAtExtrema(type);
}

const SECTION = NC_('Action Section', 'Node');

/** Action id, label, section and tooltip of the node actions (untranslated). */
export const raw_data_node_tool: readonly (readonly [string, string, string, string])[] = [
  ['win.node-nodes-insert', N_('Nodes insert'), SECTION, N_('Insert nodes in selected segments')],
  ['win.node-nodes-delete', N_('Nodes delete'), SECTION, N_('Delete selected nodes')],
  ['win.node-nodes-join', N_('Nodes join'), SECTION, N_('Join selected nodes')],
  ['win.node-nodes-break', N_('Nodes break'), SECTION, N_('Break path between selected nodes')],
  ['win.node-segments-join', N_('Segments join'), SECTION, N_('Join selected end nodes with a new segment')],
  ['win.node-segments-delete', N_('Segments break'), SECTION, N_('Delete segment between two non-end nodes')],
  [
    'win.node-simplify',
    N_('Simplify path'),
    SECTION,
    N_('Join selected nodes which are very close together'),
  ],
  ['win.node-nodes-to-cusp', N_('Nodes to cusp'), SECTION, N_('Convert selected nodes to corner nodes')],
  ['win.node-nodes-to-smooth', N_('Nodes to smooth'), SECTION, N_('Convert selected nodes to smooth nodes')],
  [
    'win.node-nodes-to-symmetric',
    N_('Nodes to symmetrical'),
    SECTION,
    N_('Convert selected nodes to symmetrical nodes'),
  ],
  ['win.node-nodes-to-auto', N_('Nodes to auto'), SECTION, N_('Convert selected nodes to auto smooth nodes')],
  [
    'win.node-segments-to-curves',
    N_('Segments to curves'),
    SECTION,
    N_('Convert selected path segments to curves'),
  ],
  [
    'win.node-segments-to-lines',
    N_('Segments to lines'),
    SECTION,
    N_('Convert selected path segments to lines'),
  ],
];
