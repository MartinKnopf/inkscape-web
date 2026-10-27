// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/select-tool.cpp, src/ui/tools/select-tool.h
/*
 * Selection and transformation context
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2010      authors
 * Copyright (C) 2006      Johan Engelen <johan@shouraizou.nl>
 * Copyright (C) 1999-2005 Authors
 */
import {
  DocumentUndo,
  LayerMode,
  Preferences,
  type Selection,
  SPGroup,
  type SPItem,
} from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';
import { Rubberband, RubberbandOperation } from '../../rubberband.ts';
import { SelTrans } from '../../seltrans.ts';
import {
  type ModifierState,
  mod_alt,
  mod_ctrl,
  mod_ctrl_only,
  mod_shift,
  mod_shift_only,
  ToolBase,
} from './tool-base.ts';

// Modifiers of the select tool, from share/keys/inkscape.xml (upstream Modifiers::Modifier).
/** select-add-to: Shift */
const select_add_to = (s: ModifierState) => mod_shift(s);
/** select-in-groups: Ctrl */
const select_in_groups = (s: ModifierState) => mod_ctrl(s);
/** select-always-box: Shift */
const select_always_box = (s: ModifierState) => mod_shift(s);
/** select-remove-from: Shift+Ctrl */
const select_remove_from = (s: ModifierState) => mod_shift(s) && mod_ctrl(s);
/** select-force-drag: Alt */
const select_force_drag = (s: ModifierState) => mod_alt(s);

const NO_MODIFIERS: ModifierState = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };

/** Copy of the modifiers of an event. */
function modifiers(e: ModifierState): ModifierState {
  return { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey };
}

/**
 * The selector tool (upstream SelectTool): click to select, Shift+click to
 * toggle, Ctrl+click to select in groups, drag around objects for a
 * rubberband selection, drag objects to move them, arrow keys to move,
 * Escape to deselect, Delete to delete, double click or Ctrl+Enter to enter
 * a group.
 * TODO: Alt+click select under, Alt+drag touch selection and force drag,
 * Alt+scroll cycling, Tab to select the next object, duplicate drag, sticky
 * transform keys, stamping (Space), Ctrl+A, Shift+G, double click on a
 * non-group (switch tool), cursors, status bar messages, gradient drag.
 */
