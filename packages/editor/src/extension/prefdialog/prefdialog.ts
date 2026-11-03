// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/prefdialog/prefdialog.cpp, src/extension/prefdialog/prefdialog.h
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *
 * Copyright (C) 2005-2008 Authors
 */
import { readMem } from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';
import type { Effect } from '../effect.ts';
import { ExecutionEnv } from '../execution-env.ts';
import { ExtensionState } from '../extension.ts';
import { make_parameter, ParamBool } from './widget.ts';

/** The live preview parameter of the dialogs (upstream live_param_xml). */
const live_param_xml =
  '<param name="__live_effect__" type="bool" gui-text="Live preview" gui-description="Is the effect previewed live on canvas?">false</param>';

/**
 * The parameter dialog of an effect (upstream PrefDialog), without the widgets: the web dialog
 * draws the widgets of the effect, calls param_change() when a value changes and
 * on_response() for Apply and Close. With live preview on, the effect runs on every change and
 * the previous run is undone first.
 */
export class PrefDialog {
  readonly _name: string;
  readonly _effect: Effect;
  readonly _desktop: SPDesktop | null;
  /** The "Live preview" check box; null if the effect has no live preview. */
  readonly _param_preview: ParamBool | null = null;
  /** The run of the live preview. */
  _exEnv: ExecutionEnv | null = null;
  /** The runs and undos in order: a preview run ends before the next change starts. */
  #queue: Promise<void> = Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = 0;
  readonly #listeners = new Set<() => void>();

  constructor(name: string, effect: Effect, desktop: SPDesktop | null) {
    this._name = name;
    this._effect = effect;
    this._desktop = desktop;
    if (!effect.no_live_preview) {
      const root = readMem(live_param_xml, null)?.root();
      const param = root ? make_parameter(root, effect) : null;
      if (param instanceof ParamBool) this._param_preview = param;
      this.preview_toggle();
    }
  }

  /** Called when the dialog must update (busy state). Returns the disconnect function. */
  connect_changed(slot: () => void): () => void {
    this.#listeners.add(slot);
    return () => this.#listeners.delete(slot);
  }
  #changed(): void {
    for (const l of this.#listeners) l();
  }
  /** Whether a run is in progress. */
  busy(): boolean {
    return this.#running > 0;
  }

  #enqueue(job: () => Promise<void> | void): Promise<void> {
    this.#running++;
    this.#changed();
    this.#queue = this.#queue
      .then(job)
      .catch((e) => console.error(e))
      .finally(() => {
        this.#running--;
        this.#changed();
      });
    return this.#queue;
  }

  /** Start or stop the live preview after the check box changed (upstream preview_toggle). */
  preview_toggle(): Promise<void> {
    const on = this._param_preview?.get() ?? false;
    return this.#enqueue(async () => {
      if (on) {
        if (!this._exEnv) {
          this._exEnv = new ExecutionEnv(this._effect, this._desktop, false, false);
          await this._exEnv.run();
        }
      } else if (this._exEnv) {
        this._exEnv.cancel();
        this._exEnv.undo();
        this._exEnv = null;
      }
    });
  }

  /** Set the live preview on or off. */
  set_preview(on: boolean): Promise<void> {
    this._param_preview?.set_bool(on);
    return this.preview_toggle();
  }

  /** A parameter changed: rerun the preview after 250 ms (upstream param_change). */
  param_change(): void {
    if (!this._exEnv) return;
    if (!this._effect.loaded()) this._effect.set_state(ExtensionState.STATE_LOADED);
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.param_timer_expire();
    }, 250);
  }

  /** Undo the preview and run it again with the new parameters (upstream param_timer_expire). */
  param_timer_expire(): Promise<void> {
    return this.#enqueue(async () => {
      const env = this._exEnv;
      if (!env) return;
      env.cancel();
      env.undo();
      await env.run();
    });
  }

  /**
   * Apply (ok) or Close the dialog (upstream on_response): Apply commits the preview or runs the
   * effect; Close undoes the preview and closes the dialog.
   */
  on_response(ok: boolean): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
      if (ok && this._exEnv) void this.param_timer_expire();
    }
    const done = this.#enqueue(async () => {
      if (ok) {
        if (!this._exEnv) await this._effect.effect(this._desktop);
        else {
          this._exEnv.commit();
          this._exEnv = null;
        }
      }
    });
    if (ok && this._param_preview) this._param_preview.set_bool(false);
    if (!ok) return done.then(() => this.close());
    return done;
  }

  /** Undo the preview and forget the dialog (upstream ~PrefDialog). */
  close(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    return this.#enqueue(() => {
      if (this._exEnv) {
        this._exEnv.cancel();
        this._exEnv.undo();
        this._exEnv = null;
      }
      this._effect.set_pref_dialog(null);
    });
  }
}
