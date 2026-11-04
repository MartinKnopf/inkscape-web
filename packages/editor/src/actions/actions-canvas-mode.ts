// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-canvas-mode.cpp, src/actions/actions-canvas-mode.h
/*
 * Actions for the display mode, the split mode and the color mode of the canvas.
 *
 * Copyright (C) 2020 Tavmjong Bah
 *
 * The contents of this file may be used under the GNU General Public License Version 2 or later.
 */
import { N_, NC_, Preferences } from '@inkscape-web/core';
import { SplitMode } from '../desktop.ts';
import { RENDER_MODE_COUNT, RenderMode } from '../display/drawing.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { show_output } from './actions-helper.ts';

const SECTION = NC_('Action Section', 'Canvas Display');

/** The radio actions; the detailed names in the raw data add the value, like "win.canvas-display-mode(1)". */
const DISPLAY_MODE = 'win.canvas-display-mode';
const SPLIT_MODE = 'win.canvas-split-mode';

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_canvas_mode: readonly (readonly [string, string, string, string])[] = [
  [`${DISPLAY_MODE}(0)`, N_('Display Mode: Normal'), SECTION, N_('Use normal rendering mode')],
  [`${DISPLAY_MODE}(1)`, N_('Display Mode: Outline'), SECTION, N_('Show only object outlines')],
  [`${DISPLAY_MODE}(2)`, N_('Display Mode: No Filters'), SECTION, N_('Do not render filters (for speed)')],
  [
    `${DISPLAY_MODE}(3)`,
    N_('Display Mode: Enhance Thin Lines'),
    SECTION,
    N_('Ensure all strokes are displayed on screen as at least 1 pixel wide'),
  ],
  [
    `${DISPLAY_MODE}(4)`,
    N_('Display Mode: Outline Overlay'),
    SECTION,
    N_('Show objects as outlines, and the actual drawing below them with reduced opacity'),
  ],
  ['win.canvas-display-mode-cycle', N_('Display Mode: Cycle'), SECTION, N_('Cycle through display modes')],
  [
    'win.canvas-display-mode-toggle',
    N_('Display Mode: Toggle'),
    SECTION,
    N_('Toggle between normal and last non-normal mode'),
  ],
  [`${SPLIT_MODE}(0)`, N_('Split Mode: Normal'), SECTION, N_('Do not split canvas')],
  [`${SPLIT_MODE}(1)`, N_('Split Mode: Split'), SECTION, N_('Render part of the canvas in outline mode')],
  [`${SPLIT_MODE}(2)`, N_('Split Mode: X-Ray'), SECTION, N_('Render a circular area in outline mode')],
  ['win.canvas-color-mode', N_('Color Mode'), SECTION, N_('Toggle between normal and grayscale modes')],
  [
    'win.canvas-color-manage',
    N_('Color Managed Mode'),
    SECTION,
    N_('Toggle between normal and color managed modes'),
  ],
];

export function add_actions_canvas_mode(app: InkscapeApplication): void {
  const win = app.actions.win;
  // The current modes of the actions (the state of the radio actions of upstream).
  let display = RenderMode.NORMAL;
  let old_display = RenderMode.OUTLINE;
  let split = SplitMode.NORMAL;

  const set_display = (value: number) => {
    if (!Number.isInteger(value) || value < 0 || value >= RENDER_MODE_COUNT) {
      show_output(`canvas_display_mode: value out of bound! : ${value}`);
      return;
    }
    display = value;
    app.get_active_desktop()?.setRenderMode(value);
  };
  win.add_action_with_parameter('canvas-display-mode', 'i', set_display);
  // Cycle between values.
  win.add_action('canvas-display-mode-cycle', () => set_display((display + 1) % RENDER_MODE_COUNT));
  // Toggle between normal and last set other value.
  win.add_action('canvas-display-mode-toggle', () => {
    if (display === RenderMode.NORMAL) set_display(old_display);
    else {
      old_display = display;
      set_display(RenderMode.NORMAL);
    }
  });

  win.add_action_with_parameter('canvas-split-mode', 'i', (value) => {
    if (!Number.isInteger(value) || value < 0 || value > SplitMode.XRAY) {
      show_output(`canvas_split_mode: value out of bound! : ${value}`);
      return;
    }
    // If split mode is already set to the requested mode, turn it off.
    split = value === split ? SplitMode.NORMAL : value;
    app.get_active_desktop()?.setSplitMode(split);
  });

  // Gray scale: the browser filters the whole canvas.
  const color_mode = win.add_action_bool('canvas-color-mode', () => {
    const state = !(color_mode.get_state() ?? false);
    color_mode.change_state(state);
    const desktop = app.get_active_desktop();
    if (desktop) desktop.getCanvas().svg.style.filter = state ? 'grayscale(1)' : '';
  });
  // Color management has no counterpart in the browser; the state is kept as upstream does.
  const color_manage = win.add_action_bool(
    'canvas-color-manage',
    () => {
      const state = !(color_manage.get_state() ?? false);
      color_manage.change_state(state);
      Preferences.get().setBool('/options/displayprofile/enable', state);
    },
    false,
  );
  app.get_action_extra_data().add_data(raw_data_canvas_mode);
}
