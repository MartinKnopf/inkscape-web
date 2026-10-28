// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-item.cpp, src/display/drawing-item.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import { type DrawingItem, enum_blend_mode, type SPItem, type SPStyle } from '@inkscape-web/core';
import type { Affine, OptRect } from '@inkscape-web/geom';
import type { DrawingPaintServers } from './drawing-paintserver.ts';

/** CSS properties that setStyle() copies from the SPStyle to the element. */
const STYLE_PROPERTIES = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'paint-order',
  'vector-effect',
]);

const items = new WeakMap<Element, SvgDrawingItem>();

/** SVG matrix() text of a transform; null for the identity. */
export function matrixString(m: Affine): string | null {
  if (m.c0 === 1 && m.c1 === 0 && m.c2 === 0 && m.c3 === 1 && m.c4 === 0 && m.c5 === 0) return null;
  return `matrix(${m.c0},${m.c1},${m.c2},${m.c3},${m.c4},${m.c5})`;
}

/**
 * Display item backed by an SVG element (upstream DrawingItem). Upstream
 * renders the tree with Cairo; here the browser renders the element tree, so
 * every setter maps to an attribute or style property of the element.
 */
export abstract class SvgDrawingItem implements DrawingItem {
  readonly element: SVGElement;
  #key = 0;
  #item: SPItem | null = null;
  #itemBounds: OptRect = null;
  #appliedStyle: string[] = [];
  /** The paint servers of the drawing, for url() paints; set by SvgDrawing when it creates the item. */
  _paintServers: DrawingPaintServers | null = null;

  protected constructor(element: SVGElement) {
    this.element = element;
    items.set(element, this);
  }

  /** The display item that owns an element or one of its ancestors, for picking. */
  static itemFromElement(el: Element | null): SvgDrawingItem | null {
    for (let e = el; e; e = e.parentElement) {
      const found = items.get(e);
      if (found) return found;
    }
    return null;
  }

  key(): number {
    return this.#key;
  }

  setKey(key: number): void {
    this.#key = key;
  }

  /** The item this view shows. */
  item(): SPItem | null {
    return this.#item;
  }

  setItem(item: SPItem | null): void {
    this.#item = item;
  }

  /** Stored only; the browser does the hit testing. */
  itemBounds(): OptRect {
    return this.#itemBounds;
  }

  setItemBounds(bounds: OptRect): void {
    this.#itemBounds = bounds;
  }

  appendChild(child: DrawingItem): void {
    this.element.appendChild(asSvg(child).element);
  }

  prependChild(child: DrawingItem): void {
    this.element.insertBefore(asSvg(child).element, this.element.firstChild);
  }

  /** Remove all children from the tree. */
  clearChildren(): void {
    this.element.replaceChildren();
  }

  /** Move to position z among the siblings. */
  setZOrder(z: number): void {
    const parent = this.element.parentNode;
    if (!parent) return;
    this.element.remove();
    parent.insertBefore(this.element, parent.children[z] ?? null);
  }

  setTransform(transform: Affine): void {
    this.setAttribute('transform', matrixString(transform));
  }

  setOpacity(opacity: number): void {
    this.setAttribute('opacity', opacity === 1 ? null : String(opacity));
  }

  setVisible(visible: boolean): void {
    this.setAttribute('display', visible ? null : 'none');
  }

  setSensitive(sensitive: boolean): void {
    this.setAttribute('pointer-events', sensitive ? null : 'none');
  }

  setIsolation(isolate: boolean): void {
    this.element.style.setProperty('isolation', isolate ? 'isolate' : 'auto');
  }

  /** mode is an SPBlendMode; the keys of enum_blend_mode are the CSS names. */
  setBlendMode(mode: number): void {
    const name = enum_blend_mode.find((e) => e.value === mode)?.key ?? 'normal';
    this.element.style.setProperty('mix-blend-mode', name);
  }

  setAntialiasing(antialias: boolean): void {
    this.setAttribute('shape-rendering', antialias ? null : 'crispEdges');
  }

  /**
   * Copy the paint-related properties of the style to the element's style.
   * The CSS text comes from SPStyle.write(). A url() paint is mapped to the
   * mirror of its paint server in the drawing's <defs> (see DrawingPaintServers);
   * without a server that can be drawn, the fallback color (or none) is used.
   * TODO: contextStyle for context-fill and context-stroke.
   */
  setStyle(style: SPStyle | null, _contextStyle?: SPStyle | null): void {
    for (const name of this.#appliedStyle) this.element.style.removeProperty(name);
    this.#appliedStyle = [];
    if (!style) return;
    for (const declaration of style.write().split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim();
      if (!STYLE_PROPERTIES.has(name)) continue;
      let value = declaration.slice(colon + 1).trim();
      if ((name === 'fill' || name === 'stroke') && value.startsWith('url('))
        value = this.#paintUrl(style, name, value);
      this.element.style.setProperty(name, value);
      this.#appliedStyle.push(name);
    }
  }

  /** The CSS value of a url() fill or stroke: the mirrored paint server, else the fallback. */
  #paintUrl(style: SPStyle, name: 'fill' | 'stroke', value: string): string {
    const server = name === 'fill' ? style.getFillPaintServer() : style.getStrokePaintServer();
    const url = server && this._paintServers?.url(server);
    if (url) return url;
    const fallback = value.slice(value.indexOf(')') + 1).trim();
    return fallback || 'none';
  }

  /** Remove from the parent and release. */
  unlink(): void {
    this.element.remove();
    items.delete(this.element);
  }

  protected setAttribute(name: string, value: string | null): void {
    if (value === null) this.element.removeAttribute(name);
    else this.element.setAttribute(name, value);
  }
}

function asSvg(item: DrawingItem): SvgDrawingItem {
  if (!(item instanceof SvgDrawingItem)) throw new Error('DrawingItem is not an SvgDrawingItem');
  return item;
}
