// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-item.cpp, src/display/drawing-item.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import {
  type DrawingItem,
  enum_blend_mode,
  type SPFilter,
  type SPItem,
  SPPaintOrigin,
  type SPStyle,
} from '@inkscape-web/core';
import type { Affine, OptRect } from '@inkscape-web/geom';
import type { SvgDrawing } from './drawing.ts';
import type { DrawingPaintServers } from './drawing-paintserver.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
 *
 * Clips, masks and filters (upstream: rendered per item) are SVG resources in the <defs> of the
 * drawing: setClip() turns the clip group into an svg:clipPath there, setMask() puts the mask
 * group into an svg:mask there, setFilterRenderer() mirrors the svg:filter (DrawingFilters). The
 * element references them with clip-path, mask and filter.
 */
export abstract class SvgDrawingItem implements DrawingItem {
  #element: SVGElement;
  #key = 0;
  #item: SPItem | null = null;
  #itemBounds: OptRect = null;
  #appliedStyle: string[] = [];
  #style: SPStyle | null = null;
  #contextStyle: SPStyle | null = null;
  #clip: SvgDrawingItem | null = null;
  #mask: SvgDrawingItem | null = null;
  /** The svg:mask that holds the element of the mask group. */
  #maskElement: SVGElement | null = null;
  /** The svg:mask that holds the element of the clip group, if the clip has groups. */
  #clipMaskElement: SVGElement | null = null;
  /** The paint servers of the drawing, for url() paints; set by SvgDrawing when it creates the item. */
  _paintServers: DrawingPaintServers | null = null;
  /** The drawing that created the item (its defs hold clips, masks and filters); set by SvgDrawing. */
  _drawing: SvgDrawing | null = null;

  protected constructor(element: SVGElement) {
    this.#element = element;
    items.set(element, this);
  }

  /** The outer element of the item (it can change, see _replaceElement). */
  get element(): SVGElement {
    return this.#element;
  }

  /** The element that gets the paint properties (fill, stroke, ...); the outer element by default. */
  protected styleElement(): SVGElement {
    return this.#element;
  }

