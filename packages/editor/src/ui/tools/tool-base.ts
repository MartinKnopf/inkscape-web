// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/tool-base.cpp, src/ui/tools/tool-base.h
/*
 * Main event handling, and related helper functions.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Frank Felfe <innerspace@iname.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Kris De Gussem <Kris.DeGussem@gmail.com>
 *
 * Copyright (C) 1999-2012 authors
 */
import { Preferences } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { getDoubleLimited } from '../../actions/actions-canvas-transform.ts';
import type { SPDesktop } from '../../desktop.ts';

/** Browser wheel deltas per wheel click: Chromium reports 100 px, Firefox 3 lines. */
const PIXELS_PER_WHEEL_CLICK = 100;
const LINES_PER_WHEEL_CLICK = 3;

/** The modifier keys of an event (upstream: the GDK modifier state). */
export type ModifierState = Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>;

// Upstream mod_shift() etc. "Ctrl" is the primary modifier: Ctrl, or Cmd on macOS.
export const mod_shift = (s: ModifierState): boolean => s.shiftKey;
export const mod_ctrl = (s: ModifierState): boolean => s.ctrlKey || s.metaKey;
export const mod_alt = (s: ModifierState): boolean => s.altKey;
export const mod_shift_only = (s: ModifierState): boolean => s.shiftKey && !mod_ctrl(s) && !s.altKey;
export const mod_ctrl_only = (s: ModifierState): boolean => mod_ctrl(s) && !s.shiftKey && !s.altKey;
export const mod_alt_only = (s: ModifierState): boolean => s.altKey && !s.shiftKey && !mod_ctrl(s);

/** DOM events the tools handle (upstream CanvasEvent). */
const EVENT_TYPES = [
  'wheel',
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'dblclick',
  'keydown',
  'keyup',
] as const;

/**
 * Base class of the tools (upstream ToolBase). The tool gets the canvas
 * events while it is the active tool of its desktop. root_handler() here
 * does what all tools share: the mouse wheel (scroll, Shift: scroll
 * horizontally, Ctrl: zoom at the pointer) and panning with the middle
 * button. Tools override root_handler() and call it for unhandled events.
 * TODO: item_handler, space panning, right-button panning, Ctrl+middle
 * zoom and rotate, middle-click zoom, canvas rotation with Ctrl+Shift+wheel,
 * modifiers from share/keys (Modifiers::Modifier), cursors, message context.
 */
export class ToolBase {
  readonly _desktop: SPDesktop;
  readonly #prefsPath: string;
  #panning: Point | null = null;
  protected readonly _element: SVGSVGElement;

  /** Drag origin in window coordinates, see saveDragOrigin(). */
  xyp: Point | null = null;
  /** True until the pointer has moved farther than tolerance from xyp. */
  within_tolerance = false;
  /** Drag tolerance in screen px (/options/dragtolerance/value). */
  tolerance = 0;

