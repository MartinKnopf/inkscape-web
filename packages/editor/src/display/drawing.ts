// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing.cpp, src/display/drawing.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import { type Drawing, Pixbuf } from '@inkscape-web/core';
import { SvgDrawingGroup } from './drawing-group.ts';
import { SvgDrawingImage } from './drawing-image.ts';
import { CLIP_MASK_CLASS, type SvgDrawingItem } from './drawing-item.ts';
import { DrawingPaintServers } from './drawing-paintserver.ts';
import { SvgDrawingShape } from './drawing-shape.ts';
import { DrawingFilters } from './nr-filter.ts';
import { SvgDrawingText } from './drawing-text.ts';

let drawingCount = 0;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The region of the svg:mask elements, in user space: large enough to not cut the mask. */
const MASK_REGION = { maskUnits: 'userSpaceOnUse', x: '-1e5', y: '-1e5', width: '2e5', height: '2e5' };

/** Paint the content of a clip in mask form opaque white: only the geometry counts, as in a clip. */
const CLIP_MASK_CSS =
  `.${CLIP_MASK_CLASS} * { fill: #fff !important; fill-opacity: 1 !important; stroke: none !important;` +
  ' opacity: 1 !important; filter: none !important; mix-blend-mode: normal !important; }';

/**
 * Display tree backed by the browser's SVG engine (upstream Drawing). Upstream
 * renders with Cairo; here the caller inserts `defs` (the paint servers, see
 * DrawingPaintServers, the filters, see DrawingFilters, and the clip paths and
 * masks of the items) and `root.element` into an svg element and the browser
 * renders them.
 */
export class SvgDrawing implements Drawing {
  readonly root: SvgDrawingGroup;
  /** The paint servers used by the items; `paintServers.defs` goes beside the root. */
  readonly paintServers: DrawingPaintServers;
  /** The filters used by the items, in the same defs. */
  readonly filters: DrawingFilters;
  readonly #doc: Document;
  /** Unique per drawing: several drawings in one HTML document must not share ids. */
  readonly #prefix: string;
  #idCounter = 0;
  #clipMaskStyle: SVGStyleElement | null = null;

  constructor(doc: Document) {
    this.#doc = doc;
    this.#prefix = `drawing${++drawingCount}`;
    this.paintServers = new DrawingPaintServers(doc, `${this.#prefix}-ps`);
    this.filters = new DrawingFilters(this.paintServers.defs, `${this.#prefix}-filter`);
    this.root = this.#own(new SvgDrawingGroup(doc));
    // The browser loads the images that are no data: URIs (blob:, http:).
    Pixbuf.urlLoader ??= (url) => loadImageSize(doc, url);
  }

  /** The <defs> with the paint servers, filters, clip paths and masks. */
  get defs(): SVGDefsElement {
    return this.paintServers.defs;
  }

  /**
   * A new svg:mask in the defs, for DrawingItem.setMask() and setClip(). Like upstream, masks
   * have no region: the svg:mask covers a large area. With className CLIP_MASK_CLASS, a style
   * sheet paints its content opaque white, so that it works as a clip path.
   */
  createMaskElement(kind: string, className: string | null): SVGElement {
    const mask = this.#doc.createElementNS(SVG_NS, 'mask') as SVGElement;
    mask.id = this.uniqueId(kind);
    for (const [name, value] of Object.entries(MASK_REGION)) mask.setAttribute(name, value);
    if (className) {
      mask.setAttribute('class', className);
      if (!this.#clipMaskStyle) {
        this.#clipMaskStyle = this.#doc.createElementNS(SVG_NS, 'style') as SVGStyleElement;
        this.#clipMaskStyle.textContent = CLIP_MASK_CSS;
        this.defs.prepend(this.#clipMaskStyle);
      }
    }
    this.defs.append(mask);
    return mask;
  }

  /** A new element id for the defs, e.g. "drawing1-clip3". */
  uniqueId(kind: string): string {
    return `${this.#prefix}-${kind}${++this.#idCounter}`;
  }

  createGroup(): SvgDrawingGroup {
    return this.#own(new SvgDrawingGroup(this.#doc));
  }

  createShape(): SvgDrawingShape {
    return this.#own(new SvgDrawingShape(this.#doc));
  }

  createImage(): SvgDrawingImage {
    return this.#own(new SvgDrawingImage(this.#doc));
  }

  createText(): SvgDrawingText {
    return this.#own(new SvgDrawingText(this.#doc));
  }

  /** Let item resolve url() paints with the paint servers of this drawing and use its defs. */
  #own<T extends SvgDrawingItem>(item: T): T {
    item._paintServers = this.paintServers;
    item._drawing = this;
    return item;
  }
}

/** The pixel size of the image at url, loaded by the browser. */
function loadImageSize(doc: Document, url: string): Promise<{ width: number; height: number }> {
  const img = doc.createElement('img');
  img.src = url;
  return img.decode().then(() => ({ width: img.naturalWidth, height: img.naturalHeight }));
}
