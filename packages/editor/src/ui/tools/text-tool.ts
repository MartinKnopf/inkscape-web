// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/text-tool.cpp, src/ui/tools/text-tool.h
/*
 * TextTool
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2005 authors
 * Copyright (C) 2001 Ximian, Inc.
 */
import {
  C_,
  create_text_at_position,
  DocumentUndo,
  Layout,
  type LayoutIterator,
  Preferences,
  type Selection,
  SnapSourceType,
  SPFlowtext,
  type SPItem,
  type SPObject,
  type SPStyle,
  SPText,
  sp_te_create_selection_quads,
  sp_te_delete,
  sp_te_get_average_linespacing,
  sp_te_get_cursor_coords,
  sp_te_get_position_by_coords,
  sp_te_get_string_multiline,
  sp_te_insert,
  sp_te_insert_line,
  sp_te_replace,
  sp_te_style_at_position,
  spReprCssSetProperty,
  te_get_layout,
} from '@inkscape-web/core';
import { LineSegment, Path, type PathVector, Point } from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import { sp_desktop_get_font_size_tool } from '../../desktop-style.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { CanvasItemCurve } from '../../display/control/canvas-item-curve.ts';
import { CanvasItemRect } from '../../display/control/canvas-item-rect.ts';
import { Shortcuts } from '../shortcuts.ts';
import { mod_alt, mod_ctrl, mod_ctrl_only, mod_shift, ToolBase } from './tool-base.ts';

/** Half the GTK cursor blink time (gtk-cursor-blink-time 1200 ms). */
const BLINK_TIME = 600;

/**
 * The text tool (upstream TextTool): click to create text or to place the
 * cursor in a text, type, Enter for a new line (sodipodi:role="line"
 * tspans), Backspace and Delete, arrow keys (Shift: select), Home and End,
 * Ctrl+A, drag in a text to select. Escape deselects.
 *
 * Text input comes from a hidden textarea that has the keyboard focus while
 * a text is edited (upstream: the GTK input method context). It takes
 * typing, composition (input methods) and paste; the other keys go to
 * root_handler() and, if the tool does not use them, to the shortcuts.
 * TODO: flowed text by drag (create_text_in_rectangle), text in shape, text on
 * path, unicode mode (Ctrl+U), kerning/rotation/spacing keys (Alt+arrows,
 * Alt+[ ]), Ctrl+B/I with a selection (sp_te_apply_style), the knot holder,
 * scrolling to the cursor, status bar messages, triple click.
 */
export class TextTool extends ToolBase {
  // Insertion point position. Public due to hack used by text toolbar.
  text_sel_start: LayoutIterator;
  text_sel_end: LayoutIterator;
  /** The text we're editing, or null if none selected. */
  #text: SPItem | null = null;
  /** Text item position in root coordinates. */
  pdoc = new Point(0, 0);
  /** Clicked on canvas to place cursor, but no text typed yet so text is still null. */
  nascent_object = false;
  /** Dragging selection over text. */
  dragging_state = 0;
  /** Button pressed on the canvas (upstream: dragging rubberband to create flowtext). */
  creating = false;
  /** Initial point of the click. */
  p0 = new Point(0, 0);

  // On-canvas editing
  readonly cursor: CanvasItemCurve;
  readonly indicator: CanvasItemRect;
  /** The highlighted text: one path with the selection quads. */
  readonly text_selection_quads: CanvasItemBpath;
  // Cursor blinking
  #show = false;
  #phase = false;
  #blink: ReturnType<typeof setInterval> | null = null;

  /** The hidden input method element (upstream: imc). */
  readonly imc: HTMLTextAreaElement;
  #composing = false;
  readonly #disconnect: (() => void)[] = [];
  readonly #emptyLayout = new Layout();

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/text');
    this.text_sel_start = this.#emptyLayout.begin();
    this.text_sel_end = this.#emptyLayout.begin();

    const controls = desktop.getCanvasControls();
    this.cursor = new CanvasItemCurve(controls);
    this.cursor.set_stroke(0x000000ff);
    this.cursor.set_bg_alpha(0);
    this.cursor.set_visible(false);

