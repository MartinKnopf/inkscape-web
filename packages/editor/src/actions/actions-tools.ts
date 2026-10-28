// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-tools.cpp, src/actions/actions-tools.h
/*
 * Gio::Actions for switching tools.
 *
 * Copyright (C) 2020 Tavmjong Bah
 */
import { N_, NC_, SPGenericEllipse, type SPItem, SPPath, SPRect, SPSpiral, SPStar } from '@inkscape-web/core';
import type { SPDesktop } from '../desktop.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { pref_path_to_tool_name, tool_data } from '../ui/tools/tool-data.ts';

/** The name of the active tool of desktop ("Select", "Rect", ...), the state of win.tool-switch. */
export function get_active_tool(desktop: SPDesktop): string {
  const tool = desktop.getTool();
  return tool ? pref_path_to_tool_name(tool.getPrefsPath()) : '';
}

/** Activate the tool with the name tool. */
export function set_active_tool(desktop: SPDesktop, tool: string): void {
  tool_switch(tool, desktop);
}

/** Set tool to appropriate one to edit item. TODO: 3D box, marker, connectors, text, offset. */
export function set_active_tool_for_item(desktop: SPDesktop, item: SPItem): void {
  if (item instanceof SPRect) tool_switch('Rect', desktop);
  else if (item instanceof SPGenericEllipse) tool_switch('Arc', desktop);
  else if (item instanceof SPStar) tool_switch('Star', desktop);
  else if (item instanceof SPSpiral) tool_switch('Spiral', desktop);
  else if (item instanceof SPPath) tool_switch('Node', desktop);
}

/** Switch to the tool with the name tool (the win.tool-switch action). */
export function tool_switch(tool: string, desktop: SPDesktop): void {
  // Valid tool?
  const data = tool_data[tool];
  if (!data) {
    console.warn(`tool-switch: invalid tool name: ${tool}`);
    return;
  }
  // We catch duplications here and don't switch to ourselves.
  const current_tool = get_active_tool(desktop);
  if (current_tool === tool) return;

  // TODO: the tool message in the status bar (get_tool_msg).
  desktop.setTool(data.pref_path);
  desktop.getTool()?.set_last_active_tool(current_tool);
}

let old_tool = 'Select';

/** Toggle between tool and the last used tool (the win.tool-toggle action). */
export function tool_toggle(tool: string, desktop: SPDesktop): void {
  let current_tool = get_active_tool(desktop);
  if (current_tool === tool) {
    current_tool = old_tool;
  } else {
    old_tool = current_tool;
    current_tool = tool;
  }
  tool_switch(current_tool, desktop);
}

const SECTION = NC_('Action Section', 'Tool Switch');

/**
 * Action id, label, section and tooltip of the tool actions (untranslated).
 * TODO: the other tools.
 */
export const raw_data_tools: readonly (readonly [string, string, string, string])[] = [
  ["win.tool-switch('Select')", N_('Selector Tool'), SECTION, N_('Select and transform objects')],
  ["win.tool-switch('Node')", N_('Node Tool'), SECTION, N_('Edit paths by nodes')],
  ["win.tool-switch('Rect')", N_('Rectangle Tool'), SECTION, N_('Create rectangles and squares')],
  ["win.tool-switch('Arc')", N_('Ellipse/Arc Tool'), SECTION, N_('Create circles, ellipses and arcs')],
  ["win.tool-switch('Star')", N_('Star/Polygon Tool'), SECTION, N_('Create stars and polygons')],
  ["win.tool-switch('Spiral')", N_('Spiral Tool'), SECTION, N_('Create spirals')],
  ["win.tool-switch('Pen')", N_('Pen Tool'), SECTION, N_('Draw Bezier curves and straight lines')],
  ["win.tool-switch('Pencil')", N_('Pencil Tool'), SECTION, N_('Draw freehand lines')],
  ["win.tool-switch('Gradient')", N_('Gradient Tool'), SECTION, N_('Create and edit gradients')],
  [
    "win.tool-toggle('Select')",
    N_('Toggle Selector Tool'),
    SECTION,
    N_('Toggle between Selector tool and last used tool'),
  ],
];

/**
 * Register win.tool-switch and win.tool-toggle; tools whose preferences path
 * toolIsPorted() rejects are disabled (it comes from tool-factory.ts, which
 * cannot be imported here: import cycle through tool-base.ts).
 * TODO: the action state (the active tool).
 */
export function add_actions_tools(
  app: InkscapeApplication,
  toolIsPorted: (pref_path: string) => boolean,
): void {
  const win = app.actions.win;
  // Tools that are not ported yet are disabled.
  const known = (tool: string) => toolIsPorted(tool_data[tool]?.pref_path ?? '');
  win.add_action_with_parameter(
    'tool-switch',
    's',
    (tool) => {
      const dt = app.get_active_desktop();
      if (dt) tool_switch(tool, dt);
    },
    known,
  );
  win.add_action_with_parameter(
    'tool-toggle',
    's',
    (tool) => {
      const dt = app.get_active_desktop();
      if (dt) tool_toggle(tool, dt);
    },
    known,
  );
  app.get_action_extra_data().add_data(raw_data_tools);
}
