// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-view-mode.cpp, src/actions/actions-view-mode.h
/*
 * Actions related to View mode: which bars are shown, the interface mode, full screen, the focus
 * mode and the command palette.
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *   Tavmjong Bah
 *
 * Copyright (C) 2021, 2022 Authors
 */
import { N_, NC_, Preferences } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { DesktopWidget, type ToolbarName } from '../ui/widget/desktop-widget.ts';
import { show_output } from './actions-helper.ts';

const SECTION = NC_('Action Section', 'Canvas Display');

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_view_mode: readonly (readonly [string, string, string, string])[] = [
  [
    'win.canvas-commands-bar',
    N_('Commands Bar'),
    SECTION,
    N_('Show or hide the Commands bar (under the menu)'),
  ],
  [
    'win.canvas-snap-controls-bar',
    N_('Snap Controls Bar'),
    SECTION,
    N_('Show or hide the snapping controls'),
  ],
  ['win.canvas-tool-control-bar', N_('Tool Controls Bar'), SECTION, N_('Show or hide the Tool Controls bar')],
  ['win.canvas-toolbox', N_('Toolbox'), SECTION, N_('Show or hide the main toolbox (on the left)')],
  ['win.canvas-rulers', N_('Rulers'), SECTION, N_('Show or hide the canvas rulers')],
  ['win.canvas-scroll-bars', N_('Scroll bars'), SECTION, N_('Show or hide the canvas scrollbars')],
  ['win.canvas-palette', N_('Palette'), SECTION, N_('Show or hide the color palette')],
  [
    'win.canvas-statusbar',
    N_('Statusbar'),
    SECTION,
    N_('Show or hide the statusbar (at the bottom of the window)'),
  ],
  [
    'win.canvas-command-palette',
    N_('Command Palette'),
    SECTION,
    N_('Show or hide the on-canvas command palette'),
  ],
  ['win.view-fullscreen', N_('Fullscreen'), SECTION, N_('Stretch this document window to full screen')],
  [
    'win.view-full-screen-focus',
    N_('Fullscreen & Focus Mode'),
    SECTION,
    N_('Stretch this document window to full screen'),
  ],
  ['win.view-focus-toggle', N_('Focus Mode'), SECTION, N_('Remove excess toolbars to focus on drawing')],
  ['win.canvas-interface-mode', N_('Interface Mode'), SECTION, N_('Toggle wide or narrow screen setup')],
];

/** The toggle actions and the bars they control (upstream canvas_*_toggle functions). */
const BAR_ACTIONS: readonly (readonly [action: string, bar: ToolbarName])[] = [
  ['canvas-commands-bar', 'commands'],
  ['canvas-snap-controls-bar', 'snaptoolbox'],
  ['canvas-tool-control-bar', 'toppanel'],
  ['canvas-toolbox', 'toolbox'],
  ['canvas-rulers', 'rulers'],
  ['canvas-scroll-bars', 'scrollbars'],
  ['canvas-palette', 'panels'],
  ['canvas-statusbar', 'statusbar'],
];

/**
 * Set the states of the actions (and so the check marks and toggle buttons) from the preferences of
 * the current mode (upstream view_set_gui). Needed when changing window mode (full screen, normal, focus).
 */
export function view_set_gui(app: InkscapeApplication): void {
  const layout = DesktopWidget.get();
  const set = (name: string, state: boolean) => {
    const action = app.actions.win.lookup_action(name);
    if (!action) {
      show_output(`canvas_set_state: ${name} action missing!`);
      return;
    }
    action.change_state(state);
  };
  for (const [action, bar] of BAR_ACTIONS) set(action, layout.isToolbarVisible(bar));
  set('canvas-interface-mode', layout.isWideInterface());
}

export function add_actions_view_mode(app: InkscapeApplication): void {
  const win = app.actions.win;
  const layout = DesktopWidget.get();
  const prefs = Preferences.get();

  // The check marks follow the preferences, whoever changes them (the mode, the preferences storage).
  const sync = () => view_set_gui(app);

  for (const [action, bar] of BAR_ACTIONS) {
    win.add_action_bool(action, () => layout.toggleToolbar(bar), layout.isToolbarVisible(bar));
  }

  const interface_mode = win.add_action_bool(
    'canvas-interface-mode',
    () => {
      const state = !(interface_mode.get_state() ?? false);
      interface_mode.change_state(state);
      // Save to preferences
      prefs.setBool(`${layout.getLayoutPrefPath()}interface_mode`, state);
      // Update interface
      layout.layoutWidgets();
    },
    layout.isWideInterface(),
  );

  win.add_action('view-fullscreen', () => void layout.toggleFullscreen());
  win.add_action('view-full-screen-focus', () => {
    // The mode follows the full screen state that the toggle requests.
    const entering = !layout.is_fullscreen();
    void layout.toggleFullscreen();
    layout.focusMode(entering);
  });
  win.add_action('view-focus-toggle', () => layout.focusMode(!layout.is_focusMode()));
  win.add_action('canvas-command-palette', () => {
    // Show the palette later, or the menu that ran the action takes the focus back and closes it again.
    setTimeout(() => layout.toggle_command_palette(), 0);
  });

  layout.signal_layout_changed.connect(sync);
  prefs.changedSignal.connect((path) => {
    if (/^\/(window|focus|fullscreen)\//.test(path)) sync();
  });
  app.get_action_extra_data().add_data(raw_data_view_mode);
}
