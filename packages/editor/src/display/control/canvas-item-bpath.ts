// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/control/canvas-item-bpath.cpp, src/display/control/canvas-item-bpath.h
/*
 * A class to represent a Bezier path.
 *
 * Author:
 *   Tavmjong Bah
 *
 * Copyright (C) 2020 Tavmjong Bah
 *
 * Rewrite of SPCanvasBPath
 */
import { type Affine, type PathVector, write_svg_path } from '@inkscape-web/geom';
import { rgbaCss } from '../../ui/widget/canvas.ts';
import { CanvasItem, type CanvasItemGroup } from './canvas-item.ts';

/**
 * A path in desktop coordinates, drawn with a screen-sized stroke (upstream
 * CanvasItemBpath). The pen and pencil tools draw the path in progress with it.
 * A phantom line is drawn 2 px wide.
 * TODO: dashes, outline, fill rule.
 */
export class CanvasItemBpath extends CanvasItem {
  #path: PathVector = [];
  #phantom_line = false;
  #stroke = 0x0000ff7f;
  #fill = 0x0;
  readonly #element: SVGPathElement;

  constructor(group: CanvasItemGroup, path: PathVector = [], phantom_line = false) {
    super(group, 'CanvasItemBpath');
    this.#element = this._createElement('path');
    this.#element.setAttribute('stroke-linejoin', 'round');
    this.#path = path.map((p) => p.clone());
    this.#phantom_line = phantom_line;
    this.request_update();
  }

  /** Set the path, in desktop coordinates. */
  set_bpath(path: PathVector, phantom_line = false): void {
    this.#path = path.map((p) => p.clone());
    this.#phantom_line = phantom_line;
    this.request_update();
  }

  set_stroke(rgba: number): void {
    this.#stroke = rgba;
    this.request_update();
  }

  set_fill(rgba: number): void {
    this.#fill = rgba;
    this.request_update();
  }

  protected _update(affine: Affine): void {
    const world = this.#path.map((p) => p.transformed(affine));
    this.#element.setAttribute('d', world.length ? write_svg_path(world) : '');
    this.#element.setAttribute('stroke', rgbaCss(this.#stroke));
    this.#element.setAttribute('stroke-width', this.#phantom_line ? '2' : '1');
    this.#element.setAttribute('fill', (this.#fill & 0xff) > 0 ? rgbaCss(this.#fill) : 'none');
  }
}
