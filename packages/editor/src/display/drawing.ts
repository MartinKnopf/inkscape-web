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
import type { SvgDrawingItem } from './drawing-item.ts';
import { DrawingPaintServers } from './drawing-paintserver.ts';
import { SvgDrawingShape } from './drawing-shape.ts';
import { DrawingFilters } from './nr-filter.ts';

let drawingCount = 0;

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