  /**
   * Replace the outer element by next, at the same place in the DOM. move() moves the content
   * (children, attributes) that belongs to next.
   */
  protected _replaceElement(next: SVGElement, move: (old: SVGElement, next: SVGElement) => void): void {
    const old = this.#element;
    old.parentNode?.replaceChild(next, old);
    move(old, next);
    this.#element = next;
    items.set(next, this);
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

  /** Number of elements before the child items in the element (the path of a shape with markers). */
  _childOffset(): number {
    return 0;
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
    const offset = parent instanceof Element ? (items.get(parent)?._childOffset() ?? 0) : 0;
    parent.insertBefore(this.element, parent.children[z + offset] ?? null);
  }

  /**
   * Use the item (a group) as clip path: its element becomes an svg:clipPath in the defs of
   * the drawing. The browser ignores svg:g in svg:clipPath, so a clip with groups or clones goes
   * into an svg:mask instead, where a style sheet of the drawing paints all content opaque white
   * (the clip then does not limit picking).
   * TODO: clip-rule in the mask form; content added to the clip later keeps the form.
   */
  setClip(item: DrawingItem | null): void {
    if (this.#clip === item) return;
    this.#clipMaskElement?.remove();
    this.#clipMaskElement = null;
    this.#clip = item ? asSvg(item) : null;
    const clip = this.#clip;
    if (!clip || !this._drawing) {
      this.setAttribute('clip-path', null);
      this.#applyMasks();
      return;
    }
    if ([...clip.element.children].some((c) => c.localName === 'g')) {
      const mask = this._drawing.createMaskElement('clip', CLIP_MASK_CLASS);
      mask.append(clip.element);
      this.#clipMaskElement = mask;
      this.setAttribute('clip-path', null);
      this.#applyMasks();
      return;
    }
    const id = this._drawing.uniqueId('clip');
    const doc = this.element.ownerDocument;
    clip._replaceElement(doc.createElementNS(SVG_NS, 'clipPath') as SVGElement, (old, next) => {
      next.append(...old.childNodes);
      const transform = old.getAttribute('transform');
      if (transform) next.setAttribute('transform', transform);
    });
    clip.element.id = id;
    clip.element.setAttribute('clipPathUnits', 'userSpaceOnUse');
    this._drawing.defs.append(clip.element);
    this.setAttribute('clip-path', `url(#${id})`);
  }

  /** The mask attribute: the mask, the clip in mask form, or both (the clip masks the mask). */
  #applyMasks(): void {
    const clipMask = this.#clipMaskElement;
    const mask = this.#maskElement;
    // An element has one mask: with both, the svg:mask of the item is masked by the clip.
    if (clipMask && mask) mask.setAttribute('mask', `url(#${clipMask.id})`);
    else mask?.removeAttribute('mask');
    const id = mask?.id ?? clipMask?.id;
    this.setAttribute('mask', id ? `url(#${id})` : null);
  }

  /**
   * Use the item (a group) as mask: its element goes into an svg:mask in the defs of the
   * drawing. Like upstream, the mask has no region: the svg:mask covers a large area.
   */
  setMask(item: DrawingItem | null): void {
    if (this.#mask === item) return;
    this.#maskElement?.remove();
    this.#maskElement = null;
    this.#mask = item ? asSvg(item) : null;
    if (this.#mask && this._drawing) {
      this.#maskElement = this._drawing.createMaskElement('mask', null);
      this.#maskElement.append(this.#mask.element);
    }
    this.#applyMasks();
  }

  /** Filter the element with the mirror of filter in the drawing (see DrawingFilters). */
  setFilterRenderer(filter: SPFilter | null): void {
    const url = filter && this._drawing ? this._drawing.filters.url(filter) : null;
    if (url) this.element.style.setProperty('filter', url);
    else this.element.style.removeProperty('filter');
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
   * context-fill and context-stroke take the fill or stroke of contextStyle (markers).
   */
  setStyle(style: SPStyle | null, contextStyle: SPStyle | null = null): void {
    this.#style = style;
    this.#contextStyle = contextStyle;
    const element = this.styleElement();
    for (const name of this.#appliedStyle) element.style.removeProperty(name);
    this.#appliedStyle = [];
    if (!style) return;
    for (const declaration of this._styleText(style).split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim();
      if (!STYLE_PROPERTIES.has(name)) continue;
      let value = declaration.slice(colon + 1).trim();
      if (name === 'fill' || name === 'stroke') value = this.#paintValue(style, name, value, contextStyle);
      element.style.setProperty(name, value);
      this.#appliedStyle.push(name);
    }
  }

  /** Resolve context-fill and context-stroke in this item and its children with contextStyle. */
  setChildrenStyle(contextStyle: SPStyle | null): void {
    for (const child of this.element.children) {
      const item = items.get(child);
      if (item && item !== this) item.setChildrenStyle(contextStyle);
    }
    if (contextStyle !== this.#contextStyle) this.setStyle(this.#style, contextStyle);
  }

  /** The CSS value of the fill or stroke of style: url() mapped to the mirror, context paints resolved. */
  #paintValue(style: SPStyle, name: 'fill' | 'stroke', value: string, contextStyle: SPStyle | null): string {
    const paint = name === 'fill' ? style.fill : style.stroke;
    if (
      paint.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_FILL ||
      paint.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_STROKE
    ) {
      if (!contextStyle) return 'none';
      const from = paint.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_FILL ? 'fill' : 'stroke';
      const contextPaint = from === 'fill' ? contextStyle.fill : contextStyle.stroke;
      // A context paint of the context itself has nothing to resolve to.
      if (contextPaint.paintOrigin !== SPPaintOrigin.SP_CSS_PAINT_ORIGIN_NORMAL) return 'none';
      return this.#paintValue(contextStyle, from, contextPaint.getValue() || 'black', null);
    }
    return value.startsWith('url(') ? this.#paintUrl(style, name, value) : value;
  }

  /** The CSS text that setStyle() copies from; text items use the complete cascaded style. */
  protected _styleText(style: SPStyle): string {
    return style.write();
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
    this.setClip(null);
    this.setMask(null);
    this.element.remove();
    items.delete(this.element);
  }

  protected setAttribute(name: string, value: string | null): void {
    if (value === null) this.element.removeAttribute(name);
    else this.element.setAttribute(name, value);
  }
}

/** The class of the svg:mask of a clip with groups (see setClip and SvgDrawing.createMaskElement). */
export const CLIP_MASK_CLASS = 'inkscape-clip-mask';

function asSvg(item: DrawingItem): SvgDrawingItem {
  if (!(item instanceof SvgDrawingItem)) throw new Error('DrawingItem is not an SvgDrawingItem');
  return item;
}
