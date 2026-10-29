// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/knot/knot.cpp, src/ui/knot/knot.h
/*
 * SPKnot implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2005 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { Preferences, Signal } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemCtrl, type CanvasItemCtrlType } from '../../display/control/canvas-item-ctrl.ts';
import type { SPAnchorType } from '../../enums.ts';
import type { ModifierState } from '../tools/tool-base.ts';

/**
 * A draggable handle on the canvas (upstream SPKnot). It handles its own
 * pointer events: a press and release without motion is a click; motion
 * beyond the drag tolerance grabs the knot, and each motion requests a new
 * position (request), which then moves the knot (moved).
 * TODO: double click, Escape to cancel, tips in the status bar, cursors, snapping delay.
 */
export class SPKnot {
  readonly desktop: SPDesktop;
  readonly ctrl: CanvasItemCtrl;
  readonly tip: string;
  /** Position in desktop coordinates. */
  pos = new Point(0, 0);
  grabbed_rel_pos = new Point(0, 0);
  /** Position when the drag started (desktop coordinates). */
  drag_origin = new Point(0, 0);
  /** Set for the knots of path effects (KnotHolder: their entities write the undo step). */
  is_lpe = false;

  readonly click_signal = new Signal<[SPKnot, ModifierState]>();
  readonly grabbed_signal = new Signal<[SPKnot, ModifierState]>();
  readonly ungrabbed_signal = new Signal<[SPKnot, ModifierState]>();
  readonly moved_signal = new Signal<[SPKnot, Point, ModifierState]>();
  /**
   * Called before each move with the requested position. Returns true if it
   * has set the position itself (upstream request_signal).
   */
  request: ((knot: SPKnot, p: Point, state: ModifierState) => boolean) | null = null;

  #grabbed = false;
  #moved = false;
  #selected = false;
  #within_tolerance = false;
  #xyp = new Point(0, 0);

  constructor(desktop: SPDesktop, tip: string, type: CanvasItemCtrlType) {
    this.desktop = desktop;
    this.tip = tip;
    this.ctrl = new CanvasItemCtrl(desktop.getCanvasControls(), type);
    this.ctrl.set_visible(false);
    const el = this.ctrl.element;
    el.addEventListener('pointerdown', this.#onPointerDown);
    el.addEventListener('pointermove', this.#onPointerMove);
    el.addEventListener('pointerup', this.#onPointerUp);
    el.addEventListener('pointerenter', () => this.ctrl.set_hover(true));
    el.addEventListener('pointerleave', () => this.ctrl.set_hover(false));
  }

  destroy(): void {
    this.ctrl.unlink();
  }

  show(): void {
    this.ctrl.set_visible(true);
  }
  hide(): void {
    this.ctrl.set_visible(false);
  }
  is_visible(): boolean {
    return this.ctrl.is_visible();
  }
  is_grabbed(): boolean {
    return this.#grabbed;
  }
  is_selected(): boolean {
    return this.#selected;
  }
  selectKnot(select: boolean): void {
    this.#selected = select;
    this.ctrl.set_selected(select);
  }
  setAnchor(anchor: SPAnchorType): void {
    this.ctrl.set_anchor(anchor);
  }
  position(): Point {
    return this.pos;
  }

  /** Move to p without signals. */
  moveto(p: Point): void {
    this.pos = p;
    this.ctrl.set_position(p);
  }

  /** Move to p and emit moved. */
  setPosition(p: Point, state: ModifierState): void {
    this.pos = p;
    this.ctrl.set_position(p);
    this.moved_signal.emit(this, p, state);
  }

  requestPosition(p: Point, state: ModifierState): void {
    // If user did not complete, we simply move knot to new position.
    if (!this.request?.(this, p, state)) this.setPosition(p, state);
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    // The knot takes the event, the tool does not see it.
    event.stopPropagation();
    this.ctrl.element.setPointerCapture?.(event.pointerId);
    const w = this.desktop.getCanvas().windowPoint(event);
    this.#xyp = new Point(Math.floor(w.x), Math.floor(w.y));
    this.#within_tolerance = true;
    this.grabbed_rel_pos = this.#desktopPoint(w).sub(this.pos);
    this.drag_origin = this.pos;
    this.#grabbed = true;
    this.#moved = false;
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (!this.#grabbed) return;
    event.stopPropagation();
    const w = this.desktop.getCanvas().windowPoint(event);
    const tolerance = Math.min(Math.max(Preferences.get().getInt('/options/dragtolerance/value', 4), 0), 100);
    if (this.#within_tolerance) {
      const d = new Point(Math.floor(w.x), Math.floor(w.y)).sub(this.#xyp);
      // do not drag if we're within tolerance from origin
      if (Math.max(Math.abs(d.x), Math.abs(d.y)) < tolerance) return;
    }
    // Once the user has moved farther than tolerance from the original location
    // (indicating they intend to move the object, not click), then always process the
    // motion notify coordinates as given (no snapping back to origin)
    this.#within_tolerance = false;
    if (!this.#moved) this.grabbed_signal.emit(this, event);
    this.requestPosition(this.#desktopPoint(w).sub(this.grabbed_rel_pos), event);
    this.#moved = true;
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (!this.#grabbed || event.button !== 0) return;
    event.stopPropagation();
    this.#grabbed = false;
    if (this.#moved) this.ungrabbed_signal.emit(this, event);
    else this.click_signal.emit(this, event);
    this.#moved = false;
  };

  #desktopPoint(w: Point): Point {
    return this.desktop.w2d(this.desktop.getCanvas().canvas_to_world(w));
  }
}
