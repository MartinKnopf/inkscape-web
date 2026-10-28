// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/tool-data.cpp, src/ui/tools/tool-data.h
/**
 * The preferences path of each tool, by tool name (the target of win.tool-switch).
 * TODO: the tools_enum values, the preferences pages and get_tool_msg (status bar).
 */
export const tool_data: Readonly<Record<string, { pref_path: string }>> = {
  Select: { pref_path: '/tools/select' },
  Node: { pref_path: '/tools/nodes' },
  Booleans: { pref_path: '/tools/booleans' },
  Marker: { pref_path: '/tools/marker' },
  Rect: { pref_path: '/tools/shapes/rect' },
  Arc: { pref_path: '/tools/shapes/arc' },
  Star: { pref_path: '/tools/shapes/star' },
  '3DBox': { pref_path: '/tools/shapes/3dbox' },
  Spiral: { pref_path: '/tools/shapes/spiral' },
  Pencil: { pref_path: '/tools/freehand/pencil' },
  Pen: { pref_path: '/tools/freehand/pen' },
  Calligraphic: { pref_path: '/tools/calligraphic' },
  Text: { pref_path: '/tools/text' },
  Gradient: { pref_path: '/tools/gradient' },
  Mesh: { pref_path: '/tools/mesh' },
  Zoom: { pref_path: '/tools/zoom' },
  Measure: { pref_path: '/tools/measure' },
  Dropper: { pref_path: '/tools/dropper' },
  Tweak: { pref_path: '/tools/tweak' },
  Spray: { pref_path: '/tools/spray' },
  Connector: { pref_path: '/tools/connector' },
  PaintBucket: { pref_path: '/tools/paintbucket' },
  Eraser: { pref_path: '/tools/eraser' },
  LPETool: { pref_path: '/tools/lpetool' },
  Pages: { pref_path: '/tools/pages' },
  Picker: { pref_path: '/tools/picker' },
};

/** The tool name of a preferences path, or '' (upstream pref_path_to_tool_name). */
export function pref_path_to_tool_name(pref_path: string): string {
  for (const [name, data] of Object.entries(tool_data)) if (data.pref_path === pref_path) return name;
  return '';
}
