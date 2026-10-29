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
import { LineSegment, type OptRect, Path, type Point, Rect } from '@inkscape-web/geom';
import type { SPDesktop } from './desktop.ts';
import { CanvasItemBpath } from './display/control/canvas-item-bpath.ts';
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

/**
 * The touch path styles of node-handles.css (upstream CanvasItemCtrlType
 * RUBBERBAND_TOUCHPATH_*): .inkscape-selection-path.selector and .eraser, stroke 2 px.
 */
export enum RubberbandTouchpathHandle {
  RUBBERBAND_TOUCHPATH_SELECT,
  RUBBERBAND_TOUCHPATH_ERASER,
}
const TOUCHPATH_STROKE: Record<RubberbandTouchpathHandle, number> = {
  [RubberbandTouchpathHandle.RUBBERBAND_TOUCHPATH_SELECT]: 0x277fffff,
  [RubberbandTouchpathHandle.RUBBERBAND_TOUCHPATH_ERASER]: 0xff0000ff,
};

const instances = new WeakMap<SPDesktop, Rubberband>();

/**
 * The rubberband rectangle of the select tool and other tools (upstream
 * Rubberband, one per desktop here; upstream has one instance). Points are
 * in desktop coordinates.
 * In TOUCHPATH mode it draws the path of the pointer; getPoints() gives
 * points on it (world coordinates) at most 0.5 screen px apart.
 * TODO: TOUCHRECT (slanted stripes), autoscroll.
 */
export class Rubberband {
  static readonly default_mode = RubberbandMode.RECT;
  static readonly default_operation = RubberbandOperation.ADD;

  _desktop: SPDesktop;
  #start: Point | null = null;
  #end: Point | null = null;
  #rect: CanvasItemRect | null = null;
  #touchpath: CanvasItemBpath | null = null;
  /** The pointer path in desktop coordinates. */
  #touchpath_curve = new Path();
  /** The pointer path in world coordinates, subdivided (upstream _path). */
  #path_points: Point[] = [];
  #handle = RubberbandTouchpathHandle.RUBBERBAND_TOUCHPATH_SELECT;
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
    this.#touchpath_curve = new Path(p);
    this.#path_points = [desktop.d2w(p)];
    this.#deleteCanvasItems();
  }

  stop(): void {
    this.#started = false;
    this.#moved = false;
    this.#mode = Rubberband.default_mode;
    this.#operation = Rubberband.default_operation;
    this.#handle = RubberbandTouchpathHandle.RUBBERBAND_TOUCHPATH_SELECT;
    this.#touchpath_curve = new Path();
    this.#path_points = [];
    this.#deleteCanvasItems();
  }

  move(p: Point): void {
    if (!this.#started || !this.#start) return;
    if (!this.#moved && p.sub(this.#start).length() <= this.#tolerance / this._desktop.current_zoom()) return;
    this.#end = p;
    this.#moved = true;
    // TODO: this._desktop.getCanvas().enable_autoscroll();
    this.#touchpath_curve.appendCurve(new LineSegment(this.#touchpath_curve.finalPoint(), p));

    const next = this._desktop.d2w(p);
    // we want the points to be at most 0.5 screen pixels apart,
    // so that we don't lose anything small;
    // if they are farther apart, we interpolate more points
    const prev = this.#path_points[this.#path_points.length - 1] ?? next;
    const dist = next.sub(prev).length();
    if (dist > 0.5) {
      const subdiv = 2 * Math.round(dist + 0.5);
      for (let i = 1; i <= subdiv; i++) this.#path_points.push(prev.add(next.sub(prev).mul(i / subdiv)));
    } else {
      this.#path_points.push(next);
    }

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
    } else if (this.#mode === RubberbandMode.TOUCHPATH) {
      this.#touchpath ??= new CanvasItemBpath(this._desktop.getCanvasControls());
      this.#touchpath.set_bpath([this.#touchpath_curve], true);
      this.#touchpath.set_fill(0x0);
      this.#touchpath.set_stroke(TOUCHPATH_STROKE[this.#handle]);
      this.#touchpath.set_visible(true);
    }
  }

  /** The points of the pointer path in world coordinates, at most 0.5 px apart (upstream getPoints). */
  getPoints(): readonly Point[] {
    return this.#path_points;
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
  setHandle(handle: RubberbandTouchpathHandle): void {
    this.#handle = handle;
  }

  #deleteCanvasItems(): void {
    this.#rect?.unlink();
    this.#rect = null;
    this.#touchpath?.unlink();
    this.#touchpath = null;
  }
}
