// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-shape.cpp, src/display/drawing-shape.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import type { DrawingItem, DrawingShape } from '@inkscape-web/core';
import { type PathVector, write_svg_path } from '@inkscape-web/geom';
import { SvgDrawingItem } from './drawing-item.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Attributes that stay on the svg:path when the shape gets a wrapper group. */
const PATH_ATTRIBUTES = new Set(['d', 'shape-rendering', 'style']);
/** Style properties that move from the svg:path to the wrapper group. */
const GROUP_STYLE_PROPERTIES = ['filter', 'mix-blend-mode', 'isolation'];

/**
 * Shape display item, an svg:path element (upstream DrawingShape). The children of a shape
 * are its markers; an svg:path cannot have children, so the first child replaces the element
 * by an svg:g that holds the path and the markers. The paint properties stay on the path; the
 * transform, opacity, clip, mask and filter go to the group.
 * TODO: markers inherit the style of the parent of the shape, not of the marker's ancestors.
 */
export class SvgDrawingShape extends SvgDrawingItem implements DrawingShape {
  readonly #path: SVGElement;

  constructor(doc: Document) {
    const path = doc.createElementNS(SVG_NS, 'path') as SVGElement;
    super(path);
    this.#path = path;
  }

  setPath(path: PathVector | null): void {
    const d = path ? write_svg_path(path) : null;
    if (d === null) this.#path.removeAttribute('d');
    else this.#path.setAttribute('d', d);
  }

  override setAntialiasing(antialias: boolean): void {
    if (antialias) this.#path.removeAttribute('shape-rendering');
    else this.#path.setAttribute('shape-rendering', 'crispEdges');
  }

  protected override styleElement(): SVGElement {
    return this.#path;
  }

  override appendChild(child: DrawingItem): void {
    this.#ensureGroup();
    super.appendChild(child);
  }

  override prependChild(child: DrawingItem): void {
    this.#ensureGroup();
    // The path stays the first child.
    this.element.insertBefore((child as SvgDrawingItem).element, this.#path.nextSibling);
  }

  /** The path comes before the markers. */
  override _childOffset(): number {
    return this.element === this.#path ? 0 : 1;
  }

  /** Remove the markers; the path stays. */
  override clearChildren(): void {
    for (const child of [...this.element.children]) if (child !== this.#path) child.remove();
  }

  /** Wrap the path in an svg:g, for the markers. */
  #ensureGroup(): void {
    if (this.element !== this.#path) return;
    const g = this.#path.ownerDocument.createElementNS(SVG_NS, 'g') as SVGElement;
    this._replaceElement(g, (path, group) => {
      for (const name of path.getAttributeNames()) {
        if (PATH_ATTRIBUTES.has(name)) continue;
        group.setAttribute(name, path.getAttribute(name) ?? '');
        path.removeAttribute(name);
      }
      for (const name of GROUP_STYLE_PROPERTIES) {
        const value = path.style.getPropertyValue(name);
        if (!value) continue;
        group.style.setProperty(name, value);
        path.style.removeProperty(name);
      }
      group.append(path);
    });
  }
}
