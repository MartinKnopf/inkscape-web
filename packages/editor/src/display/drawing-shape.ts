// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-shape.cpp, src/display/drawing-shape.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import type { DrawingShape } from '@inkscape-web/core';
import { type PathVector, write_svg_path } from '@inkscape-web/geom';
import { SvgDrawingItem } from './drawing-item.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Shape display item, an svg:path element (upstream DrawingShape). */
export class SvgDrawingShape extends SvgDrawingItem implements DrawingShape {
  constructor(doc: Document) {
    super(doc.createElementNS(SVG_NS, 'path') as SVGElement);
  }

  setPath(path: PathVector | null): void {
    this.setAttribute('d', path ? write_svg_path(path) : null);
  }
}
