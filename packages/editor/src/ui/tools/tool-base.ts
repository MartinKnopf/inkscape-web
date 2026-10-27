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

/**
 * The part of upstream ToolBase::root_handler that all tools share: the
 * mouse wheel (scroll, Shift: scroll horizontally, Ctrl: zoom at the
 * pointer) and panning with the middle button.
 * TODO: the tool system, space panning, right-button panning, Ctrl+middle
 * zoom and rotate, middle-click zoom, canvas rotation with Ctrl+Shift+wheel,
 * modifiers from share/keys (Modifiers::Modifier).
 */
export class ToolBase {
  readonly _desktop: SPDesktop;
  #panning: Point | null = null;
  readonly #element: SVGSVGElement;

  constructor(desktop: SPDesktop) {
    this._desktop = desktop;
    this.#element = desktop.getCanvas().svg;
    this.#element.addEventListener('wheel', this.#onWheel, { passive: false });
    this.#element.addEventListener('pointerdown', this.#onPointerDown);
    this.#element.addEventListener('pointermove', this.#onPointerMove);
    this.#element.addEventListener('pointerup', this.#onPointerUp);
    this.#element.addEventListener('pointercancel', this.#onPointerUp);
  }

  destroy(): void {
    this.#element.removeEventListener('wheel', this.#onWheel);
    this.#element.removeEventListener('pointerdown', this.#onPointerDown);
    this.#element.removeEventListener('pointermove', this.#onPointerMove);
    this.#element.removeEventListener('pointerup', this.#onPointerUp);
    this.#element.removeEventListener('pointercancel', this.#onPointerUp);
  }

  /** Pointer position in window coordinates. */
  #windowPoint(event: MouseEvent): Point {
    const r = this.#element.getBoundingClientRect();
    return new Point(event.clientX - r.left, event.clientY - r.top);
  }

  /** The desktop point under the pointer (upstream SPDesktop::point()). */
  #desktopPoint(event: MouseEvent): Point {
    const canvas = this._desktop.getCanvas();
    return this._desktop.w2d(canvas.canvas_to_world(this.#windowPoint(event)));
  }

  readonly #onWheel = (event: WheelEvent): void => {
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
      this._desktop.zoom_relative(this.#desktopPoint(event), 1.0 / scale);
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
  };

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 1) return; // middle button
    event.preventDefault(); // no autoscroll
    this.#element.setPointerCapture(event.pointerId);
    this.#panning = this.#windowPoint(event);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (!this.#panning) return;
    const motion_w = this.#windowPoint(event);
    this._desktop.scroll_relative(motion_w.sub(this.#panning));
    this.#panning = motion_w;
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (!this.#panning || (event.type === 'pointerup' && event.button !== 1)) return;
    this.#panning = null;
    if (this.#element.hasPointerCapture(event.pointerId))
      this.#element.releasePointerCapture(event.pointerId);
  };
}
