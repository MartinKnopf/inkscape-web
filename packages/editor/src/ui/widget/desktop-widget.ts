// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/desktop-widget.cpp, src/ui/widget/desktop-widget.h, src/ui/interface.cpp, src/desktop.cpp
/*
 * The window layout: which bars are shown, the focus mode, full screen and the command palette.
 *
 * The visibility of each bar is in the preferences "<root>/<bar>/state", where root is "/window/",
 * "/focus/" or "/fullscreen/" (upstream getLayoutPrefPath). The web app shows and hides its bars
 * when signal_layout_changed is emitted; upstream layoutWidgets() does the same for GTK widgets.
 *
 * Copyright (C) 2007 Authors
 */
import { Preferences, Signal } from '@inkscape-web/core';

/** The bars that win.canvas-* actions show or hide, by the name in the preference path. */
export type ToolbarName =
  | 'commands'
  | 'snaptoolbox'
  | 'toppanel'
  | 'toolbox'
  | 'rulers'
  | 'scrollbars'
  | 'panels'
  | 'statusbar';

/** Whether the screen is wider than 1.65:1 (upstream get_widescreen_default): the default of the interface mode. */
export function get_widescreen_default(): boolean {
  const screen = globalThis.screen as Screen | undefined;
  return !!screen && screen.height > 0 && screen.width / screen.height > 1.65;
}

/**
 * The window layout state. There is one window, so this is a singleton; upstream has one
 * SPDesktopWidget for each window and SPDesktop::focusMode()/is_fullscreen() ask it.
 */
export class DesktopWidget {
  static #instance: DesktopWidget | null = null;
  #focus_mode = false;
  /** Emitted when the visible bars may have changed (upstream layoutWidgets()). */
  readonly signal_layout_changed = new Signal<[]>();
  /** Emitted when the on-canvas command palette should open or close. */
  readonly signal_command_palette_toggled = new Signal<[]>();

  static get(): DesktopWidget {
    DesktopWidget.#instance ??= new DesktopWidget();
    return DesktopWidget.#instance;
  }

  constructor() {
    // Layout may differ depending on full screen mode or not (upstream onWindowStateChanged).
    globalThis.document?.addEventListener('fullscreenchange', () => this.layoutWidgets());
  }

  /** Whether the window is full screen (upstream SPDesktop::is_fullscreen). */
  is_fullscreen(): boolean {
    return !!globalThis.document?.fullscreenElement;
  }

  /** Enter or leave full screen (upstream InkscapeWindow::toggleFullscreen). The browser asks for a user gesture. */
  async toggleFullscreen(): Promise<void> {
    const doc = globalThis.document;
    if (!doc) return;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else await doc.documentElement.requestFullscreen();
    } catch (e) {
      console.warn('toggleFullscreen:', e);
    }
  }

  is_focusMode(): boolean {
    return this.#focus_mode;
  }

  /** Enter or leave the focus mode, which has its own bar visibility (upstream SPDesktop::focusMode). */
  focusMode(mode: boolean): void {
    if (mode === this.#focus_mode) return;
    this.#focus_mode = mode;
    this.layoutWidgets();
  }

  /** The root of the layout preferences for the current mode (upstream getLayoutPrefPath). */
  getLayoutPrefPath(): '/focus/' | '/fullscreen/' | '/window/' {
    if (this.#focus_mode) return '/focus/';
    if (this.is_fullscreen()) return '/fullscreen/';
    return '/window/';
  }

  /** Whether a bar is visible in the current mode. */
  isToolbarVisible(name: ToolbarName): boolean {
    return Preferences.get().getBool(`${this.getLayoutPrefPath()}${name}/state`, true);
  }

  /** Whether the interface is in the wide screen setup (commands and snap bars at the side). */
  isWideInterface(): boolean {
    return Preferences.get().getBool(`${this.getLayoutPrefPath()}interface_mode`, get_widescreen_default());
  }

  /** Show or hide a bar in the current mode (upstream SPDesktop::toggleToolbar). */
  toggleToolbar(name: ToolbarName): void {
    const path = `${this.getLayoutPrefPath()}${name}/state`;
    const prefs = Preferences.get();
    prefs.setBool(path, !prefs.getBool(path, true));
    this.layoutWidgets();
  }

  /** Tell the user interface to show the bars as the preferences say. */
  layoutWidgets(): void {
    this.signal_layout_changed.emit();
  }

  toggle_command_palette(): void {
    this.signal_command_palette_toggled.emit();
  }
}
