// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/control/canvas-item.cpp, src/display/control/canvas-item.h, src/display/control/canvas-item-group.cpp, src/display/control/canvas-item-group.h
/*
 * Abstract base class for on-canvas control items.
 *
 * Author:
 *   Tavmjong Bah
 *
 * Copyright (C) 2020 Tavmjong Bah
 *
 * Rewrite of SPCanvasItem
 */
import type { Affine } from '@inkscape-web/geom';
import type { Canvas } from '../../ui/widget/canvas.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A group of canvas items in the controls layer of a canvas (upstream
 * CanvasItemGroup). Its element is in world coordinates; the items redraw
 * when the canvas affine (zoom) changes.
 */
export class CanvasItemGroup {
  readonly element: SVGGElement;
  readonly canvas: Canvas;
  readonly #items = new Set<CanvasItem>();
  readonly #disconnect: () => void;

  constructor(element: SVGGElement, canvas: Canvas) {
    this.element = element;
    this.canvas = canvas;
    this.#disconnect = canvas.connectAffine(() => this.update());
  }

  /** Redraw all items with the current canvas affine. */
  update(): void {
    for (const item of this.#items) item.request_update();
  }

  add(item: CanvasItem): void {
    this.#items.add(item);
  }

  remove(item: CanvasItem): void {
    this.#items.delete(item);
  }

  destroy(): void {
    this.#disconnect();
    for (const item of [...this.#items]) item.unlink();
  }
}

/**
 * Base class of control items (handles, rubberband, selection cues) drawn
 * over the drawing (upstream CanvasItem). Upstream renders with Cairo; here
 * each item owns an SVG g element in world coordinates, and _update() writes
 * its content for the desktop to world transform.
 */
export abstract class CanvasItem {
  readonly element: SVGGElement;
  protected readonly _parent: CanvasItemGroup;
  #visible = true;

  constructor(group: CanvasItemGroup, name: string) {
    this._parent = group;
    this.element = group.element.ownerDocument.createElementNS(SVG_NS, 'g') as SVGGElement;
    this.element.setAttribute('class', name);
    // Most items are just for display and are not pickable!
    this.set_pickable(false);
    group.element.append(this.element);
    group.add(this);
  }

  /** The desktop to world transform. */
  affine(): Affine {
    return this._parent.canvas.get_affine();
  }

  /** Redraw with the current affine. Subclasses call it after a property changes. */
  request_update(): void {
    if (this.#visible) this._update(this.affine());
  }

  protected abstract _update(affine: Affine): void;

  is_visible(): boolean {
    return this.#visible;
  }

  set_visible(visible: boolean): void {
    if (this.#visible === visible) return;
    this.#visible = visible;
    // visibility instead of display: a hidden knot keeps its pointer capture while it is dragged.
    if (visible) this.element.removeAttribute('visibility');
    else this.element.setAttribute('visibility', 'hidden');
    this.request_update();
  }

  /** Whether the item receives pointer events. */
  set_pickable(pickable: boolean): void {
    if (pickable) this.element.removeAttribute('pointer-events');
    else this.element.setAttribute('pointer-events', 'none');
  }

  /** Move below the other items of the group. */
  lower_to_bottom(): void {
    this._parent.element.prepend(this.element);
  }

  /** Remove from the canvas. */
  unlink(): void {
    this.element.remove();
    this._parent.remove(this);
  }

  /** Create an SVG child element of this item. */
  protected _createElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
    const element = this.element.ownerDocument.createElementNS(SVG_NS, name);
    this.element.append(element);
    return element;
  }
}
