// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-image.cpp, src/display/drawing-image.h
/*
 * Bitmap image belonging to an SVG drawing.
 *
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import { type DrawingImage, type Pixbuf, SPImageRendering, type SPStyle } from '@inkscape-web/core';
import { Point, Rect } from '@inkscape-web/geom';
import { SvgDrawingItem } from './drawing-item.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Image display item (upstream DrawingImage): an svg:g with a nested svg:svg
 * for the clip box and an svg:image for the pixbuf. Upstream paints the
 * pixbuf with Cairo; here the browser loads and draws pixbuf.href.
 * TODO: outline mode (box with diagonals), grayscale display mode.
 */
export class SvgDrawingImage extends SvgDrawingItem implements DrawingImage {
  readonly #clip: SVGSVGElement;
  readonly #image: SVGImageElement;
  #pixbuf: Pixbuf | null = null;
  #scale: [number, number] = [1, 1];
  #origin = new Point(0, 0);
  #clipbox = new Rect(0, 0, 0, 0);

  constructor(doc: Document) {
    super(doc.createElementNS(SVG_NS, 'g') as SVGElement);
    this.#clip = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.#clip.setAttribute('overflow', 'hidden');
    this.#image = doc.createElementNS(SVG_NS, 'image') as SVGImageElement;
    this.#image.setAttribute('preserveAspectRatio', 'none');
    this.#clip.append(this.#image);
    this.element.append(this.#clip);
  }

  setPixbuf(pixbuf: Pixbuf | null): void {
    this.#pixbuf = pixbuf;
    this.#update();
  }
  setScale(sx: number, sy: number): void {
    this.#scale = [sx, sy];
    this.#update();
  }
  setOrigin(origin: Point): void {
    this.#origin = origin;
    this.#update();
  }
  setClipbox(box: Rect): void {
    this.#clipbox = box;
    this.#update();
  }

  /** The area the image covers: the scaled pixbuf, clipped to the clip box. */
  bounds(): Rect {
    if (!this.#pixbuf) return this.#clipbox;
    const view = new Rect(
      this.#origin,
      this.#origin.add(
        new Point(this.#pixbuf.width() * this.#scale[0], this.#pixbuf.height() * this.#scale[1]),
      ),
    );
    return this.#clipbox.intersect(view) ?? this.#clipbox;
  }

  override setStyle(style: SPStyle | null, contextStyle?: SPStyle | null): void {
    super.setStyle(style, contextStyle);
    // See: http://www.w3.org/TR/SVG/painting.html#ImageRenderingProperty
    // 'optimizeSpeed' is an alias for "pixelated", 'optimizeQuality' for "smooth".
    let rendering: string | null = null;
    switch (style?.image_rendering.computed) {
      case SPImageRendering.SP_CSS_IMAGE_RENDERING_OPTIMIZESPEED:
      case SPImageRendering.SP_CSS_IMAGE_RENDERING_PIXELATED:
        rendering = 'pixelated';
        break;
      case SPImageRendering.SP_CSS_IMAGE_RENDERING_CRISPEDGES:
        rendering = 'crisp-edges';
        break;
    }
    if (rendering) this.#image.style.setProperty('image-rendering', rendering);
    else this.#image.style.removeProperty('image-rendering');
  }

  #update(): void {
    const pb = this.#pixbuf;
    const [sx, sy] = this.#scale;
    if (!pb || sx * sy === 0) {
      this.#clip.setAttribute('display', 'none');
      this.#image.removeAttribute('href');
      return;
    }
    this.#clip.removeAttribute('display');
    const c = this.#clipbox;
    setNumbers(this.#clip, { x: c.left(), y: c.top(), width: c.width(), height: c.height() });
    // Coordinates in the nested svg are relative to its x and y.
    setNumbers(this.#image, {
      x: this.#origin.x - c.left(),
      y: this.#origin.y - c.top(),
      width: pb.width() * sx,
      height: pb.height() * sy,
    });
    if (this.#image.getAttribute('href') !== pb.href) this.#image.setAttribute('href', pb.href);
  }
}

function setNumbers(el: Element, values: Record<string, number>): void {
  for (const [name, value] of Object.entries(values)) el.setAttribute(name, String(value));
}
