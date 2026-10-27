// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing.cpp, src/display/drawing.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import type { Drawing } from '@inkscape-web/core';
import { SvgDrawingGroup } from './drawing-group.ts';
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
  }

  createGroup(): SvgDrawingGroup {
    return new SvgDrawingGroup(this.#doc);
  }

  createShape(): SvgDrawingShape {
    return new SvgDrawingShape(this.#doc);
  }
}
