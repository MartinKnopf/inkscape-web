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
 * screen px. Used for the tooltip of the snap indicator.
 * TODO: anchors, adjust, borders, scaled text.
 */
export class CanvasItemText extends CanvasItem {
  #p: Point;
  #text: string;
  #fontsize = 10;
  #fill = 0x000000ff;
  #background = 0x0;
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
  set_background(rgba: number): void {
    this.#background = rgba;
    this.request_update();
  }

  protected _update(affine: Affine): void {
    const p = this.#p.transformed(affine);
    this.#label.textContent = this.#text;
    this.#label.setAttribute('font-size', String(this.#fontsize));
    this.#label.setAttribute('fill', rgbaCss(this.#fill));
    this.#label.setAttribute('text-anchor', 'middle');
    this.#label.setAttribute('x', String(p.x));
    this.#label.setAttribute('y', String(p.y + this.#fontsize / 3));
    // The browser measures the text (when it is rendered); else an estimate.
    let width = 0;
    try {
      width = this.#label.getComputedTextLength?.() ?? 0;
    } catch {
      width = 0;
    }
    if (!width) width = this.#text.length * this.#fontsize * 0.55;
    const pad = 3;
    this.#bg.setAttribute('x', String(p.x - width / 2 - pad));
    this.#bg.setAttribute('y', String(p.y - this.#fontsize / 2 - pad));
    this.#bg.setAttribute('width', String(width + 2 * pad));
    this.#bg.setAttribute('height', String(this.#fontsize + 2 * pad));
    this.#bg.setAttribute('fill', rgbaCss(this.#background));
  }
}
