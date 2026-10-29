// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/control/canvas-item-text.cpp, src/display/control/canvas-item-text.h
/*
 * A class to represent on-screen text.
 *
 * Author:
 *   Tavmjong Bah
 *
 * Copyright (C) 2020 Tavmjong Bah
 *
 * Rewrite of SPCanvasText.
 */
import { type Affine, Point } from '@inkscape-web/geom';
import { rgbaCss } from '../../ui/widget/canvas.ts';
import { CanvasItem, type CanvasItemGroup } from './canvas-item.ts';

/**
 * A text label at a desktop point, with a rounded background; the size is in
 * screen px. Used for the tooltip of the snap indicator and the page labels.
 * TODO: adjust, scaled text.
 */
export class CanvasItemText extends CanvasItem {
  #p: Point;
  #text: string;
  #fontsize = 10;
  #fill = 0x000000ff;
  #background = 0x0;
  /** Horizontal anchor: 0 puts the text start at the coordinate, 0.5 (default) centers it. */
  #anchor = 0.5;
  /** Vertical anchor: 0 puts the top of the background at the coordinate, 1 its bottom, 0.5 (default) centers it. */
  #anchor_y = 0.5;
  /** Corner radius of the background as a fraction of half its height; null: 3 px. */
  #bg_radius: number | null = null;
  /** Padding between the text and the edge of the background, in px. */
  #border = 3;
  readonly #bg: SVGRectElement;
  readonly #label: SVGTextElement;

  constructor(group: CanvasItemGroup, p: Point = new Point(0, 0), text = '') {
    super(group, 'CanvasItemText');
    this.#p = p;
    this.#text = text;
    this.#bg = this._createElement('rect');
    this.#bg.setAttribute('rx', '3');
    this.#label = this._createElement('text');
    this.#label.setAttribute('font-family', 'sans-serif');
    this.request_update();
  }

  set_coord(p: Point): void {
    this.#p = p;
    this.request_update();
  }
  set_text(text: string): void {
    this.#text = text;
    this.request_update();
  }
  set_fontsize(fontsize: number): void {
    this.#fontsize = fontsize;
    this.request_update();
  }
  set_fill(rgba: number): void {
    this.#fill = rgba;
    this.request_update();
  }
  set_anchor_x(anchor: number): void {
    this.#anchor = anchor;
    this.request_update();
  }
  /** Set both anchors (upstream set_anchor). A negative y anchor moves the text below the coordinate. */
  set_anchor(anchor: Point): void {
    this.#anchor = anchor.x;
    this.#anchor_y = anchor.y;
    this.request_update();
  }
  set_bg_radius(radius: number): void {
    this.#bg_radius = radius;
    this.request_update();
  }
  set_border(border: number): void {
    this.#border = border;
    this.request_update();
  }
  set_background(rgba: number): void {
    this.#background = rgba;
    this.request_update();
  }

  protected _update(affine: Affine): void {
    const p = this.#p.transformed(affine);
    this.#label.textContent = this.#text;
    this.#label.setAttribute('font-size', String(this.#fontsize));
    this.#label.setAttribute('fill', rgbaCss(this.#fill));
    this.#label.setAttribute('text-anchor', 'start');
    const pad = this.#border;
    const height = this.#fontsize + 2 * pad;
    const top = p.y - height * this.#anchor_y;
    this.#label.setAttribute('y', String(top + pad + (this.#fontsize * 5) / 6));
    // The browser measures the text (when it is rendered); else an estimate.
    let width = 0;
    try {
      width = this.#label.getComputedTextLength?.() ?? 0;
    } catch {
      width = 0;
    }
    if (!width) width = this.#text.length * this.#fontsize * 0.55;
    const left = p.x - width * this.#anchor;
    this.#label.setAttribute('x', String(left));
    this.#bg.setAttribute('x', String(left - pad));
    this.#bg.setAttribute('y', String(top));
    this.#bg.setAttribute('width', String(width + 2 * pad));
    this.#bg.setAttribute('height', String(height));
    this.#bg.setAttribute('rx', String(this.#bg_radius === null ? 3 : (this.#bg_radius * height) / 2));
    this.#bg.setAttribute('fill', rgbaCss(this.#background));
  }
}