export class SelectTool extends ToolBase {
  readonly _seltrans: SelTrans;
  /** Pressed on an item: dragging moves the selection. */
  dragging = false;
  /** The selection has moved in this drag. */
  moved = false;
  /** The item under the pointer at the press. */
  item: SPItem | null = null;
  /** Modifiers at the button press. */
  button_press_state: ModifierState = NO_MODIFIERS;
  /** True between the button press and release (upstream: a canvas item grabbed the pointer). */
  grabbed = false;
  /** The rubberband was canceled by Escape, so the next button release should not deselect. */
  #rb_escaped = false;
  /** The drag was canceled by Escape. */
  #drag_escaped = false;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/select');
    this._seltrans = new SelTrans(desktop);
  }

  override destroy(): void {
    this._seltrans.destroy();
    super.destroy();
  }

  /** Cancel a drag or rubberband. Returns true if something was canceled. */
  sp_select_context_abort(): boolean {
    if (this.dragging) {
      if (this.moved) {
        // cancel dragging an object
        this._seltrans.ungrab();
        this.moved = false;
        this.dragging = false;
        this.#drag_escaped = true;
        // only undo if the item is still valid
        if (this.item?.parent) DocumentUndo.undo(this._desktop.getDocument());
        this.item = null;
        // TODO: flash "Move canceled." in the message stack.
        return true;
      }
    } else {
      const rubberband = Rubberband.get(this._desktop);
      if (rubberband.isStarted()) {
        rubberband.stop();
        this.#rb_escaped = true;
        // TODO: flash "Selection canceled." in the message stack.
        return true;
      }
    }
    return false;
  }

  override root_handler(event: Event): boolean {
    // make sure we still have valid objects to move around
    if (this.item && !this.item.parent) this.sp_select_context_abort();

    let ret = false;
    switch (event.type) {
      case 'pointerdown':
        ret = this.#buttonPress(event as PointerEvent);
        break;
      case 'pointermove':
        ret = this.#motion(event as PointerEvent);
        break;
      case 'pointerup':
        ret = this.#buttonRelease(event as PointerEvent);
        break;
      case 'dblclick':
        ret = this.#doubleClick();
        break;
      case 'keydown':
        ret = this.#keyPress(event as KeyboardEvent);
        if (ret) event.preventDefault();
        break;
    }
    return ret || super.root_handler(event);
  }

  #buttonPress(event: PointerEvent): boolean {
    if (event.button === 2) {
      // right click; do not eat it so that right-click menu can appear, but cancel dragging & rubberband
      this.sp_select_context_abort();
      return false;
    }
    if (event.button !== 0) return false;

    const w = this._windowPoint(event);
    this.tolerance = Math.min(Math.max(Preferences.get().getInt('/options/dragtolerance/value', 4), 0), 100);
    this.saveDragOrigin(w);
    // remember what modifiers were on before button press
    this.button_press_state = modifiers(event);
    this._element.setPointerCapture?.(event.pointerId);
    this.grabbed = true;
    this.#rb_escaped = this.#drag_escaped = false;

    // A press on an item (upstream item_handler): drag to move, unless a
    // modifier asks for a rubberband.
    const on_item = this._desktop.getItemAtPoint(w, true) !== null;
    if (on_item && !select_always_box(event) && !mod_alt(event)) {
      this.dragging = true;
      this.moved = false;
      // Remember the clicked item in item:
      this.item = this._desktop.getItemAtPoint(w, false);
      return true;
    }

    // A press elsewhere (upstream root_handler): start a rubberband.
    this.moved = false;
    Rubberband.get(this._desktop).start(this._desktop, this._desktopPoint(w));
    return true;
  }

  #motion(event: PointerEvent): boolean {
    if (!this.grabbed || !(event.buttons & 1)) return false;
    const w = this._windowPoint(event);
    if (!this.checkDragMoved(w)) return true;

    const selection = this._desktop.getSelection();
    const p = this._desktopPoint(w);
    const force_drag = select_force_drag(this.button_press_state);
    const always_box = select_always_box(this.button_press_state);

    if (force_drag && !always_box && !selection.isEmpty()) {
      // if it's not click and alt was pressed (with some selection
      // but not with shift) we want to drag rather than rubberband
      this.dragging = true;
    }

    if (this.dragging) {
      const rubberband = Rubberband.get(this._desktop);
      if (rubberband.isStarted()) rubberband.stop();
      // Look for an item where the mouse was reported to be by mouse press (not mouse move).
      const item_at_point = this.xyp ? this._desktop.getItemAtPoint(this.xyp, false) : null;
      if (item_at_point || this.moved || force_drag) {
        // drag only if starting from an item, or if something is already grabbed, or if alt-dragging
        if (!this.moved) {
          const item_in_group = this._desktop.getItemAtPoint(w, true);
          let group_at_point = this._desktop.getGroupAtPoint(w);
          const selGroup = selection.single();
          if (selGroup instanceof SPGroup && selGroup.layerMode() === LayerMode.LAYER)
            group_at_point = selGroup;
          // group-at-point is meant to be topmost item if it's a group,
          // not topmost group of all items at point
          if (
            group_at_point !== item_in_group &&
            !(group_at_point && item_at_point && group_at_point.isAncestorOf(item_at_point))
          ) {
            group_at_point = null;
          }
          // if neither a group nor an item (possibly in a group) at point are selected, set selection to the item at point
          if (
            (!item_in_group || !selection.includes(item_in_group)) &&
            (!group_at_point || !selection.includes(group_at_point)) &&
            !force_drag
          ) {
            // select what is under cursor
            if (!this._seltrans.isEmpty()) this._seltrans.resetState();
            // when simply ctrl-dragging, we don't want to go into groups
            if (item_at_point && !selection.includes(item_at_point)) selection.set(item_at_point);
          } // otherwise, do not change selection so that dragging selected-within-group items, as well as alt-dragging, is possible
          this._seltrans.grab(p, -1, -1, false, true);
          this.moved = true;
        }
        if (!this._seltrans.isEmpty()) this._seltrans.moveTo(p, event);
        // TODO: autoscroll.
        return true;
      }
      this.dragging = false;
      return true;
    }

    const rubberband = Rubberband.get(this._desktop);
    if (rubberband.isStarted()) {
      // set selection color
      rubberband.setOperation(
        select_remove_from(event) ? RubberbandOperation.REMOVE : RubberbandOperation.ADD,
      );
      rubberband.move(p);
    }
    return true;
  }

  #buttonRelease(event: PointerEvent): boolean {
    if (event.button !== 0 || !this.grabbed) return false;
    const selection = this._desktop.getSelection();
    let ret = false;

    if (this.dragging) {
      if (this.moved) {
        // item has been moved
        this._seltrans.ungrab();
        this.moved = false;
      } else if (this.item && !this.#drag_escaped) {
        // item has not been moved -> simply a click, do selecting
        this.handleClick(event, selection);
      }
      this.dragging = false;
      this.item = null;
    } else {
      const r = Rubberband.get(this._desktop);
      if (r.isStarted() && !this.within_tolerance) {
        // this was a rubberband drag
        const b = r.getRectangle();
        const items = b
          ? this._desktop
              .getDocument()
              .getItemsInBox(this._desktop.dkey, b.transformed(this._desktop.dt2doc()))
          : [];
        this._seltrans.resetState();
        r.stop();
        if (select_remove_from(event)) {
          // with ctrl and shift, remove from selection
          selection.removeList(items);
        } else if (select_add_to(event)) {
          // with shift, add to selection
          selection.addList(items);
        } else {
          // without shift, simply select anew
          selection.setList(items);
        }
      } else {
        // it was just a click, or a too small rubberband
        r.stop();
        this.handleClick(event, selection);
      }
      ret = true;
    }

    this.grabbed = false;
    if (this._element.hasPointerCapture?.(event.pointerId))
      this._element.releasePointerCapture(event.pointerId);
    Rubberband.get(this._desktop).stop(); // might have been started in another tool!
    this.button_press_state = NO_MODIFIERS;
    return ret;
  }

  /** Double click: enter the selected group, or with nothing selected, leave the current group. */
  #doubleClick(): boolean {
    const selection = this._desktop.getSelection();
    const clicked_item = selection.items()[0];
    if (clicked_item) {
      if (clicked_item instanceof SPGroup) {
        // enter group
        this._desktop.layerManager().setCurrentLayer(clicked_item);
        selection.clear();
        this.dragging = false;
      }
      // TODO: else switch to the tool of the item (set_active_tool).
    } else {
      sp_select_context_up_one_layer(this._desktop);
    }
    return true;
  }

  /** Select the item under the pointer for a click without drag. */
  handleClick(event: PointerEvent, selection: Selection): void {
    const force_drag = select_force_drag(event);
    if ((this.#rb_escaped || this.#drag_escaped) && !force_drag) {
      this.#rb_escaped = false;
      return;
    }
    const in_groups = select_in_groups(event);
    // TODO: Alt+click selects under the selected item (sp_event_context_find_item with select_under).
    const local_item = this._desktop.getItemAtPoint(this._windowPoint(event), in_groups);

    if (!selection.isEmpty()) {
      if (local_item) {
        if (select_add_to(event)) {
          // with shift, toggle selection
          this._seltrans.resetState();
          selection.toggle(local_item);
        } else {
          const single = selection.single();
          // without shift, increase state (i.e. toggle scale/rotation handles)
          if (
            selection.includes(local_item) ||
            (single instanceof SPGroup &&
              single.layerMode() === LayerMode.LAYER &&
              single.isAncestorOf(local_item))
          ) {
            this._seltrans.increaseState();
          } else {
            this._seltrans.resetState();
            selection.set(local_item);
          }
        }
      } else {
        selection.clear();
      }
    } else if (local_item) {
      // Simple or shift click, no previous selection
      this._seltrans.resetState();
      selection.set(local_item);
    }
  }

  #keyPress(event: KeyboardEvent): boolean {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return false;
    const selection = this._desktop.getSelection();
    const prefs = Preferences.get();
    const nudge = Math.min(Math.max(prefs.getDouble('/options/nudgedistance/value', 2), 0), 1000); // in px
    const y_dir = this._desktop.yaxisdir();

    let delta = mod_shift(event) ? 10.0 : 1.0;
    // With Alt, move by screen pixels.
    const screen = mod_alt(event);
    if (!screen) delta *= nudge;
    // TODO: count repeated key events (gobble_key_events) and the rotated canvas (/options/moverotated/value).
    const move = (dx: number, dy: number) => {
      if (screen) selection.moveScreen(dx, dy);
      else selection.move(dx, dy);
    };

    switch (event.key) {
      case 'ArrowLeft': // move selection left
        if (mod_ctrl(event)) return false;
        move(-delta, 0);
        return true;
      case 'ArrowUp': // move selection up
        if (mod_ctrl(event)) return false;
        move(0, -delta * y_dir);
        return true;
      case 'ArrowRight': // move selection right
        if (mod_ctrl(event)) return false;
        move(delta, 0);
        return true;
      case 'ArrowDown': // move selection down
        if (mod_ctrl(event)) return false;
        move(0, delta * y_dir);
        return true;
      case 'Escape':
        if (!this.sp_select_context_abort()) {
          if (mod_ctrl_only(event) || selection.isEmpty()) {
            // Escape any current non-layer group we entered (see Ctrl+Enter)
            sp_select_context_up_one_layer(this._desktop);
          } else {
            selection.clear();
          }
        }
        return true;
      case 'Enter':
        if (!mod_ctrl_only(event)) return false;
        {
          // Enter a group as a layer (get out with Ctrl+Enter or Ctrl+Backspace)
          const selected_object = selection.single();
          if (selected_object instanceof SPGroup && selected_object.layerMode() !== LayerMode.LAYER) {
            this._desktop.layerManager().setCurrentLayer(selected_object);
            selection.clear();
          }
          // TODO: else flash "Selected object is not a group. Cannot enter."
        }
        return true;
      case 'Backspace':
        if (mod_ctrl_only(event)) {
          sp_select_context_up_one_layer(this._desktop);
          return true;
        }
        if (event.shiftKey || event.altKey || mod_ctrl(event)) return false;
        // app.delete (Delete, KP_Delete, BackSpace in share/keys/inkscape.xml).
        selection.deleteItems();
        return true;
      case 'Delete':
        if (event.shiftKey || event.altKey || mod_ctrl(event)) return false;
        // app.delete. TODO: the shortcut system; the action belongs to the application.
        selection.deleteItems();
        return true;
      case 's':
      case 'S':
        if (!mod_shift_only(event)) return false;
        if (!selection.isEmpty()) this._seltrans.increaseState();
        return true;
      default:
        return false;
    }
  }
}

/**
 * Click in empty place, go up one level -- but don't leave a layer to root.
 *
 * (Rationale: we don't usually allow users to go to the root, since that
 * detracts from the layer metaphor: objects at the root level can in front
 * of or behind layers.  Whereas it's fine to go to the root if editing
 * a document that has no layers (e.g. a non-Inkscape document).)
 */
export function sp_select_context_up_one_layer(desktop: SPDesktop): void {
  const current_layer = desktop.layerManager().currentLayer();
  if (!current_layer) return;
  const parent = current_layer.parent;
  if (parent && (parent.parent || current_layer.layerMode() !== LayerMode.LAYER)) {
    desktop.layerManager().setCurrentLayer(parent);
    if (current_layer.layerMode() !== LayerMode.LAYER) desktop.getSelection().set(current_layer);
  }
}
