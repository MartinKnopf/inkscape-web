// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/control/canvas-item-grid.cpp, src/display/control/canvas-item-grid.h
/*
 * Author:
 *   Tavmjong Bah
 *
 * Copyright (C) 2020 Tavmjong Bah
 *
 * Rewrite of GridCanvasItem.
 */
import { Preferences } from '@inkscape-web/core';
import { type Affine, Point } from '@inkscape-web/geom';
import { calculate_scaling_factor } from '../../grid-snapper.ts';
import { rgbaCss } from '../../ui/widget/canvas.ts';
import { CanvasItem, type CanvasItemGroup } from './canvas-item.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
let pattern_counter = 0;

/**
 * A rectangular grid on the canvas (upstream CanvasItemGridXY): minor lines
 * (or dots) at the spacing and major lines every major_line_interval lines.
 * When zoomed out, the shown spacing grows (see calculate_scaling_factor) so
 * that lines stay at least 8 px apart. Upstream renders the lines with Cairo;
 * here one tile of the grid is an SVG pattern that fills the window.
 * TODO: axonometric and modular grids, rotated canvas.
 */
export class CanvasItemGridXY extends CanvasItem {
  #origin = new Point(0, 0);
  #spacing = new Point(1, 1);
  #minor_color = 0x0;
  #major_color = 0x0;
  #major_line_interval = 5;
  #dotted = false;
  #no_emp_when_zoomed_out = Preferences.get().getBool('/options/grids/no_emphasize_when_zoomedout');
  readonly #pattern: SVGPatternElement;
  readonly #rect: SVGRectElement;
  readonly #disconnectPos: () => void;

  constructor(group: CanvasItemGroup) {
    super(group, 'CanvasItemGridXY');
    const doc = this.element.ownerDocument;
    const defs = this._createElement('defs');
    this.#pattern = doc.createElementNS(SVG_NS, 'pattern') as SVGPatternElement;
    this.#pattern.setAttribute('id', `CanvasItemGrid${++pattern_counter}`);
    this.#pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    defs.append(this.#pattern);
    this.#rect = this._createElement('rect');
    this.#rect.setAttribute('fill', `url(#${this.#pattern.id})`);
    // The grid fills the window: redraw when it scrolls.
    this.#disconnectPos = group.canvas.connectPos(() => this.request_update());
    this.request_update();
  }

  override unlink(): void {
    this.#disconnectPos();
    super.unlink();
  }

  /** The origin in desktop coordinates. */
  set_origin(point: Point): void {
    this.#origin = point;
    this.request_update();
  }
  /** The spacing in desktop units. */
  set_spacing(point: Point): void {
    this.#spacing = point;
    this.request_update();
  }
  set_major_color(color: number): void {
    this.#major_color = color;
    this.request_update();
  }
  set_minor_color(color: number): void {
    this.#minor_color = color;
    this.request_update();
  }
  set_dotted(dotted: boolean): void {
    this.#dotted = dotted;
    this.request_update();
  }
  set_major_line_interval(n: number): void {
    if (n < 1) return;
    this.#major_line_interval = n;
    this.request_update();
  }

  protected _update(affine: Affine): void {
    const area = this._parent.canvas.get_area_world().expandBy(2);
    this.#rect.setAttribute('x', String(area.left()));
    this.#rect.setAttribute('y', String(area.top()));
    this.#rect.setAttribute('width', String(area.width()));
    this.#rect.setAttribute('height', String(area.height()));
    this.#pattern.replaceChildren();
    if (this.#spacing.x <= 0 || this.#spacing.y <= 0) return;

    const ow = this.#origin.transformed(affine);
    // Spacing in screen px; find suitable grid spacing for display
    const linear = affine.withoutTranslation();
    const sw = [
      Math.abs(new Point(this.#spacing.x, 0).transformed(linear).x),
      Math.abs(new Point(0, this.#spacing.y).transformed(linear).y),
    ];
    const scaled = [false, false];
    for (const dim of [0, 1] as const) {
      const scaling_factor = calculate_scaling_factor(sw[dim] as number, this.#major_line_interval);
      sw[dim] = (sw[dim] as number) * scaling_factor;
      scaled[dim] = scaling_factor > 1;
    }
    const [swx, swy] = sw as [number, number];
    // no_emphasize_when_zoomedout determines color (minor or major) when only major grid lines/dots shown.
    const empcolor =
      (scaled[0] || scaled[1]) && this.#no_emp_when_zoomed_out ? this.#minor_color : this.#major_color;
    // A tile holds major_line_interval lines in a dimension, or one if the lines are scaled.
    const nx = scaled[0] ? 1 : this.#major_line_interval;
    const ny = scaled[1] ? 1 : this.#major_line_interval;
    const tile_w = swx * nx;
    const tile_h = swy * ny;
    // The tile starts at a major line through the origin.
    this.#pattern.setAttribute('x', String(ow.x - 0.5));
    this.#pattern.setAttribute('y', String(ow.y - 0.5));
    this.#pattern.setAttribute('width', String(tile_w));
    this.#pattern.setAttribute('height', String(tile_h));

    const doc = this.element.ownerDocument;
    const rect = (x: number, y: number, w: number, h: number, rgba: number) => {
      const r = doc.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', String(w));
      r.setAttribute('height', String(h));
      r.setAttribute('fill', rgbaCss(rgba));
      this.#pattern.append(r);
    };
    if (this.#dotted) {
      // Dots at the intersections; the alpha of dots is increased by a factor of 4 to keep a similar visual impact.
      const dot = (rgba: number) => (rgba & 0xffffff00) | Math.min((rgba & 0xff) << 2, 0xff);
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          const major = (scaled[0] || i === 0) && (scaled[1] || j === 0);
          if (major) {
            // A small cross at major intersections.
            rect(i * swx - 1, j * swy, 3, 1, dot(empcolor));
            rect(i * swx, j * swy - 1, 1, 3, dot(empcolor));
          } else rect(i * swx, j * swy, 1, 1, dot(this.#minor_color));
        }
      }
      return;
    }
    // Lines: the first of a tile is a major line (or all, when scaled).
    for (let i = 0; i < nx; i++) {
      rect(i * swx, 0, 1, tile_h, i === 0 || scaled[0] ? empcolor : this.#minor_color);
    }
    for (let j = 0; j < ny; j++) {
      rect(0, j * swy, tile_w, 1, j === 0 || scaled[1] ? empcolor : this.#minor_color);
    }
  }
}
