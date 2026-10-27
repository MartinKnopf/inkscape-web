// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/rubberband.cpp, src/rubberband.h, share/ui/node-handles.css
/*
 * Rubberbanding selector.
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 */
import { Preferences } from '@inkscape-web/core';
import { type OptRect, type Point, Rect } from '@inkscape-web/geom';
import type { SPDesktop } from './desktop.ts';
import { CanvasItemRect } from './display/control/canvas-item-rect.ts';

export enum RubberbandMode {
  RECT,
  TOUCHPATH,
  TOUCHRECT,
}

export enum RubberbandOperation {
  ADD,
  INVERT,
  REMOVE,
}

/**
 * Colors from node-handles.css: .inkscape-selection-rect, -deselect and -invert
 * (fill with 10% opacity, stroke 2 px, white outline 1 px).
 * TODO: read node-handles.css.
 */
const COLORS: Record<RubberbandOperation, { fill: number; stroke: number }> = {
  [RubberbandOperation.ADD]: { fill: 0x277fff1a, stroke: 0x277fffff },
  [RubberbandOperation.INVERT]: { fill: 0x4444441a, stroke: 0x444444ff },
  [RubberbandOperation.REMOVE]: { fill: 0xf299d61a, stroke: 0xf299d6ff },
};

const instances = new WeakMap<SPDesktop, Rubberband>();

/**
 * The rubberband rectangle of the select tool and other tools (upstream
 * Rubberband, one per desktop here; upstream has one instance). Points are
 * in desktop coordinates.
 * TODO: TOUCHRECT (slanted stripes) and TOUCHPATH modes, autoscroll.
 */
export class Rubberband {
  static readonly default_mode = RubberbandMode.RECT;
  static readonly default_operation = RubberbandOperation.ADD;

  _desktop: SPDesktop;
  #start: Point | null = null;
  #end: Point | null = null;
  #rect: CanvasItemRect | null = null;
  #started = false;
  #moved = false;
  #mode = Rubberband.default_mode;
  #operation = Rubberband.default_operation;
  #tolerance = 0;

  private constructor(desktop: SPDesktop) {
    this._desktop = desktop;
  }

  static get(desktop: SPDesktop): Rubberband {
    let rb = instances.get(desktop);
    if (!rb) {
      rb = new Rubberband(desktop);
      instances.set(desktop, rb);
    }
    return rb;
  }

  /** Start at desktop point p. With tolerance, move() ignores the first motion within the drag tolerance. */
  start(desktop: SPDesktop, p: Point, tolerance = false): void {
    this._desktop = desktop;
    this.#start = p;
    this.#started = true;
    this.#moved = false;
    this.#tolerance = tolerance
      ? Math.min(Math.max(Preferences.get().getInt('/options/dragtolerance/value', 4), 0), 100)
      : 0;
    this.#deleteCanvasItems();
  }

  stop(): void {
    this.#started = false;
    this.#moved = false;
    this.#mode = Rubberband.default_mode;
    this.#operation = Rubberband.default_operation;
    this.#deleteCanvasItems();
  }

  move(p: Point): void {
    if (!this.#started || !this.#start) return;
    if (!this.#moved && p.sub(this.#start).length() <= this.#tolerance / this._desktop.current_zoom()) return;
    this.#end = p;
    this.#moved = true;
    // TODO: this._desktop.getCanvas().enable_autoscroll();

    const colors = COLORS[this.#operation];
    if (this.#mode === RubberbandMode.RECT || this.#mode === RubberbandMode.TOUCHRECT) {
      if (!this.#rect) {
        this.#rect = new CanvasItemRect(this._desktop.getCanvasControls());
        this.#rect.set_stroke_width(2);
        this.#rect.set_outline(0xffffffbf);
        this.#rect.set_outline_width(1);
      }
      this.#rect.set_rect(new Rect(this.#start, this.#end));
      this.#rect.set_fill(colors.fill);
      this.#rect.set_stroke(colors.stroke);
      this.#rect.set_visible(true);
    }
  }

  /** The rectangle in desktop coordinates, while started. */
  getRectangle(): OptRect {
    if (!this.#started || !this.#start || !this.#end) return null;
    return new Rect(this.#start, this.#end);
  }

  isStarted(): boolean {
    return this.#started;
  }
  isMoved(): boolean {
    return this.#moved;
  }
  getMode(): RubberbandMode {
    return this.#mode;
  }
  setMode(mode: RubberbandMode): void {
    this.#mode = mode;
  }
  setOperation(operation: RubberbandOperation): void {
    this.#operation = operation;
  }

  #deleteCanvasItems(): void {
    this.#rect?.unlink();
    this.#rect = null;
  }
}
