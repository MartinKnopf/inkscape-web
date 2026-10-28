// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/inkscape-application.cpp, src/inkscape-application.h
/*
 * The main Inkscape application.
 *
 * Copyright (C) 2018 Tavmjong Bah
 */
import { type Selection, Signal, type SPDocument } from '@inkscape-web/core';
import { ActionRegistry } from './actions/action-map.ts';
import { add_actions_canvas_snapping } from './actions/actions-canvas-snapping.ts';
import { add_actions_canvas_transform } from './actions/actions-canvas-transform.ts';
import { add_actions_edit } from './actions/actions-edit.ts';
import { add_actions_edit_document } from './actions/actions-edit-document.ts';
import { add_actions_edit_window } from './actions/actions-edit-window.ts';
import { InkActionExtraData } from './actions/actions-extra-data.ts';
import { add_actions_node_tool } from './actions/actions-node-tool.ts';
import { add_actions_object } from './actions/actions-object.ts';
import { add_actions_object_align } from './actions/actions-object-align.ts';
import { add_actions_path } from './actions/actions-paths.ts';
import { add_actions_selection_object } from './actions/actions-selection-object.ts';
import { add_actions_select_window } from './actions/actions-selection-window.ts';
import { add_actions_text } from './actions/actions-text.ts';
import { add_actions_tools } from './actions/actions-tools.ts';
import { add_actions_transform } from './actions/actions-transform.ts';
import { add_actions_undo_document } from './actions/actions-undo-document.ts';
import type { SPDesktop } from './desktop.ts';
import { toolIsPorted } from './ui/tool-factory.ts';

/**
 * The application: the actions ("app.*", "win.*" and "doc.*") with their
 * extra data, and the active desktop, selection and document they act on.
 *
 * Upstream registers "win.*" actions for each window and "doc.*" actions for
 * each document. There is one desktop here, so all actions are registered
 * once and act on the active desktop or document (they do nothing without one).
 */
export class InkscapeApplication {
  static #instance: InkscapeApplication | null = null;

  /** The application instance, created on first use. */
  static instance(): InkscapeApplication {
    InkscapeApplication.#instance ??= new InkscapeApplication();
    return InkscapeApplication.#instance;
  }

  readonly actions = new ActionRegistry();
  readonly #action_extra_data = new InkActionExtraData();
  #active_desktop: SPDesktop | null = null;
  #disconnect_document: (() => void) | null = null;
  /** Emitted when the active desktop or its document changes. */
  readonly signal_active_changed = new Signal<[]>();

  constructor() {
    // ======================== Actions =========================
    add_actions_edit(this); // actions for editing
    add_actions_object(this); // actions for object manipulation
    add_actions_object_align(this); // actions for object alignment
    add_actions_path(this); // actions for Paths
    add_actions_selection_object(this); // actions for selected objects
    add_actions_text(this); // actions for text
    add_actions_transform(this); // actions for transforming selected objects
    // Window actions (upstream InkscapeWindow)
    add_actions_canvas_snapping(this); // Actions to toggle snapping.
    add_actions_canvas_transform(this); // Actions to transform canvas view.
    add_actions_edit_window(this); // Actions to edit.
    add_actions_node_tool(this); // Actions to add, delete, etc. nodes (requiring Node tool).
    add_actions_select_window(this); // Actions with desktop selection
    add_actions_tools(this, toolIsPorted); // Actions to switch between tools.
    // Document actions (upstream SPDocument)
    add_actions_edit_document(this); // Guides and grids.
    add_actions_undo_document(this);
  }

  get_action_extra_data(): InkActionExtraData {
    return this.#action_extra_data;
  }

  get_active_desktop(): SPDesktop | null {
    return this.#active_desktop;
  }

  get_active_selection(): Selection | null {
    return this.#active_desktop?.getSelection() ?? null;
  }

  get_active_document(): SPDocument | null {
    return this.#active_desktop?.getDocument() ?? null;
  }

  set_active_desktop(desktop: SPDesktop | null): void {
    if (this.#active_desktop === desktop) return;
    this.#disconnect_document?.();
    this.#active_desktop = desktop;
    this.#disconnect_document =
      desktop?.connectDocumentReplaced(() => this.signal_active_changed.emit()) ?? null;
    this.signal_active_changed.emit();
  }

  /** Run the action of a detailed action name. Returns whether an enabled action ran. */
  activate_action(detailed: string): boolean {
    return this.actions.activate(detailed);
  }
}
