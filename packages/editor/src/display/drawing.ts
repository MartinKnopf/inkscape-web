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
import { SvgDrawingShape } from './drawing-shape.ts';

/**
 * Display tree backed by the browser's SVG engine (upstream Drawing). Upstream
 * renders with Cairo; here the caller inserts `root.element` into an svg
 * element and the browser renders it.
 */
export class SvgDrawing implements Drawing {
  readonly root: SvgDrawingGroup;
  readonly #doc: Document;

  constructor(doc: Document) {
    this.#doc = doc;
    this.root = new SvgDrawingGroup(doc);
    // The browser loads the images that are no data: URIs (blob:, http:).
    Pixbuf.urlLoader ??= (url) => loadImageSize(doc, url);
  }

  createGroup(): SvgDrawingGroup {
    return new SvgDrawingGroup(this.#doc);
  }

  createShape(): SvgDrawingShape {
    return new SvgDrawingShape(this.#doc);
  }
  createImage(): SvgDrawingImage {
    return new SvgDrawingImage(this.#doc);
  }
}

/** The pixel size of the image at url, loaded by the browser. */
function loadImageSize(doc: Document, url: string): Promise<{ width: number; height: number }> {
  const img = doc.createElement('img');
  img.src = url;
  return img.decode().then(() => ({ width: img.naturalWidth, height: img.naturalHeight }));
}
