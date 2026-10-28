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

let drawingCount = 0;

/**
 * Display tree backed by the browser's SVG engine (upstream Drawing). Upstream
 * renders with Cairo; here the caller inserts `defs` (the paint servers, see
 * DrawingPaintServers) and `root.element` into an svg element and the browser
 * renders them.
 */
export class SvgDrawing implements Drawing {
  readonly root: SvgDrawingGroup;
  /** The paint servers used by the items; `paintServers.defs` goes beside the root. */
  readonly paintServers: DrawingPaintServers;
  readonly #doc: Document;

  constructor(doc: Document) {
    this.#doc = doc;
    // Unique per drawing: several drawings in one HTML document must not share ids.
    this.paintServers = new DrawingPaintServers(doc, `drawing${++drawingCount}-ps`);
    this.root = this.#own(new SvgDrawingGroup(doc));
    // The browser loads the images that are no data: URIs (blob:, http:).
    Pixbuf.urlLoader ??= (url) => loadImageSize(doc, url);
  }

  /** The <defs> with the paint servers. */
  get defs(): SVGDefsElement {
    return this.paintServers.defs;
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

  /** Let item resolve url() paints with the paint servers of this drawing. */
  #own<T extends SvgDrawingItem>(item: T): T {
    item._paintServers = this.paintServers;
    return item;
  }
}

/** The pixel size of the image at url, loaded by the browser. */
function loadImageSize(doc: Document, url: string): Promise<{ width: number; height: number }> {
  const img = doc.createElement('img');
  img.src = url;
  return img.decode().then(() => ({ width: img.naturalWidth, height: img.naturalHeight }));
}
