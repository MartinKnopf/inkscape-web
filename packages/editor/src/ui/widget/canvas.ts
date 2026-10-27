// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/canvas.cpp, src/ui/widget/canvas.h
/*
 * Authors:
 *   Tavmjong Bah
 *   PBS <pbs3141@gmail.com>
 *
 * Copyright (C) 2022 Authors
 */
import { Signal } from '@inkscape-web/core';
import { Affine, Point, Rect, Translate } from '@inkscape-web/geom';
import { matrixString } from '../../display/drawing-item.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The canvas widget: an svg element in a host element (upstream Canvas, a
 * GTK widget that renders with Cairo). The browser renders the content.
 *
 * Coordinates as upstream: desktop → world by the affine (d2w, zoom), world →
 * window by subtracting the position (scroll). The element tree is:
 *
 *     svg                     window coordinates, desk color as background
 *       g                     world: translate(-pos)
 *         g                   desktop: the affine
 *           <desktop groups>  pages, drawing (see desktopLayer)
 *         g                   controls, in world coordinates (see controlsLayer)
 */
export class Canvas {
  readonly host: HTMLElement;
  readonly svg: SVGSVGElement;
  /** Content in desktop coordinates (pages, drawing). */
  readonly desktopLayer: SVGGElement;
  /** Content in world coordinates (handles, rubberband; empty for now). */
  readonly controlsLayer: SVGGElement;
  readonly #world: SVGGElement;
  #pos = new Point(0, 0);
  #affine = Affine.identity();
  readonly #signalResize = new Signal<[]>();
  readonly #resizeObserver: ResizeObserver | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    const doc = host.ownerDocument;
    this.svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('class', 'canvas');
    this.svg.style.display = 'block';
    this.svg.style.width = '100%';
    this.svg.style.height = '100%';
    this.svg.style.outline = 'none';
    // Takes the keyboard focus when clicked (upstream set_focusable).
    this.svg.setAttribute('tabindex', '0');
    this.#world = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
    this.desktopLayer = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
    this.controlsLayer = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
    this.#world.append(this.desktopLayer, this.controlsLayer);
    this.svg.append(this.#world);
    host.append(this.svg);

    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(() => this.#signalResize.emit());
      this.#resizeObserver.observe(host);
    }
  }

  /** Remove the svg element from the host. */
  destroy(): void {
    this.#resizeObserver?.disconnect();
    this.svg.remove();
  }

  /** Scroll so that world point pos is at the top left corner of the window. Rounds like upstream. */
  set_pos(pos: Point): void {
    const p = new Point(Math.round(pos.x), Math.round(pos.y));
    if (p.equals(this.#pos)) return;
    this.#pos = p;
    this.#update();
  }
  get_pos(): Point {
    return this.#pos;
  }

  /** Set the desktop to world transform (zoom, rotation, flip). */
  set_affine(affine: Affine): void {
    if (affine.equals(this.#affine)) return;
    this.#affine = affine;
    this.#update();
  }
  get_affine(): Affine {
    return this.#affine;
  }

  /** Set the desk (background) color, 0xRRGGBBAA. */
  set_desk(rgba: number): void {
    this.svg.style.background = rgbaCss(rgba);
  }

  /** Window size in px. */
  get_dimensions(): Point {
    return new Point(this.host.clientWidth, this.host.clientHeight);
  }

  /** The visible area in world coordinates. */
  get_area_world(): Rect {
    return new Rect(this.#pos, this.#pos.add(this.get_dimensions()));
  }

  /** Window (pointer offset) to world coordinates. */
  canvas_to_world(window: Point): Point {
    return window.add(this.#pos);
  }

  /** Called when the window size changes. Returns the disconnect function. */
  connectResize(slot: () => void): () => void {
    return this.#signalResize.connect(slot);
  }

  #update(): void {
    setTransform(this.#world, Translate(this.#pos.neg()));
    setTransform(this.desktopLayer, this.#affine);
  }
}

function setTransform(element: SVGElement, m: Affine): void {
  const s = matrixString(m);
  if (s) element.setAttribute('transform', s);
  else element.removeAttribute('transform');
}

/** CSS color for 0xRRGGBBAA. */
export function rgbaCss(rgba: number): string {
  const c = (shift: number) => (rgba >>> shift) & 0xff;
  return `rgba(${c(24)},${c(16)},${c(8)},${+(c(0) / 255).toFixed(3)})`;
}
