// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/effect.cpp, src/extension/effect.h
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *   Abhishek Sharma
 *   Sushant A.A. <sushant.co19@gmail.com>
 *
 * Copyright (C) 2002-2007 Authors
 */
import { _, type Node, type SPDocument } from '@inkscape-web/core';
import type { SPDesktop } from '../desktop.ts';
import { ExecutionEnv } from './execution-env.ts';
import { Extension, ExtensionState } from './extension.ts';
import type { Implementation } from './implementation/implementation.ts';
import { PrefDialog } from './prefdialog/prefdialog.ts';
import { INKSCAPE_EXTENSION_NS } from './prefdialog/widget.ts';

/**
 * An extension that changes the document: an item of the Extensions menu (upstream Effect).
 * TODO: icons (find_icon_file), filter effects as Effect (they are separate, see
 * internal/filter/filter.ts).
 */
export class Effect extends Extension {
  /** The last effect that was run, for "Previous Extension". */
  static _last_effect: Effect | null = null;
  /** Called when the last effect changes (upstream enable_effect_actions). */
  static last_effect_changed: ((effect: Effect | null) => void) | null = null;
  /** Shows the parameter dialog of an effect; set by the web app. */
  static show_pref_dialog: ((dialog: PrefDialog) => void) | null = null;

  /** The effect runs without a document (e.g. a Help menu command). */
  no_doc = false;
  /** The effect has no live preview. */
  no_live_preview = false;
  /** Show the "working" state while the effect runs (false for custom GUIs). */
  _workingDialog = true;
  ignore_stderr = false;
  pipe_diffs = false;
  /** The first submenu element of <effects-menu>. */
  _local_effects_menu: Node | null = null;
  _hidden_from_menu = false;
  _menu_tip = '';
  _icon_path = '';
  readonly _file_name: string;
  _prefDialog: PrefDialog | null = null;

  constructor(in_repr: Node, implementation: Implementation, base_directory = '', file_name = '') {
    super(in_repr, implementation, base_directory);
    this._file_name = file_name;
    for (const child of in_repr.children()) {
      if (child.name() !== `${INKSCAPE_EXTENSION_NS}effect`) continue;
      if (child.attribute('needs-document') === 'false') this.no_doc = true;
      if (child.attribute('needs-live-preview') === 'false') this.no_live_preview = true;
      if (child.attribute('implements-custom-gui') === 'true') {
        this._workingDialog = false;
        if (child.attribute('show-stderr') !== 'true') this.ignore_stderr = true;
        if (child.attribute('pipe-diffs') === 'true') this.pipe_diffs = true;
      }
      for (const effect_child of child.children()) {
        const name = effect_child.name();
        if (name === `${INKSCAPE_EXTENSION_NS}effects-menu`) {
          this._local_effects_menu = firstElement(effect_child);
          if (effect_child.attribute('hidden') === 'true') this._hidden_from_menu = true;
        }
        if (name === `${INKSCAPE_EXTENSION_NS}menu-tip` || name === `${INKSCAPE_EXTENSION_NS}_menu-tip`) {
          this._menu_tip = this.get_translation(effect_child.firstChild()?.content() ?? '', null);
        }
        if (name === `${INKSCAPE_EXTENSION_NS}icon`)
          this._icon_path = effect_child.firstChild()?.content() ?? '';
      } // children of "effect"
      break; // there can only be one effect
    }
  }

  /**
   * The id as an action name: "_" becomes "-", other invalid characters "X" (upstream
   * get_sanitized_id).
   */
  get_sanitized_id(): string {
    return this.get_id()
      .replaceAll('_', '-')
      .replace(/[^A-Za-z0-9.-]/g, 'X');
  }

  /** The translated submenu names of pattern and its first children (upstream get_menu). */
  get_menu(pattern: Node | null, sub_menu_list: string[]): void {
    if (!pattern) return;
    const menu_name = pattern.attribute('name') ?? pattern.attribute('_name');
    if (!menu_name) return;
    sub_menu_list.push(this._translation_enabled ? this.get_translation(menu_name, null) : _(menu_name));
    this.get_menu(firstElement(pattern), sub_menu_list);
  }

  /** The submenus of the effect in the Extensions menu (upstream get_menu_list). */
  get_menu_list(): string[] {
    const menu: string[] = [];
    this.get_menu(this._local_effects_menu, menu);
    return menu;
  }
  get_menu_tip(): string {
    return this._menu_tip;
  }
  hidden_from_menu(): boolean {
    return this._hidden_from_menu;
  }
  /** Whether the effect has parameters to show (its menu item gets "..."). */
  takes_input(): boolean {
    return this.widget_visible_count() > 0;
  }
  is_filter_effect(): boolean {
    return false;
  }

  /**
   * Show the parameter dialog, or run the effect if it has no parameters (upstream prefs).
   * Returns false if the extension cannot load.
   */
  prefs(desktop: SPDesktop | null): boolean {
    if (this._prefDialog) {
      Effect.show_pref_dialog?.(this._prefDialog);
      return true;
    }
    if (!this.widget_visible_count()) {
      void this.effect(desktop);
      return true;
    }
    if (!this.loaded()) this.set_state(ExtensionState.STATE_LOADED);
    if (!this.loaded()) return false;
    this._prefDialog = new PrefDialog(this.get_name(), this, desktop);
    Effect.show_pref_dialog?.(this._prefDialog);
    return true;
  }

  /**
   * Run the effect on the document of desktop (or document) and make an undo step named after
   * the effect (upstream effect).
   */
  async effect(desktop: SPDesktop | null, document: SPDocument | null = null): Promise<void> {
    if (!this.loaded()) this.set_state(ExtensionState.STATE_LOADED);
    if (!this.loaded()) return;
    const executionEnv = new ExecutionEnv(this, desktop, this._workingDialog, true);
    if (document) executionEnv.document = document;
    await executionEnv.run();
    executionEnv.commit();
  }

  get_pref_dialog(): PrefDialog | null {
    return this._prefDialog;
  }
  set_pref_dialog(prefdialog: PrefDialog | null): void {
    this._prefDialog = prefdialog;
  }

  static get_last_effect(): Effect | null {
    return Effect._last_effect;
  }
  /** Set the effect that was called last; enables the "Previous Extension" actions. */
  static set_last_effect(in_effect: Effect | null): void {
    Effect._last_effect = in_effect;
    Effect.last_effect_changed?.(in_effect);
  }
}

function firstElement(node: Node): Node | null {
  for (const c of node.children()) if (c.type() === 'element') return c;
  return null;
}
