// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/booleans-tool.cpp, src/ui/tools/booleans-tool.h
/*
 * A tool for building shapes.
 *
 * Authors:
 *   Martin Owens
 *
 * Copyright (C) 2022 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { _, C_, DocumentUndo, Preferences, type SPItem } from '@inkscape-web/core';
import type { Point } from '@inkscape-web/geom';
import { show_output } from '../../actions/actions-helper.ts';
import { set_active_tool } from '../../actions/actions-tools.ts';
import type { SPDesktop } from '../../desktop.ts';
import { Shortcuts } from '../shortcuts.ts';
import { BooleanBuilder } from './booleans-builder.ts';
import { type ModifierState, mod_shift, ToolBase } from './tool-base.ts';

/** The element of the display item of item in the desktop, for the opacity overrides. */
function arena_element(desktop: SPDesktop, item: SPItem): SVGElement | null {
  const ditem = item.getArenaitem(desktop.dkey);
  return ditem && 'element' in ditem ? (ditem.element as SVGElement) : null;
}

/**
 * The shape builder (upstream InteractiveBooleansTool): the selected objects are cut into
 * their fragments. Click or drag over fragments to unite them (Shift: delete them, or the
 * other way round in the delete mode of /tools/booleans/mode). Enter or the selector tool
 * writes the result to the document, Escape cancels. The rest of the drawing is translucent
 * (/tools/booleans/opacity).
 * TODO: cursors, status bar messages (update_status), the waiting cursor.
 */
export class InteractiveBooleansTool extends ToolBase {
  boolean_builder: BooleanBuilder | null = null;

  #sel_modified: (() => void) | null = null;
  #sel_changed: (() => void) | null = null;

  to_commit = false;
  last_cursor_position: Point | null = null;

  /** The selected items when the tool started (the selection can change before cleanup). */
  readonly #items_to_manage: SPItem[];

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/booleans');
    const selection = desktop.getSelection();
    this.#items_to_manage = selection.items();
    this.boolean_builder = new BooleanBuilder(selection);

    // Any changes to the selection cancel the shape building process
    this.#sel_modified = selection.connectModified(() => this.shape_cancel());
    this.#sel_changed = selection.connectChanged(() => this.shape_cancel());

