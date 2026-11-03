// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/execution-env.cpp, src/extension/execution-env.h
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007-2008 Authors
 */
import { DocumentUndo, type SelectionState, type SPDocument } from '@inkscape-web/core';
import type { SPDesktop } from '../desktop.ts';
import { Effect } from './effect.ts';

export enum ExecutionState {
  INIT,
  RUNNING,
  COMPLETE,
}

/**
 * One run of an effect on a document (upstream ExecutionEnv): keeps the selection, runs the
 * implementation, then commits an undo step or undoes the change.
 */
export class ExecutionEnv {
  /** Shows that an effect runs (upstream: the "Running '%s'..." dialog); set by the web app. */
  static on_working: ((effect: Effect, running: boolean) => void) | null = null;

  _state = ExecutionState.INIT;
  readonly _desktop: SPDesktop | null;
  readonly _effect: Effect;
  readonly _show_working: boolean;
  document: SPDocument | null = null;

  constructor(effect: Effect, desktop: SPDesktop | null, show_working = true, _show_errors = true) {
    this._effect = effect;
    this._desktop = desktop;
    this._show_working = show_working;
    if (desktop) this.document = desktop.getDocument();
    if (this.document && desktop) {
      const doc = this.document;
      DocumentUndo.scopedInsensitive(doc, () => desktop.getSelection().enforceIds());
    }
  }

  /** Run the effect; the selection is restored afterwards by ids (upstream run). */
  async run(): Promise<void> {
    this._state = ExecutionState.RUNNING;
    const document = this.document;
    if (!document) return;
    const selection = this._desktop?.getSelection() ?? null;
    const selectionState = selection?.getState() ?? null;
    if (this._show_working) ExecutionEnv.on_working?.(this._effect, true);
    try {
      await this._effect.get_imp().effect(this._effect, this, this._desktop, document);
    } finally {
      if (this._show_working) ExecutionEnv.on_working?.(this._effect, false);
    }
    if (selection && selectionState) selection.setState(selectionState);
    this._state = ExecutionState.COMPLETE;
  }

  cancel(): void {
    this._effect.get_imp().cancelProcessing();
  }

  /** Revert the changes of the run (upstream undo). */
  undo(): void {
    if (!this.document) return;
    let selectionState: SelectionState | null = null;
    if (this._desktop) selectionState = this._desktop.getSelection().getState();
    DocumentUndo.cancel(this.document);
    if (this._desktop && selectionState) this._desktop.getSelection().setState(selectionState);
  }

  /** Make the undo step of the run, named after the effect (upstream commit). */
  commit(): void {
    if (this.document) DocumentUndo.done(this.document, this._effect.get_name(), '');
    Effect.set_last_effect(this._effect);
    this._effect.get_imp().commitDocument();
  }
}
