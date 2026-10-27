// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/control/canvas-page.cpp, src/display/control/canvas-page.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2021 Martin Owens
 */
import type { Rect } from '@inkscape-web/geom';
import { rgbaCss } from '../../ui/widget/canvas.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The page on the canvas: a filled background rectangle below the drawing
 * and a border above it (upstream CanvasPage with its CanvasItemRects).
 * Coordinates are desktop coordinates; the border is 1 screen px wide.
 * TODO: margin, bleed, label, shadow, checkerboard, selected state, colors from the namedview.
 */
export class CanvasPage {
  static readonly DEFAULT_BACKGROUND_COLOR = 0xffffffff;
  static readonly DEFAULT_BORDER_COLOR = 0x0000001a;

  _background_color = CanvasPage.DEFAULT_BACKGROUND_COLOR;
  _border_color = CanvasPage.DEFAULT_BORDER_COLOR;
  _border_on_top = true;

  #background: SVGRectElement | null = null;
  #foreground: SVGRectElement | null = null;

  /** Add the page items to the background and border groups. */
  add(size: Rect, background_group: SVGGElement, border_group: SVGGElement): void {
    this.#foreground = createRect(border_group, 'foreground');
    this.#background = createRect(background_group, 'background');
    this.update(size);
  }

  remove(): void {
    this.#foreground?.remove();
    this.#background?.remove();
    this.#foreground = this.#background = null;
  }

  /** Update the page rectangle (desktop coordinates) and colors. */
  update(size: Rect): void {
    for (const rect of [this.#background, this.#foreground]) {
      if (!rect) continue;
      rect.setAttribute('x', String(size.left()));
      rect.setAttribute('y', String(size.top()));
      rect.setAttribute('width', String(size.width()));
      rect.setAttribute('height', String(size.height()));
      const is_foreground = rect === this.#foreground;
      // This will put the border on the background OR foreground layer as needed.
      const border = is_foreground === this._border_on_top ? rgbaCss(this._border_color) : 'none';
      rect.setAttribute('stroke', border);
      rect.setAttribute('fill', is_foreground ? 'none' : rgbaCss(this._background_color));
    }
  }
}

function createRect(parent: SVGGElement, name: string): SVGRectElement {
  const rect = parent.ownerDocument.createElementNS(SVG_NS, 'rect') as SVGRectElement;
  rect.setAttribute('class', name);
  rect.setAttribute('stroke-width', '1');
  rect.setAttribute('vector-effect', 'non-scaling-stroke');
  rect.setAttribute('shape-rendering', 'crispEdges');
  parent.append(rect);
  return rect;
}