    this.set_opacity(Preferences.get().getDouble('/tools/booleans/opacity', 0.5));
    this.#hide_selected_objects();
  }

  override destroy(): void {
    this.#disconnect_selection();
    this.set_opacity(1.0);
    this.#hide_selected_objects(false);
    this.boolean_builder?.destroy();
    this.boolean_builder = null;
    super.destroy();
  }

  /** Set the variable transparency of the rest of the canvas */
  set_opacity(opacity = 1.0): void {
    const root = arena_element(this._desktop, this._desktop.getDocument().getRoot());
    if (!root) return;
    if (opacity === 1.0) root.style.removeProperty('opacity');
    else root.style.setProperty('opacity', String(opacity));
  }

  /**
   * Hide all selected items, because they are going to be re-drawn as
   * a fractured pattern and we don't want them to appear twice.
   */
  #hide_selected_objects(hide = true): void {
    // Use the stored _items_to_manage list instead of _desktop->getSelection().
    for (const item of this.#items_to_manage) {
      // We don't hide any image or group that contains an image
      if (hide && this.boolean_builder?.contains_image(item)) continue;
      const element = arena_element(this._desktop, item);
      if (!element) continue;
      if (hide) element.style.setProperty('opacity', '0');
      else element.style.removeProperty('opacity');
    }
  }

  #disconnect_selection(): void {
    this.#sel_modified?.();
    this.#sel_changed?.();
    this.#sel_modified = null;
    this.#sel_changed = null;
  }

  override switching_away(new_tool: string): void {
    // We unhide the selected items before comitting to prevent undo from entering
    // into a state where the drawing item for a group is invisible.
    this.#hide_selected_objects(false);
    // The commit changes the selection, which must not cancel.
    this.#disconnect_selection();

    // (sic) "/tool/nodes" as upstream: switching to the node tool does not commit.
    if (this.boolean_builder && (new_tool === '/tools/select' || new_tool === '/tool/nodes')) {
      // Only forcefully commit if we have the user's explicit instruction to do so.
      if (this.boolean_builder.has_changes() || this.to_commit) {
        const replace = Preferences.get().getBool('/tools/booleans/replace', true);
        const selection = this._desktop.getSelection();
        selection.setList(this.boolean_builder.shape_commit(true, replace));
        DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Built Shapes'), 'draw-booleans');
      }
    }
  }

  override is_ready(): boolean {
    if (!this.boolean_builder?.has_items()) {
      if (this._desktop.getSelection().isEmpty()) {
        show_output(_('You must select some objects to use the Shape Builder tool.'), false);
      } else {
        show_output(_('The Shape Builder requires regular shapes to be selected.'), false);
      }
      return false;
    }
    return true;
  }

  override set(name: string): void {
    if (name === 'mode') this.boolean_builder?.task_cancel();
  }

  shape_commit(): void {
    this.to_commit = true;
    // disconnect so we don't get canceled by accident.
    this.#disconnect_selection();
    set_active_tool(this._desktop, 'Select');
  }

  shape_cancel(): void {
    this.boolean_builder?.destroy();
    this.boolean_builder = null;
    set_active_tool(this._desktop, 'Select');
  }

  override root_handler(event: Event): boolean {
    const builder = this.boolean_builder;
    if (!builder) return false;

    let ret = false;
    switch (event.type) {
      case 'pointerdown':
        ret = this.#event_button_press_handler(builder, event as PointerEvent);
        break;
      case 'pointerup':
        ret = this.#event_button_release_handler(builder, event as PointerEvent);
        break;
      case 'keydown':
        ret = this.#event_key_press_handler(builder, event as KeyboardEvent);
        // Keep the window shortcuts (doc.undo, ...) from handling the key.
        if (ret) event.preventDefault();
        break;
      case 'pointermove':
        ret = this.#event_motion_handler(builder, event as PointerEvent);
        break;
    }
    if (ret) return true;

    if (this.last_cursor_position && (event instanceof MouseEvent || event instanceof KeyboardEvent)) {
      builder.highlight(this.last_cursor_position, this.should_add(event));
    }

    return super.root_handler(event);
  }

  /**
   * Returns true if the shape builder should add items,
   * false if shape builder should delete items
   */
  should_add(state: ModifierState): boolean {
    const pref = Preferences.get().getInt('/tools/booleans/mode', 0) !== 0;
    // The bool-shift modifier (Shift).
    return pref === mod_shift(state);
  }

  #pos(event: MouseEvent): Point {
    return this._desktopPoint(this._windowPoint(event));
  }

  #event_button_press_handler(builder: BooleanBuilder, event: PointerEvent): boolean {
    if (event.detail > 1) return false;
    if (event.button === 0) {
      builder.task_select(this.#pos(event), this.should_add(event));
      return true;
    }
    if (event.button === 2) {
      // right click; do not eat it so that right-click menu can appear, but cancel dragging
      builder.task_cancel();
    }
    return false;
  }

  #event_motion_handler(builder: BooleanBuilder, event: PointerEvent): boolean {
    const pos = this.#pos(event);
    this.last_cursor_position = pos;
    if (event.buttons & 1) {
      if (builder.has_task()) return builder.task_add(pos);
      return builder.task_select(pos, this.should_add(event));
    }
    return false;
  }

  #event_button_release_handler(builder: BooleanBuilder, event: PointerEvent): boolean {
    if (event.button === 0) builder.task_commit();
    return true;
  }

  #event_key_press_handler(builder: BooleanBuilder, event: KeyboardEvent): boolean {
    const action = Shortcuts.getInstance().get_action_for_event(event);
    if (action === 'doc.undo') {
      builder.undo();
      return true;
    }
    if (action === 'doc.redo') {
      builder.redo();
      return true;
    }

    switch (event.key) {
      case 'Escape':
        if (builder.has_task()) builder.task_cancel();
        else this.shape_cancel();
        return true;
      case 'Enter':
        if (builder.has_task()) builder.task_commit();
        else this.shape_commit();
        return true;
      default:
        return false;
    }
  }
}
