// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-view-mode.cpp
// @vitest-environment happy-dom
import { Preferences } from '@inkscape-web/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { DesktopWidget } from '../ui/widget/desktop-widget.ts';

const app = InkscapeApplication.instance();
const layout = DesktopWidget.get();
const prefs = Preferences.get();
const state = (action: string) => app.actions.lookup_action(`win.${action}`)?.get_state();
const run = (action: string) => expect(app.activate_action(`win.${action}`)).toBe(true);

afterEach(() => {
  layout.focusMode(false);
  for (const path of ['/window/', '/focus/']) {
    for (const bar of ['rulers', 'commands', 'toolbox', 'statusbar'])
      prefs.setBool(`${path}${bar}/state`, true);
    prefs.setBool(`${path}interface_mode`, false);
  }
});

describe('bar actions', () => {
  it('toggle the visibility preference and the state of the action', () => {
    expect(state('canvas-rulers')).toBe(true);
    const changed = vi.fn();
    layout.signal_layout_changed.connect(changed);
    run('canvas-rulers');
    expect(prefs.getBool('/window/rulers/state', true)).toBe(false);
    expect(layout.isToolbarVisible('rulers')).toBe(false);
    expect(state('canvas-rulers')).toBe(false);
    expect(changed).toHaveBeenCalled();
    run('canvas-rulers');
    expect(state('canvas-rulers')).toBe(true);
  });

  it('control one bar each', () => {
    const bars: [string, string][] = [
      ['canvas-commands-bar', 'commands'],
      ['canvas-snap-controls-bar', 'snaptoolbox'],
      ['canvas-tool-control-bar', 'toppanel'],
      ['canvas-toolbox', 'toolbox'],
      ['canvas-scroll-bars', 'scrollbars'],
      ['canvas-palette', 'panels'],
      ['canvas-statusbar', 'statusbar'],
    ];
    for (const [action, bar] of bars) {
      run(action);
      expect(prefs.getBool(`/window/${bar}/state`, true), action).toBe(false);
      run(action);
      expect(prefs.getBool(`/window/${bar}/state`, true), action).toBe(true);
    }
  });
});

describe('focus mode', () => {
  it('has its own bar preferences, and the states of the actions follow the mode', () => {
    run('view-focus-toggle');
    expect(layout.is_focusMode()).toBe(true);
    expect(layout.getLayoutPrefPath()).toBe('/focus/');
    run('canvas-toolbox');
    expect(prefs.getBool('/focus/toolbox/state', true)).toBe(false);
    expect(prefs.getBool('/window/toolbox/state', true)).toBe(true);
    expect(state('canvas-toolbox')).toBe(false);
    run('view-focus-toggle');
    expect(layout.is_focusMode()).toBe(false);
    expect(state('canvas-toolbox')).toBe(true);
  });
});

describe('interface mode', () => {
  it('toggles the wide setup and saves it for the mode', () => {
    prefs.setBool('/window/interface_mode', false);
    app.actions.win.lookup_action('canvas-interface-mode')?.change_state(false);
    run('canvas-interface-mode');
    expect(state('canvas-interface-mode')).toBe(true);
    expect(prefs.getBool('/window/interface_mode', false)).toBe(true);
    expect(layout.isWideInterface()).toBe(true);
  });
});

describe('full screen', () => {
  it('enters full screen with the Fullscreen API', async () => {
    const request = vi.fn(() => Promise.resolve());
    document.documentElement.requestFullscreen = request;
    run('view-fullscreen');
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('view-full-screen-focus also enters the focus mode', async () => {
    document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve());
    run('view-full-screen-focus');
    await Promise.resolve();
    expect(layout.is_focusMode()).toBe(true);
  });
});

describe('command palette', () => {
  it('opens later, not inside the action', async () => {
    vi.useFakeTimers();
    const toggled = vi.fn();
    const off = layout.signal_command_palette_toggled.connect(toggled);
    run('canvas-command-palette');
    expect(toggled).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(toggled).toHaveBeenCalledTimes(1);
    off();
    vi.useRealTimers();
  });
});
