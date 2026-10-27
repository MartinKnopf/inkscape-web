// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/tool-toolbar.cpp, src/ui/toolbar/tool-toolbar.h, share/ui/toolbar-tool.ui
/*
 * Toolbar for Tools.
 *
 * Authors:
 *   Mike Kowalski (Popovers)
 *   Martin Owens (Tool button categories)
 *   Jonathon Neuhauser (Open tool preferences)
 *   Tavmjong Bah
 *
 * Copyright (C) 2023 Tavmjong Bah
 */
import { _ } from '@inkscape-web/core';
import { get_active_tool, raw_data_tools, type SPDesktop, shortcutLabel } from '@inkscape-web/editor';
import { Fragment, useSyncExternalStore } from 'react';
import { runAction } from '../../app/actions.ts';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { iconUrl } from '../icon-loader.ts';
import './toolbar.css';

/**
 * The tool buttons in the groups of share/ui/toolbar-tool.ui: action target
 * and icon. TODO: the other tools, the tool preferences (double click,
 * context menu), hiding buttons (/toolbox/tools/buttons).
 */
const TOOL_GROUPS: readonly (readonly [tool: string, icon: string][])[] = [
  [['Select', 'tool-pointer']],
  [
    ['Rect', 'draw-rectangle'],
    ['Arc', 'draw-ellipse'],
    ['Star', 'draw-polygon-star'],
    ['Spiral', 'draw-spiral'],
  ],
];

/** The name of the active tool of desktop ("Select", "Rect", ...), or ''. */
export function useActiveTool(desktop: SPDesktop | null): string {
  return useSyncExternalStore(
    (cb) => desktop?.connectEventContextChanged(cb) ?? (() => {}),
    () => (desktop ? get_active_tool(desktop) : ''),
  );
}

/**
 * The tooltip of a tool button: label, tooltip and first key of the action
 * (upstream Shortcuts::update_gui_text_recursive).
 */
function tooltip(action: string): string {
  const data = raw_data_tools.find((d) => d[0] === action);
  const text = data ? `${_(data[1])}\n${_(data[3])}` : '';
  const key = shortcutLabel(action);
  return key ? `${text} (${key})` : text;
}

/** The toolbox: a vertical bar of buttons that switch tools (win.tool-switch). */
export function ToolToolbar() {
  const active = useActiveTool(useActiveDesktop());
  return (
    <div className="tool-toolbar" role="toolbar" aria-orientation="vertical">
      {TOOL_GROUPS.map((group, i) => (
        <Fragment key={group[0]?.[0]}>
          {i > 0 && <hr className="tool-toolbar-separator" />}
          {group.map(([tool, icon]) => {
            const action = `win.tool-switch('${tool}')`;
            const title = tooltip(action);
            return (
              <button
                key={tool}
                type="button"
                className="tool-button"
                title={title}
                aria-label={title.split('\n')[0]}
                aria-pressed={active === tool}
                onClick={() => void runAction(action)}
              >
                <img src={iconUrl(icon)} alt="" width={16} height={16} />
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
