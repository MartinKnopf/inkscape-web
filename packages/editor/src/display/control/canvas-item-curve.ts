// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/control/canvas-item-curve.cpp, src/display/control/canvas-item-curve.h
/*
 * A class to represent a single Bezier control curve, either a line or a cubic Bezier.
 *
 * Author:
 *   Tavmjong Bah
 *
 * Copyright (C) 2020 Tavmjong Bah
 *
 * Rewrite of SPCtrlLine and SPCtrlCurve
 */
import type { Affine, Point } from '@inkscape-web/geom';
import { rgbaCss } from '../../ui/widget/canvas.ts';
import { CanvasItem, type CanvasItemGroup } from './canvas-item.ts';

/** Primary canvas item color (upstream CANVAS_ITEM_COLORS[CANVAS_ITEM_PRIMARY]). */
const CANVAS_ITEM_PRIMARY = 0x0000ff7f;

/**
 * A line or cubic Bezier curve in desktop coordinates, drawn with a screen
 * sized stroke over a wider, half transparent white background stroke. Used
 * for the lines between nodes and their handles.
 */
export class CanvasItemCurve extends CanvasItem {
  #points: Point[] = [];
  #width = 1;
  /** this should be an odd number so that the background appears on both the sides of the curve. */
  #background_width = 3;
  #bg_alpha = 0.5;
  #stroke = CANVAS_ITEM_PRIMARY;
  readonly #background: SVGPathElement;
  readonly #path: SVGPathElement;

  constructor(group: CanvasItemGroup) {
    super(group, 'CanvasItemCurve');
    this.#background = this._createElement('path');
    this.#path = this._createElement('path');
    for (const el of [this.#background, this.#path]) el.setAttribute('fill', 'none');
  }

  /** Set a line (two points) or a cubic Bezier curve (four points). */
  set_coords(...points: [Point, Point] | [Point, Point, Point, Point]): void {
    this.#points = points;
    this.request_update();
  }

  set_width(width: number): void {
    this.#width = width;
    this.request_update();
  }

  set_bg_alpha(alpha: number): void {
    this.#bg_alpha = alpha;
    this.request_update();
  }

  set_stroke(rgba: number): void {
    this.#stroke = rgba;
    this.request_update();
  }

  protected _update(affine: Affine): void {
    const pts = this.#points.map((p) => p.transformed(affine));
    const [p0, ...rest] = pts;
    const d = p0
      ? `M ${p0.x},${p0.y} ${rest.length === 3 ? 'C' : 'L'} ${rest.map((p) => `${p.x},${p.y}`).join(' ')}`
      : '';
    this.#background.setAttribute('d', d);
    this.#background.setAttribute('stroke', `rgba(255,255,255,${this.#bg_alpha})`);
    this.#background.setAttribute('stroke-width', String(this.#background_width));
    this.#path.setAttribute('d', d);
    this.#path.setAttribute('stroke', rgbaCss(this.#stroke));
    this.#path.setAttribute('stroke-width', String(this.#width));
  }
}
