// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/nr-filter.cpp, src/display/nr-filter.h
/*
 * SVG filters rendering
 *
 * Author:
 *   Niko Kiirala <niko@kiirala.com>
 *
 * Copyright (C) 2006-2008 Niko Kiirala
 */
import type { Node, SPFilter } from '@inkscape-web/core';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Mirror {
  element: SVGFilterElement;
  disconnect: () => void;
}

/** Attributes of the document that the mirror does not copy: ids and editor data. */
function skipAttribute(name: string): boolean {
  return name === 'id' || name.startsWith('inkscape:') || name.startsWith('sodipodi:');
}

/**
 * The filters of one Drawing, as svg:filter elements in the <defs> of the drawing (upstream
 * Inkscape::Filters::Filter, which renders the primitives with Cairo). The browser renders the
 * filter: the mirror is a copy of the svg:filter of the document, with the primitives as they are
 * (feGaussianBlur, feBlend, feOffset, ...). It follows the changes of the filter (modified signal)
 * until the filter is released. Filter region and units are copied, so the browser computes the
 * same region as upstream (default -10%/120% of the bounding box).
 * TODO: filters that reference other filters (href), feImage of document elements,
 * the BackgroundImage input (enable-background), filterRes.
 */
export class DrawingFilters {
  readonly #defs: SVGDefsElement;
  readonly #prefix: string;
  readonly #mirrors = new Map<SPFilter, Mirror>();
  #counter = 0;

  constructor(defs: SVGDefsElement, prefix: string) {
    this.#defs = defs;
    this.#prefix = prefix;
  }

  /** The CSS url() of the mirror of filter; the first request creates the mirror. */
  url(filter: SPFilter): string {
    let mirror = this.#mirrors.get(filter);
    if (!mirror) {
      const element = this.#defs.ownerDocument.createElementNS(SVG_NS, 'filter') as SVGFilterElement;
      element.id = `${this.#prefix}${++this.#counter}`;
      this.#defs.append(element);
      const offModified = filter.modifiedSignal.connect(() => this.#render(filter, element));
      const offRelease = filter.releaseSignal.connect(() => this.#remove(filter));
      mirror = {
        element,
        disconnect: () => {
          offModified();
          offRelease();
        },
      };
      this.#mirrors.set(filter, mirror);
      this.#render(filter, element);
    }
    return `url(#${mirror.element.id})`;
  }

  /** Remove all mirrors (when the drawing is no longer used). */
  clear(): void {
    for (const filter of [...this.#mirrors.keys()]) this.#remove(filter);
  }

  #remove(filter: SPFilter): void {
    const mirror = this.#mirrors.get(filter);
    if (!mirror) return;
    mirror.disconnect();
    mirror.element.remove();
    this.#mirrors.delete(filter);
  }

  /** Copy the attributes and the primitives of the filter to element. */
  #render(filter: SPFilter, element: SVGFilterElement): void {
    const repr = filter.getRepr();
    for (const name of element.getAttributeNames()) if (name !== 'id') element.removeAttribute(name);
    for (const [key, value] of repr.attributeList()) {
      if (!skipAttribute(key) && key !== 'href' && key !== 'xlink:href') element.setAttribute(key, value);
    }
    element.replaceChildren(...copyChildren(repr, element.ownerDocument));
  }
}

/** SVG DOM copies of the svg: element children of repr. */
function copyChildren(repr: Node, doc: Document): Element[] {
  const result: Element[] = [];
  for (let child = repr.firstChild(); child; child = child.next()) {
    if (child.type() !== 'element' || !child.name().startsWith('svg:')) continue;
    const el = doc.createElementNS(SVG_NS, child.name().slice(4));
    for (const [key, value] of child.attributeList()) {
      if (skipAttribute(key)) continue;
      if (key === 'xlink:href') el.setAttribute('href', value);
      else el.setAttribute(key, value);
    }
    el.append(...copyChildren(child, doc));
    result.push(el);
  }
  return result;
}