  constructor(desktop: SPDesktop, prefsPath = '') {
    this._desktop = desktop;
    this.#prefsPath = prefsPath;
    this._element = desktop.getCanvas().svg;
    for (const type of EVENT_TYPES) {
      this._element.addEventListener(type, this.#onEvent, type === 'wheel' ? { passive: false } : undefined);
    }
  }

  destroy(): void {
    for (const type of EVENT_TYPES) this._element.removeEventListener(type, this.#onEvent);
  }

  getPrefsPath(): string {
    return this.#prefsPath;
  }

  readonly #onEvent = (event: Event): void => {
    // Only the active tool of the desktop handles events.
    if (this._desktop.getTool() !== this) return;
    // The canvas takes the keyboard focus when clicked.
    if (event.type === 'pointerdown') this._element.focus({ preventScroll: true });
    this.root_handler(event);
  };

  /** Handle a canvas event. Returns true if the event was handled. */
  root_handler(event: Event): boolean {
    switch (event.type) {
      case 'wheel':
        this.#onWheel(event as WheelEvent);
        return true;
      case 'pointerdown':
        return this.#onPointerDown(event as PointerEvent);
      case 'pointermove':
        return this.#onPointerMove(event as PointerEvent);
      case 'pointerup':
      case 'pointercancel':
        return this.#onPointerUp(event as PointerEvent);
      default:
        return false;
    }
  }

  /** Pointer position in window coordinates. */
  protected _windowPoint(event: MouseEvent): Point {
    return this._desktop.getCanvas().windowPoint(event);
  }

  /** The desktop point at window point w (upstream SPDesktop::w2d of the event position). */
  protected _desktopPoint(w: Point): Point {
    return this._desktop.w2d(this._desktop.getCanvas().canvas_to_world(w));
  }

  /** Remember the press position, to tell clicks from drags (see checkDragMoved()). */
  saveDragOrigin(pos: Point): void {
    this.xyp = new Point(Math.floor(pos.x), Math.floor(pos.y));
    this.within_tolerance = true;
  }

  /**
   * Analyse the current position and return true once it has moved farther than tolerance
   * from the drag origin (indicating they intend to move the object, not click).
   */
  checkDragMoved(pos: Point): boolean {
    if (this.within_tolerance && this.xyp) {
      const d = new Point(Math.floor(pos.x), Math.floor(pos.y)).sub(this.xyp);
      if (Math.max(Math.abs(d.x), Math.abs(d.y)) < this.tolerance) {
        // Do not drag if within tolerance from origin.
        return false;
      }
      // Mark drag as started.
      this.within_tolerance = false;
    }
    // Always return true once the drag has started.
    return true;
  }

  #onWheel(event: WheelEvent): void {
    event.preventDefault();
    // Wheel clicks; touchpads give fractions.
    const perClick =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINES_PER_WHEEL_CLICK : PIXELS_PER_WHEEL_CLICK;
    let delta = new Point(event.deltaX, event.deltaY).div(perClick);
    // Factor of 2 for legacy reasons: previously we did two wheel_scrolls for each mouse scroll.
    const wheelscroll = Preferences.get().getInt('/options/wheelscroll/value', 40);
    const scroll_inc = (wheelscroll >= 0 && wheelscroll <= 1000 ? wheelscroll : 40) * 2;

    if (event.ctrlKey || event.metaKey) {
      // CANVAS_ZOOM: zoom by the amount vertically scrolled. Touchpad pinch also arrives here.
      if (delta.y === 0) return;
      const zoom_inc = getDoubleLimited('/options/zoomincrement/value', Math.SQRT2, 1.01, 10);
      const scale = zoom_inc ** delta.y;
      this._desktop.zoom_relative(this._desktopPoint(this._windowPoint(event)), 1.0 / scale);
    } else if (event.shiftKey) {
      // CANVAS_PAN_X: scroll horizontally by the amount vertically scrolled.
      const d = delta.y || delta.x;
      if (d === 0) return;
      this._desktop.scroll_relative(new Point(-d * scroll_inc, 0));
    } else {
      // CANVAS_PAN_Y: scroll both horizontally and vertically.
      if (delta.isZero()) return;
      delta = delta.mul(scroll_inc);
      this._desktop.scroll_relative(delta.neg());
    }
  }

  #onPointerDown(event: PointerEvent): boolean {
    if (event.button !== 1) return false; // middle button
    event.preventDefault(); // no autoscroll
    this._element.setPointerCapture(event.pointerId);
    this.#panning = this._windowPoint(event);
    return true;
  }

  #onPointerMove(event: PointerEvent): boolean {
    if (!this.#panning) return false;
    const motion_w = this._windowPoint(event);
    this._desktop.scroll_relative(motion_w.sub(this.#panning));
    this.#panning = motion_w;
    return true;
  }

  #onPointerUp(event: PointerEvent): boolean {
    if (!this.#panning || (event.type === 'pointerup' && event.button !== 1)) return false;
    this.#panning = null;
    if (this._element.hasPointerCapture(event.pointerId))
      this._element.releasePointerCapture(event.pointerId);
    return true;
  }
}
