// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/control/canvas-item-rect.cpp, src/display/control/canvas-item-rect.h
/*
 * A class to represent a control rectangle. Used for rubberband selector, page outline, etc.
 *
 * Author:
 *   Tavmjong Bah
 *
 * Copyright (C) 2020 Tavmjong Bah
 *
 * Rewrite of CtrlRect
 */
import { type Affine, Rect } from '@inkscape-web/geom';
import { rgbaCss } from '../../ui/widget/canvas.ts';
import { CanvasItem, type CanvasItemGroup } from './canvas-item.ts';

/** Dash pattern of dashed rects, in screen px. */
const DASHES = '4 4';

/**
 * A rectangle in desktop coordinates, drawn with screen-sized lines: outline,
 * stroke (optionally dashed, with the shadow color in the gaps) and fill.
 * TODO: rotated canvas (non axis-aligned rects),
 * fill patterns, inverted drawing.
 */
export class CanvasItemRect extends CanvasItem {
  _rect = new Rect(0, 0, 0, 0);
  _fill = 0x0;
  _stroke = 0x000000ff;
  _stroke_width = 1;
  _outline = 0x0;
  _outline_width = 0;
  _shadow_color = 0x0;
  _shadow_width = 0;
  _dashed = false;

  readonly #outline: SVGRectElement;
  readonly #stroke: SVGRectElement;
  readonly #shadow: SVGRectElement;
  readonly #fill: SVGRectElement;

  constructor(group: CanvasItemGroup, rect?: Rect) {
    super(group, 'CanvasItemRect');
    this.#outline = this._createElement('rect');
    this.#stroke = this._createElement('rect');
    this.#shadow = this._createElement('rect');
    this.#fill = this._createElement('rect');
    for (const r of [this.#outline, this.#stroke, this.#shadow]) r.setAttribute('fill', 'none');
    if (rect) this._rect = rect;
    this.request_update();
  }

  /** Set the rectangle, in desktop coordinates. */
  set_rect(rect: Rect): void {
    this._rect = rect;
    this.request_update();
  }

  set_fill(rgba: number): void {
    this._fill = rgba;
    this.request_update();
  }
  set_stroke(rgba: number): void {
    this._stroke = rgba;
    this.request_update();
  }
  set_stroke_width(width: number): void {
    this._stroke_width = width;
    this.request_update();
  }
  set_outline(rgba: number): void {
    this._outline = rgba;
    this.request_update();
  }
  set_outline_width(width: number): void {
    this._outline_width = width;
    this.request_update();
  }
  set_shadow(color: number, width: number): void {
    this._shadow_color = color;
    this._shadow_width = width;
    this.request_update();
  }
  set_dashed(dashed: boolean): void {
    this._dashed = dashed;
    this.request_update();
  }

  /** Line width of stroke and outline together. */
  get_effective_outline(): number {
    // Outline extends in two directions, so we scale by 2
    return this._stroke_width + 2 * this._outline_width;
  }

  protected _update(affine: Affine): void {
    // Snap to the pixel grid: line centers on half pixels for odd widths.
    const thickness = Math.round(this.get_effective_outline());
    const offset = thickness % 2 ? 0.5 : 0;
    const world = this._rect.transformed(affine);
    const x0 = Math.round(world.left()) + offset;
    const y0 = Math.round(world.top()) + offset;
    const x1 = Math.round(world.right()) + offset;
    const y1 = Math.round(world.bottom()) + offset;

    const visible = (rgba: number) => (rgba & 0xff) > 0;
    const place = (r: SVGRectElement, show: boolean) => {
      if (!show) {
        r.setAttribute('display', 'none');
        return;
      }
      r.removeAttribute('display');
      r.setAttribute('x', String(x0));
      r.setAttribute('y', String(y0));
      r.setAttribute('width', String(Math.max(0, x1 - x0)));
      r.setAttribute('height', String(Math.max(0, y1 - y0)));
    };

    place(this.#outline, visible(this._outline) && this._outline_width > 0);
    this.#outline.setAttribute('stroke', rgbaCss(this._outline));
    this.#outline.setAttribute('stroke-width', String(this.get_effective_outline()));

    place(this.#stroke, visible(this._stroke) && this._stroke_width > 0);
    this.#stroke.setAttribute('stroke', rgbaCss(this._stroke));
    this.#stroke.setAttribute('stroke-width', String(this._stroke_width));

    // Highlight the border by drawing it in _shadow_color, in the gaps of the dashes.
    const shadowDashes = this._dashed && this._shadow_width === 1;
    place(this.#shadow, shadowDashes);
    if (this._dashed) {
      this.#stroke.setAttribute('stroke-dasharray', DASHES);
      this.#stroke.setAttribute('stroke-dashoffset', '-0.5');
      this.#shadow.setAttribute('stroke-dasharray', DASHES);
      this.#shadow.setAttribute('stroke-dashoffset', '3.5'); // Dash offset by dash length.
      this.#shadow.setAttribute('stroke', rgbaCss(this._shadow_color));
      this.#shadow.setAttribute('stroke-width', String(this._stroke_width));
    } else {
      this.#stroke.removeAttribute('stroke-dasharray');
      this.#stroke.removeAttribute('stroke-dashoffset');
    }

    // A drop shadow around a filled rectangle (pages). Upstream draws a gradient of 6 px per
    // shadow width unit, see get_shadow_size(); a CSS blur of half that looks the same.
    const dropShadow = !this._dashed && this._shadow_width > 0 && visible(this._shadow_color);
    place(this.#fill, visible(this._fill) || dropShadow);
    this.#fill.setAttribute('fill', rgbaCss(this._fill));
    if (dropShadow) {
      const size = Math.min(this._shadow_width * 6, 120) / 2;
      this.#fill.style.filter = `drop-shadow(0 0 ${size}px ${rgbaCss(this._shadow_color)})`;
    } else {
      this.#fill.style.removeProperty('filter');
    }
  }
}
