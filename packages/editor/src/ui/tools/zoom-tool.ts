// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/zoom-tool.cpp, src/ui/tools/zoom-tool.h
/*
 * Handy zooming tool
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2002 authors
 * Copyright (C) 2002 Lauris Kaplinski
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Preferences } from '@inkscape-web/core';
import { getDoubleLimited } from '../../actions/actions-canvas-transform.ts';
import type { SPDesktop } from '../../desktop.ts';
import { Rubberband } from '../../rubberband.ts';
import { type ModifierState, mod_ctrl_only, mod_shift, ToolBase } from './tool-base.ts';

/** canvas-zoom-invert: Shift (share/keys/inkscape.xml, upstream Modifiers::Modifier). */
const canvas_zoom_invert = (s: ModifierState): boolean => mod_shift(s);

/**
 * The factor to zoom relative to the current zoom for a click (upstream: the
 * zoom_rel of the button press and release handlers). The left button zooms in
 * and the right button out; with the invert modifier (Shift) it is the other way round.
 */
export function click_zoom_factor(button: 'left' | 'right', invert: boolean, zoom_inc: number): number {
  const zoom_in = (button === 'left') !== invert;
  return zoom_in ? zoom_inc : 1 / zoom_inc;
}

/**
 * The zoom tool (upstream ZoomTool): click to zoom in, Shift+click or right
 * click to zoom out, drag a rubberband rectangle to zoom to that area.
 * Escape cancels the rubberband, or else deselects.
 * TODO: cursors (zoom-in.svg and zoom-out.svg while Shift is down).
 */
export class ZoomTool extends ToolBase {
  /** The rubberband was canceled with Escape, so the button release does not zoom. */
  escaped = false;

  readonly #onContextMenu = (e: Event): void => e.preventDefault();

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/zoom');
    const prefs = Preferences.get();
    if (prefs.getBool('/tools/zoom/selcue')) this.enableSelectionCue();
    if (prefs.getBool('/tools/zoom/gradientdrag')) this.enableGrDrag();
    // The right button zooms out, so it must not open the browser's menu.
    this._element.addEventListener('contextmenu', this.#onContextMenu);
  }

  override destroy(): void {
    this._element.removeEventListener('contextmenu', this.#onContextMenu);
    Rubberband.get(this._desktop).stop();
    this.ungrabCanvasEvents();
    super.destroy();
  }

  override root_handler(event: Event): boolean {
    const prefs = Preferences.get();
    this.tolerance = Math.min(Math.max(prefs.getInt('/options/dragtolerance/value', 0), 0), 100);
    const zoom_inc = getDoubleLimited('/options/zoomincrement/value', Math.SQRT2, 1.01, 10);
    const rubberband = Rubberband.get(this._desktop);
    let ret = false;

    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        const button_w = this._windowPoint(e);
        const button_dt = this._desktopPoint(button_w);
        if (e.button === 0) {
          this.saveDragOrigin(button_w);
          rubberband.start(this._desktop, button_dt);
          this.escaped = false;
          ret = true;
        } else if (e.button === 2) {
          this._desktop.zoom_relative(button_dt, click_zoom_factor('right', canvas_zoom_invert(e), zoom_inc));
          ret = true;
        }
        if (ret) this.grabCanvasEvents(e);
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        if (!(e.buttons & 1)) break;
        const w = this._windowPoint(e);
        if (!this.checkDragMoved(w)) break;
        rubberband.move(this._desktopPoint(w));
        ret = true;
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        const button_dt = this._desktopPoint(this._windowPoint(e));
        if (e.button === 0) {
          const b = rubberband.getRectangle();
          const invert = canvas_zoom_invert(e);
          if (b && !this.within_tolerance && !invert) {
            this._desktop.set_display_area(b, 10);
          } else if (!this.escaped) {
            this._desktop.zoom_relative(button_dt, click_zoom_factor('left', invert, zoom_inc));
          }
          ret = true;
        }
        rubberband.stop();
        this.ungrabCanvasEvents(e);
        this.xyp = null;
        this.escaped = false;
        break;
      }
      case 'keydown': {
        const e = event as KeyboardEvent;
        switch (e.key) {
          case 'Escape':
            this.xyp = null;
            this.escaped = true;
            if (!rubberband.isStarted()) this._desktop.getSelection().clear();
            else rubberband.stop();
            ret = true;
            break;
          case 'ArrowUp':
          case 'ArrowDown':
            // prevent the zoom field from activation
            if (!mod_ctrl_only(e)) ret = true;
            break;
          case 'Delete':
          case 'Backspace':
            ret = this.deleteSelectedDrag(mod_ctrl_only(e));
            break;
        }
        break;
      }
    }
    return ret || super.root_handler(event);
  }
}
