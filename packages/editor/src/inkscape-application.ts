// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/inkscape-application.cpp, src/inkscape-application.h
/*
 * The main Inkscape application.
 *
 * Copyright (C) 2018 Tavmjong Bah
 */
import { type Selection, Signal, type SPDocument } from '@inkscape-web/core';
import { ActionRegistry } from './actions/action-map.ts';
import { add_actions_base } from './actions/actions-base.ts';
import { add_actions_canvas_mode } from './actions/actions-canvas-mode.ts';
import { add_actions_canvas_snapping } from './actions/actions-canvas-snapping.ts';
import { add_actions_canvas_transform } from './actions/actions-canvas-transform.ts';
import { add_actions_dialogs } from './actions/actions-dialogs.ts';
import { add_actions_edit } from './actions/actions-edit.ts';
import { add_actions_edit_document } from './actions/actions-edit-document.ts';
import { add_actions_edit_window } from './actions/actions-edit-window.ts';
import { add_actions_effect } from './actions/actions-effect.ts';
import { add_actions_element_a } from './actions/actions-element-a.ts';
import { add_actions_element_image } from './actions/actions-element-image.ts';
import { InkActionExtraData } from './actions/actions-extra-data.ts';
import { add_actions_help_url } from './actions/actions-help-url.ts';
import { add_actions_hide_lock } from './actions/actions-hide-lock.ts';
import { InkActionHintData } from './actions/actions-hint-data.ts';
import { add_actions_layer } from './actions/actions-layer.ts';
import { add_actions_node_align } from './actions/actions-node-align.ts';
import { add_actions_node_tool } from './actions/actions-node-tool.ts';
import { add_actions_object } from './actions/actions-object.ts';
import { add_actions_object_align } from './actions/actions-object-align.ts';
import { add_actions_pages } from './actions/actions-pages.ts';
import { add_actions_path } from './actions/actions-paths.ts';
import { add_actions_selection } from './actions/actions-selection.ts';
import { add_actions_selection_object } from './actions/actions-selection-object.ts';
import { add_actions_select_window } from './actions/actions-selection-window.ts';
import { add_actions_processing } from './actions/actions-svg-processing.ts';
import { add_actions_text } from './actions/actions-text.ts';
import { add_actions_text_attributes } from './actions/actions-text-attributes.ts';
import { add_actions_tools } from './actions/actions-tools.ts';
import { add_actions_transform } from './actions/actions-transform.ts';
import { add_actions_undo_document } from './actions/actions-undo-document.ts';
import { add_actions_view_mode } from './actions/actions-view-mode.ts';
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
  readonly #action_hint_data = new InkActionHintData();
  #active_desktop: SPDesktop | null = null;
  #disconnect_document: (() => void) | null = null;
  /** Emitted when the active desktop or its document changes. */
  readonly signal_active_changed = new Signal<[]>();

  constructor() {
    // ======================== Actions =========================
    add_actions_base(this); // actions that are independent of the GUI
    add_actions_edit(this); // actions for editing
    add_actions_effect(this); // actions for Filters and Extensions
    add_actions_element_a(this); // actions for anchors
    add_actions_element_image(this); // actions for images
    add_actions_hide_lock(this); // actions for hiding and locking
    add_actions_object(this); // actions for object manipulation
    add_actions_object_align(this); // actions for object alignment
    add_actions_path(this); // actions for Paths
    add_actions_selection(this); // actions for selection by id, class, ...
    add_actions_selection_object(this); // actions for selected objects
    add_actions_text(this); // actions for text
    add_actions_transform(this); // actions for transforming selected objects
    // Window actions (upstream InkscapeWindow)
    add_actions_canvas_mode(this); // Actions for the display mode.
    add_actions_canvas_snapping(this); // Actions to toggle snapping.
    add_actions_canvas_transform(this); // Actions to transform canvas view.
    add_actions_dialogs(this); // Actions to open dialogs.
    add_actions_edit_window(this); // Actions to edit.
    add_actions_help_url(this); // Actions to open the help pages.
    add_actions_layer(this); // Actions for layers.
    add_actions_node_align(this); // Actions to align and distribute nodes (requiring Node tool).
    add_actions_node_tool(this); // Actions to add, delete, etc. nodes (requiring Node tool).
    add_actions_select_window(this); // Actions with desktop selection
    add_actions_text_attributes(this); // Actions for text attributes (decoration).
    add_actions_tools(this, toolIsPorted); // Actions to switch between tools.
    add_actions_view_mode(this); // Actions to show and hide bars, full screen, focus mode.
    // Document actions (upstream SPDocument)
    add_actions_edit_document(this); // Guides and grids.
    add_actions_undo_document(this);
    add_actions_processing(this); // SVG processing, mostly for the command line.
    add_actions_pages(this); // Pages, and the win.page-* actions that center the view.
  }

  get_action_extra_data(): InkActionExtraData {
    return this.#action_extra_data;
  }

  /** What to enter for the parameter of an action (shown by the command palette). */
  get_action_hint_data(): InkActionHintData {
    return this.#action_hint_data;
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