    // The rectangle box tightly wrapping text object when selected or under cursor.
    this.indicator = new CanvasItemRect(controls);
    this.indicator.set_stroke(0x0000ff7f);
    this.indicator.set_shadow(0xffffff7f, 1);
    this.indicator.set_visible(false);

    this.text_selection_quads = new CanvasItemBpath(controls);
    this.text_selection_quads.set_fill(0x00777777); // Semi-transparent blue as Cairo cannot do inversion.
    this.text_selection_quads.set_stroke(0x0);

    const host = desktop.getCanvas().host;
    this.imc = host.ownerDocument.createElement('textarea');
    this.imc.className = 'text-tool-input';
    this.imc.setAttribute('aria-label', 'Text');
    this.imc.setAttribute('autocomplete', 'off');
    this.imc.setAttribute('spellcheck', 'false');
    Object.assign(this.imc.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: '1px',
      height: '1em',
      padding: '0',
      border: '0',
      opacity: '0',
      resize: 'none',
      overflow: 'hidden',
      pointerEvents: 'none',
    });
    host.append(this.imc);
    this.imc.addEventListener('keydown', this.#onImKeyDown);
    this.imc.addEventListener('input', this.#onInput);
    this.imc.addEventListener('compositionstart', this.#onCompositionStart);
    this.imc.addEventListener('compositionend', this.#onCompositionEnd);
    this.imc.addEventListener('cut', this.#onCut);
    this._element.style.cursor = 'text';

    const selection = desktop.getSelection();
    this.#disconnect.push(
      selection.connectChanged((s) => this._selectionChanged(s)),
      selection.connectModified(() => this._selectionModified()),
      desktop.connectSetStyle(() => this._styleSet()),
    );
    this._selectionChanged(selection);

    const prefs = Preferences.get();
    if (prefs.getBool('/tools/text/selcue')) this.enableSelectionCue();
    if (prefs.getBool('/tools/text/gradientdrag')) this.enableGrDrag();
  }

  override destroy(): void {
    this.enableGrDrag(false);
    this._forgetText();
    for (const d of this.#disconnect) d();
    if (this.#blink) clearInterval(this.#blink);
    if (this._desktop.getCanvas().host.ownerDocument.activeElement === this.imc) {
      this._element.focus({ preventScroll: true });
    }
    this.imc.remove();
    this._element.style.cursor = '';
    for (const item of [this.cursor, this.indicator, this.text_selection_quads]) item.unlink();
    super.destroy();
  }

  /** The text being edited, or null. */
  textItem(): SPItem | null {
    return this.#text;
  }

  /** Delete the selected text as one undo step. */
  deleteSelected(): void {
    this.deleteSelection();
    DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Delete text'), 'draw-text');
  }

  /** Insert text to replace the current selection. */
  insertText(text: string): void {
    this._insertText(text);
  }

  /** Select other_text and put the cursor at where. */
  placeCursor(other_text: SPObject, where: LayoutIterator): void {
    this._desktop.getSelection().set(other_text);
    this.text_sel_start = where.copy();
    this.text_sel_end = where.copy();
    this._updateCursor();
    this._updateTextSelection();
  }

  /** Select other_text and put the cursor nearest to p (desktop coordinates). */
  placeCursorAt(other_text: SPObject, p: Point): void {
    this._desktop.getSelection().set(other_text);
    if (this.#text) this.placeCursor(other_text, sp_te_get_position_by_coords(this.#text, p));
  }

  /** The style of the selected text, or of the text object. */
  getSelectedStyle(): SPStyle | null {
    if (!this.#text) return null;
    if (!this.text_sel_start.equals(this.text_sel_end)) {
      const start =
        this.text_sel_start.compare(this.text_sel_end) < 0 ? this.text_sel_start : this.text_sel_end;
      return sp_te_style_at_position(this.#text, start);
    }
    return this.#text.style;
  }

  /** Deletes the currently selected characters. Returns false if there is no text selection. */
  deleteSelection(): boolean {
    if (!this.#text || this.text_sel_start.equals(this.text_sel_end)) return false;
    const pair = sp_te_delete(this.#text, this.text_sel_start, this.text_sel_end);
    if (pair.success) {
      this.text_sel_start = pair.first.copy();
      this.text_sel_end = pair.first.copy();
    } else {
      // nothing deleted
      this.text_sel_start = pair.first;
      this.text_sel_end = pair.second;
    }
    this._updateCursor();
    this._updateTextSelection();
    return true;
  }

  /** Create the text at pdoc with the tool style. */
  _setupText(): void {
    const desktop = this._desktop;
    const css = desktop.getCurrentOrToolStyle('/tools/text', true);
    // Remember the text direction for all types
    const direction = Preferences.get().getInt('/tools/text/direction_mode', 0);
    if (css) spReprCssSetProperty(css, 'direction', direction ? 'rtl' : 'ltr');

    const layer = this.currentLayer();
    const text_item = layer ? create_text_at_position(layer, css, this.pdoc) : null;
    if (text_item) {
      desktop.getSelection().set(text_item);
      // Styles are in document units, so aspects from tool style must be rescaled
      const parent = text_item.parent as SPItem;
      const scale = parent.i2docAffine().inverse().descrim();
      SPText._adjustFontsizeRecursive(text_item, scale);
      text_item.adjustStroke(scale); // NOT recursive, if there is a <tspan>, let it inherit (it's empty at the moment).
    }
    DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Create text'), 'draw-text');
  }

  _insertText(str: string): void {
    if (!this.#text) {
      // printable key; create text if none (i.e. if nascent_object)
      this._setupText();
      this.nascent_object = false; // we don't need it anymore, having created a real <text>
    }
    if (!this.#text) return;
    this.#setCursor(sp_te_replace(this.#text, this.text_sel_start, this.text_sel_end, str));
    this._updateCursor();
    this._updateTextSelection();
    DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Insert Unicode character'), 'draw-text');
  }

  /**
   * Insert typed (or composed) text (upstream _commit, from the input
   * method). Typing merges into one undo step until another action.
   */
  _commit(string: string): void {
    if (!this.#text) {
      this._setupText();
      this.nascent_object = false;
    }
    if (!this.#text || !string) return;
    // Insert the new text
    this.#setCursor(sp_te_replace(this.#text, this.text_sel_start, this.text_sel_end, string));
    // TODO: apply the pending style (Ctrl+B/I without selection) with sp_te_apply_style.
    this._updateCursor();
    this._updateTextSelection();
    DocumentUndo.maybeDone(this._desktop.getDocument(), 'text:type', C_('Undo', 'Type text'), 'draw-text');
  }

  /** Paste text from the clipboard into the edited text (upstream pasteInline). Returns true on success. */
  pasteInline(clip_text: string): boolean {
    if (!this.#text && !this.nascent_object) return false;
    // The XML standard defines the valid characters: remove other control characters.
    const txt = [...clip_text].filter((c) => c >= ' ' || c === '\t' || c === '\n' || c === '\r').join('');
    if (!txt) return false;
    if (!this.#text) {
      // create text if none (i.e. if nascent_object)
      this._setupText();
      this.nascent_object = false;
    }
    const text = this.#text;
    if (!text) return false;
    const is_svg2 = text instanceof SPText && text.has_shape_inside();
    const lines = is_svg2 ? [txt] : txt.replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, i) => {
      if (i > 0) {
        const pair = sp_te_delete(text, this.text_sel_start, this.text_sel_end);
        this.#setCursor(sp_te_insert_line(text, pair.first));
      }
      if (line) this.#setCursor(sp_te_replace(text, this.text_sel_start, this.text_sel_end, line));
    });
    this._updateCursor();
    this._updateTextSelection();
    DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Paste text'), 'draw-text');
    return true;
  }

  #setCursor(it: LayoutIterator): void {
    this.text_sel_start = it.copy();
    this.text_sel_end = it.copy();
  }

  override root_handler(event: Event): boolean {
    this.indicator.set_visible(false);
    this._validateCursorIterators();
    this.tolerance = Math.min(Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0), 100);

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
      case 'keyup':
        // The text input has the key; Space must not switch to the selector.
        ret = !!this.#text || this.nascent_object;
        break;
    }
    return ret || super.root_handler(event);
  }

  /** Button press: in a text, place the cursor (upstream item_handler); else start a new text. */
  #buttonPress(event: PointerEvent): boolean {
    if (event.button !== 0) return false;
    const w = this._windowPoint(event);
    const p = this._desktopPoint(w);

    // find out clicked item, disregarding groups
    const item_ungrouped = this._desktop.getItemAtPoint(w, true);
    if (item_ungrouped instanceof SPText || item_ungrouped instanceof SPFlowtext) {
      const old_start = this.text_sel_start.copy();
      this._desktop.getSelection().set(item_ungrouped);
      if (this.#text) {
        // set the cursor closest to that point
        // (We hardcode the modifier to match expectations for text fields, which
        // on many platforms use shift to mean "select from cursor to HERE")
        const pos = sp_te_get_position_by_coords(this.#text, p);
        if (mod_shift(event)) {
          this.text_sel_start = old_start;
          this.text_sel_end = pos;
        } else {
          this.#setCursor(pos);
        }
        // update display
        this._updateCursor();
        this._updateTextSelection();
        this.dragging_state = 1;
        this.grabCanvasEvents(event);
      }
      return true;
    }

    if (!have_viable_layer(this._desktop)) return true;
    this.saveDragOrigin(w);
    this.p0 = this._freeSnap(p);
    this.grabCanvasEvents(event);
    this.creating = true;
    return true;
  }

  #motion(event: PointerEvent): boolean {
    if (event.buttons & 1 && this.dragging_state && this.#text) {
      // set the cursor closest to that point
      const new_end = sp_te_get_position_by_coords(this.#text, this._desktopPoint(this._windowPoint(event)));
      if (!this.text_sel_end.equals(new_end)) {
        this.text_sel_end = new_end;
        this._updateCursor();
        this._updateTextSelection();
      }
      return true;
    }
    if (this.creating && event.buttons & 1) {
      this.checkDragMoved(this._windowPoint(event));
      return true;
    }
    // Highlight the text under the pointer.
    const item_ungrouped = this._desktop.getItemAtPoint(this._windowPoint(event), true);
    if (item_ungrouped instanceof SPText || item_ungrouped instanceof SPFlowtext) {
      const ibbox = item_ungrouped.desktopVisualBounds();
      if (ibbox) this.indicator.set_rect(ibbox);
      this.indicator.set_stroke(te_get_layout(item_ungrouped)?.inputTruncated() ? 0xff0000ff : 0x0000ff7f);
      this.indicator.set_visible(true);
    } else {
      this._preSnap(this._desktopPoint(this._windowPoint(event)), SnapSourceType.SNAPSOURCE_OTHER_HANDLE);
    }
    return false;
  }

  #buttonRelease(event: PointerEvent): boolean {
    if (event.button !== 0) return false;
    this.ungrabCanvasEvents(event);
    if (this.dragging_state) {
      this.dragging_state = 0;
      this.#focusInput();
      return true;
    }
    if (!this.creating) return false;
    this.creating = false;

    // Cursor height is defined by the new text object's font size; it needs to be set
    // artificially here, for the text object does not exist yet:
    const cursor_height = sp_desktop_get_font_size_tool(this._desktop);
    const cursor_size = new Point(0, this._desktop.yaxisdir() * cursor_height);

    // TODO: a drag creates flowed text in a frame (create_text_in_rectangle); a click is used for now.
    const p1 = this.p0;
    // Button 1, set X & Y & new item.
    this.pdoc = p1.transformed(this._desktop.dt2doc());
    this.nascent_object = true; // new object was just created
    this.within_tolerance = false;
    this._desktop.getSelection().clear();
    this.cursor.set_coords(p1, p1.sub(cursor_size));
    this.#placeInput(p1.sub(cursor_size));
    this._showCursor();
    this.#focusInput();
    return true;
  }

  /** Double click in a text: select the word (upstream item_handler n_press == 2). */
  #doubleClick(): boolean {
    const layout = this.#text ? te_get_layout(this.#text) : null;
    if (!layout) return false;
    if (!layout.isStartOfWord(this.text_sel_start)) this.text_sel_start.prevStartOfWord();
    if (!layout.isEndOfWord(this.text_sel_end)) this.text_sel_end.nextEndOfWord();
    this._updateCursor();
    this._updateTextSelection();
    return true;
  }

  #keyPress(event: KeyboardEvent): boolean {
    const text = this.#text;
    if (!text && !this.nascent_object) {
      // do nothing if there's no object to type in - the key will be sent to parent context,
      // except up/down that are swallowed to prevent the zoom field from activation
      return (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !mod_ctrl_only(event);
    }

    const old_start = this.text_sel_start.copy();
    const old_end = this.text_sel_end.copy();
    let cursor_moved = false;
    let screenlines = 1;
    if (text) {
      const spacing = sp_te_get_average_linespacing(text);
      const d = this._desktop.get_display_area();
      screenlines = Math.max(Math.floor(d.height() / (spacing || 1)) - 1, 1);
    }
    const doc = this._desktop.getDocument();

    switch (event.key) {
      case ' ':
        if (mod_ctrl_only(event)) {
          // No-break space
          this._insertText(' ');
          DocumentUndo.done(doc, C_('Undo', 'Insert no-break space'), 'draw-text');
          return true;
        }
        break;
      case 'a':
      case 'A':
        if (mod_ctrl_only(event) && text) {
          const layout = te_get_layout(text);
          if (layout) {
            this.text_sel_start = layout.begin();
            this.text_sel_end = layout.end();
            this._updateCursor();
            this._updateTextSelection();
            return true;
          }
        }
        break;
      case 'Enter': {
        if (!this.#text) {
          // printable key; create text if none (i.e. if nascent_object)
          this._setupText();
          this.nascent_object = false;
        }
        const t = this.#text;
        if (!t) return true;
        if (t instanceof SPText && (t.has_shape_inside() || t.has_inline_size())) {
          // Handle new line like any other character.
          this.#setCursor(sp_te_insert(t, this.text_sel_start, '\n'));
        } else {
          // Replace new line by either <tspan sodipodi:role="line" or <flowPara>.
          const enter_pair = sp_te_delete(t, this.text_sel_start, this.text_sel_end);
          this.#setCursor(sp_te_insert_line(t, enter_pair.first));
        }
        this._updateCursor();
        this._updateTextSelection();
        DocumentUndo.done(doc, C_('Undo', 'New line'), 'draw-text');
        return true;
      }
      case 'Backspace':
        if (text) {
          // if nascent_object, do nothing, but return TRUE; same for all other delete and move keys
          let noSelection = false;
          if (mod_ctrl(event)) this.text_sel_start = this.text_sel_end.copy();
          if (this.text_sel_start.equals(this.text_sel_end)) {
            if (mod_ctrl(event)) this.text_sel_start.prevStartOfWord();
            else this.text_sel_start.charEraseStart();
            noSelection = true;
          }
          const bspace_pair = sp_te_delete(text, this.text_sel_start, this.text_sel_end);
          if (noSelection || bspace_pair.success) {
            this.#setCursor(bspace_pair.success ? bspace_pair.first : bspace_pair.second);
          } else {
            // nothing deleted
            this.text_sel_start = bspace_pair.first;
            this.text_sel_end = bspace_pair.second;
          }
          this._updateCursor();
          this._updateTextSelection();
          DocumentUndo.done(doc, C_('Undo', 'Backspace'), 'draw-text');
        }
        return true;
      case 'Delete':
        if (text) {
          let noSelection = false;
          if (mod_ctrl(event)) this.text_sel_start = this.text_sel_end.copy();
          if (this.text_sel_start.equals(this.text_sel_end)) {
            if (mod_ctrl(event)) this.text_sel_end.nextEndOfWord();
            else this.text_sel_end.nextCursorPosition();
            noSelection = true;
          }
          const del_pair = sp_te_delete(text, this.text_sel_start, this.text_sel_end);
          if (noSelection || del_pair.success) {
            this.#setCursor(del_pair.first);
          } else {
            // nothing deleted
            this.text_sel_start = del_pair.first;
            this.text_sel_end = del_pair.second;
          }
          this._updateCursor();
          this._updateTextSelection();
          DocumentUndo.done(doc, C_('Undo', 'Delete'), 'draw-text');
        }
        return true;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        if (text) {
          if (mod_alt(event)) return true; // TODO: kerning (sp_te_adjust_kerning_screen)
          const end = this.text_sel_end;
          const ctrl = mod_ctrl(event);
          if (event.key === 'ArrowLeft') ctrl ? end.cursorLeftWithControl() : end.cursorLeft();
          else if (event.key === 'ArrowRight') ctrl ? end.cursorRightWithControl() : end.cursorRight();
          else if (event.key === 'ArrowUp') ctrl ? end.cursorUpWithControl() : end.cursorUp();
          else ctrl ? end.cursorDownWithControl() : end.cursorDown();
          cursor_moved = true;
          break;
        }
        return true;
      case 'Home':
        if (text) {
          if (mod_ctrl(event)) this.text_sel_end.thisStartOfShape();
          else this.text_sel_end.thisStartOfLine();
          cursor_moved = true;
          break;
        }
        return true;
      case 'End':
        if (text) {
          if (mod_ctrl(event)) this.text_sel_end.nextStartOfShape();
          else this.text_sel_end.thisEndOfLine();
          cursor_moved = true;
          break;
        }
        return true;
      case 'PageDown':
        if (text) {
          this.text_sel_end.cursorDown(screenlines);
          cursor_moved = true;
          break;
        }
        return true;
      case 'PageUp':
        if (text) {
          this.text_sel_end.cursorUp(screenlines);
          cursor_moved = true;
          break;
        }
        return true;
      case 'Escape':
        this.creating = false;
        this._desktop.getSelection().clear();
        this.nascent_object = false;
        this._updateCursor();
        this.#focusInput();
        return true;
      default:
        break;
    }

    if (cursor_moved) {
      if (!mod_shift(event)) this.text_sel_start = this.text_sel_end.copy();
      if (!old_start.equals(this.text_sel_start) || !old_end.equals(this.text_sel_end)) {
        this._updateCursor();
        this._updateTextSelection();
      }
      return true;
    }
    return false;
  }

  // Input method (the hidden textarea)

  /** Keys in the text input: the tool's keys, then the shortcuts; typing goes to the input event. */
  readonly #onImKeyDown = (event: KeyboardEvent): void => {
    if (this._desktop.getTool() !== this || event.isComposing || this.#composing) return;
    if (this.root_handler(event)) return;
    const text = this.#text;
    const key = event.key.toLowerCase();
    if (mod_ctrl_only(event) && (key === 'c' || key === 'x')) {
      // Let the browser copy the selected text from the input.
      if (text && !this.text_sel_start.equals(this.text_sel_end)) {
        this.imc.value = sp_te_get_string_multiline(text, this.text_sel_start, this.text_sel_end);
        this.imc.select();
      }
      return;
    }
    if (mod_ctrl_only(event) && key === 'v') return; // paste arrives as input
    // Keys that do not type: the shortcuts (undo, tool switches, ...).
    if (
      (mod_ctrl(event) || event.altKey || event.key.length > 1) &&
      Shortcuts.getInstance().invoke_action(event)
    ) {
      event.preventDefault();
    }
  };

  readonly #onInput = (event: Event): void => {
    if ((event as InputEvent).isComposing || this.#composing) return;
    const data = this.imc.value;
    this.imc.value = '';
    if (!data || !(event as InputEvent).inputType?.startsWith('insert')) return;
    if (data.includes('\n') || (event as InputEvent).inputType === 'insertFromPaste') this.pasteInline(data);
    else this._commit(data);
  };

  readonly #onCompositionStart = (): void => {
    this.#composing = true;
  };

  readonly #onCompositionEnd = (event: CompositionEvent): void => {
    this.#composing = false;
    const data = event.data || this.imc.value;
    this.imc.value = '';
    if (data) this._commit(data);
  };

  /** After the browser has copied the selected text: delete it. */
  readonly #onCut = (): void => {
    queueMicrotask(() => {
      this.imc.value = '';
      if (this.#text && !this.text_sel_start.equals(this.text_sel_end)) this.deleteSelected();
    });
  };

  /** Give the keyboard focus to the text input while there is text to edit, else to the canvas. */
  #focusInput(): void {
    const active = this.imc.ownerDocument.activeElement;
    if (this.#text || this.nascent_object) {
      if (active !== this.imc) this.imc.focus({ preventScroll: true });
    } else if (active === this.imc) {
      this._element.focus({ preventScroll: true });
    }
  }

  /** Move the text input to p (desktop coordinates), so the input method windows appear at the cursor. */
  #placeInput(p: Point): void {
    const canvas = this._desktop.getCanvas();
    const w = this._desktop.d2w(p).sub(canvas.get_pos());
    const r = canvas.svg.getBoundingClientRect();
    this.imc.style.left = `${r.left + w.x}px`;
    this.imc.style.top = `${r.top + w.y}px`;
  }

  // Selection and display

  _selectionChanged(selection: Selection): void {
    const item = selection.singleItem();
    if (this.#text && item !== this.#text) this._forgetText();
    this.#text = null;
    if (item instanceof SPText || item instanceof SPFlowtext) {
      this.#text = item;
      this.#setCursor(item.layout.end());
    } else {
      this.#setCursor(this.#emptyLayout.begin());
    }
    // we update cursor without scrolling, because this position may not be final;
    // item_handler moves cursor to the point of click immediately
    this._updateCursor(false);
    this._updateTextSelection();
    this.#focusInput();
  }

  _selectionModified(): void {
    this._updateCursor();
    this._updateTextSelection();
  }

  /** A style set while text is selected applies to the text (upstream _styleSet). TODO: sp_te_apply_style. */
  _styleSet(): boolean {
    return false;
  }

  /** Undo can change the text length without us knowing it. */
  _validateCursorIterators(): void {
    const layout = this.#text ? te_get_layout(this.#text) : null;
    if (!layout) return;
    layout.validateIterator(this.text_sel_start);
    layout.validateIterator(this.text_sel_end);
  }

  _showCursor(): void {
    this.#show = true;
    this.#phase = false;
    this.cursor.set_stroke(0x000000ff);
    this.cursor.set_visible(true);
    this._resetBlinkTimer();
  }

  _resetBlinkTimer(): void {
    if (this.#blink) clearInterval(this.#blink);
    this.#blink = setInterval(() => this._blinkCursor(), BLINK_TIME);
  }

  _blinkCursor(): void {
    if (!this.#show) return;
    this.#phase = !this.#phase;
    this.cursor.set_stroke(this.#phase ? 0xffffffff : 0x000000ff);
    const active = this.imc.ownerDocument.activeElement;
    this.cursor.set_visible(active === this.imc || active === this._element);
  }

  /** Draw the cursor at text_sel_end. TODO: scroll_to_see, the frame of flowed text, status messages. */
  _updateCursor(_scroll_to_see = true): void {
    const text = this.#text;
    if (text) {
      this._validateCursorIterators();
      const { p0, p1 } = sp_te_get_cursor_coords(text, this.text_sel_end);
      const i2dt = text.i2dtAffine();
      const d0 = p0.transformed(i2dt);
      const d1 = p1.transformed(i2dt);
      this.cursor.set_coords(d0, d1);
      this.#placeInput(d1);
      this._showCursor();
    } else if (!this.nascent_object) {
      this.cursor.set_visible(false);
      this.#show = false;
    }
  }

  /** Highlight the selected characters. */
  _updateTextSelection(): void {
    const text = this.#text;
    const path: PathVector = [];
    if (text) {
      const quads = sp_te_create_selection_quads(
        text,
        this.text_sel_start,
        this.text_sel_end,
        text.i2dtAffine(),
      );
      for (let i = 0; i + 3 < quads.length; i += 4) {
        const quad = new Path(quads[i]!);
        for (let j = 1; j < 4; j++) quad.appendCurve(new LineSegment(quads[i + j - 1]!, quads[i + j]!));
        quad.close();
        path.push(quad);
      }
    }
    this.text_selection_quads.set_bpath(path);
    this.text_selection_quads.set_visible(path.length > 0);
  }

  _forgetText(): void {
    // We have to set it to zero, or selection changed signal messes everything up
    this.#text = null;
  }
}

/** The selected text of the tool. */
export function get_selected_text(tool: TextTool): string {
  const text = tool.textItem();
  return text ? sp_te_get_string_multiline(text, tool.text_sel_start, tool.text_sel_end) : '';
}

/** The cursor position of tool in other_text, or null. */
export function get_cursor_position(tool: TextTool, other_text: SPObject): LayoutIterator | null {
  return other_text === tool.textItem() ? tool.text_sel_end : null;
}
