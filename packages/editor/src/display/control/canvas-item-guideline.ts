// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/control/canvas-item-guideline.cpp, src/display/control/canvas-item-guideline.h
/*
 * A class to represent a control guide line.
 *
 * Authors:
 *   Tavmjong Bah - Rewrite of SPGuideLine
 *   Rafael Siejakowski - Tweaks to handle appearance
 *
 * Copyright (C) 2020-2022 the Authors.
 */
import type { GuideView } from '@inkscape-web/core';
import { type Affine, are_near, atan2, L2, Point, rot90 } from '@inkscape-web/geom';
import { rgbaCss } from '../../ui/widget/canvas.ts';
import { CanvasItem, type CanvasItemGroup } from './canvas-item.ts';

/** Upstream CONTROL_LOCKED_COLOR. */
const CONTROL_LOCKED_COLOR = 0x00000080;
/** Width in screen px of the invisible line that takes the pointer events. */
const PICK_WIDTH = 7;
const FONT_SIZE = 10;
const LABEL_SEP = 2;
/** Radius in screen px of the handle ("the dot") at the origin. */
const DOT_RADIUS = 3.5;

/**
 * A guide line on the canvas: an infinite line through origin (desktop
 * coordinates) perpendicular to normal, 1 screen px wide, with a label and
 * a handle at the origin (upstream CanvasItemGuideLine with its
 * CanvasItemGuideHandle). It takes pointer events (see desktop-events.ts).
 */
export class CanvasItemGuideLine extends CanvasItem implements GuideView {
  #origin: Point;
  #normal: Point;
  #label: string;
  #stroke = 0x0000ff7f;
  #locked = false;
  readonly #hit: SVGPathElement;
  readonly #line: SVGPathElement;
  readonly #dot: SVGPathElement;
  readonly #text: SVGTextElement;
  readonly #disconnectPos: () => void;

  constructor(group: CanvasItemGroup, label: string, origin: Point, normal: Point) {
    super(group, 'CanvasItemGuideLine');
    this.#origin = origin;
    this.#normal = normal;
    this.#label = label;
    this.#hit = this._createElement('path');
    this.#hit.setAttribute('stroke', 'transparent');
    this.#hit.setAttribute('stroke-width', String(PICK_WIDTH));
    this.#hit.setAttribute('pointer-events', 'stroke');
    this.#line = this._createElement('path');
    this.#line.setAttribute('stroke-width', '1');
    this.#line.setAttribute('pointer-events', 'none');
    this.#line.setAttribute('shape-rendering', 'crispEdges');
    this.#text = this._createElement('text');
    this.#text.setAttribute('font-size', String(FONT_SIZE));
    this.#text.setAttribute('font-family', 'sans-serif');
    this.#text.setAttribute('pointer-events', 'none');
    this.#dot = this._createElement('path');
    this.#dot.setAttribute('pointer-events', 'all');
    for (const el of [this.#hit, this.#line, this.#dot]) el.setAttribute('fill', 'none');
    // For now, everybody gets events from this class!
    this.set_pickable(true);
    // The line spans the window: redraw when it scrolls.
    this.#disconnectPos = group.canvas.connectPos(() => this.request_update());
    this.request_update();
  }

  override unlink(): void {
    this.#disconnectPos();
    super.unlink();
  }

  /** Sets origin of guide line (place where handle is located). */
  set_origin(origin: Point): void {
    if (this.#origin.equals(origin)) return;
    this.#origin = origin;
    this.request_update();
  }
  get_origin(): Point {
    return this.#origin;
  }

  /** Sets orientation of guide line. */
  set_normal(normal: Point): void {
    if (this.#normal.equals(normal)) return;
    this.#normal = normal;
    this.request_update();
  }
  get_normal(): Point {
    return this.#normal;
  }

  set_stroke(rgba: number): void {
    this.#stroke = rgba;
    this.request_update();
  }

  set_label(label: string): void {
    if (this.#label === label) return;
    this.#label = label;
    this.request_update();
  }

  set_locked(locked: boolean): void {
    if (this.#locked === locked) return;
    this.#locked = locked;
    this.request_update();
  }

  /** Distance from window point p (world coordinates) to the line, in px. */
  closest_distance_to(p: Point): number {
    const affine = this.affine();
    const o = this.#origin.transformed(affine);
    const d = rot90(this.#normal).transformed(affine.withoutTranslation());
    const len = L2(d);
    if (len === 0) return L2(p.sub(o));
    return Math.abs(p.sub(o).cross(d)) / len;
  }

  protected _update(affine: Affine): void {
    // Document to canvas
    const normal = this.#normal.transformed(affine.withoutTranslation()); // Direction only
    const origin = this.#origin.transformed(affine);
    // Pixel-aligned origin for a 1px line.
    const aligned = new Point(Math.floor(origin.x) + 0.5, Math.floor(origin.y) + 0.5);
    const area = this._parent.canvas.get_area_world().expandBy(2);
    let d: string;
    if (are_near(normal.y, 0)) {
      // Vertical
      d = `M ${aligned.x},${area.top()} V ${area.bottom()}`;
    } else if (are_near(normal.x, 0)) {
      // Horizontal
      d = `M ${area.left()},${aligned.y} H ${area.right()}`;
    } else {
      // Angled: long enough to cross the window from wherever the origin is.
      const dir = rot90(normal).normalized();
      const reach = L2(area.midpoint().sub(origin)) + area.diameter();
      const a = origin.sub(dir.mul(reach));
      const b = origin.add(dir.mul(reach));
      d = `M ${a.x},${a.y} L ${b.x},${b.y}`;
    }
    const color = rgbaCss(this.#stroke);
    this.#hit.setAttribute('d', d);
    this.#line.setAttribute('d', d);
    this.#line.setAttribute('stroke', color);

    // The handle: a filled circle, or a cross when locked.
    const r = DOT_RADIUS;
    if (this.#locked) {
      this.#dot.setAttribute(
        'd',
        `M ${origin.x - r},${origin.y - r} L ${origin.x + r},${origin.y + r} M ${origin.x - r},${origin.y + r} L ${origin.x + r},${origin.y - r}`,
      );
      this.#dot.setAttribute('fill', 'none');
      this.#dot.setAttribute('stroke', rgbaCss(CONTROL_LOCKED_COLOR));
    } else {
      this.#dot.setAttribute(
        'd',
        `M ${origin.x + r},${origin.y} A ${r},${r} 0 1 0 ${origin.x - r},${origin.y} A ${r},${r} 0 1 0 ${origin.x + r},${origin.y} Z`,
      );
      this.#dot.setAttribute('fill', color);
      this.#dot.setAttribute('stroke', 'none');
    }

    // Render text label along the line
    this.#text.textContent = this.#label;
    const angle = (atan2(normal.cw()) * 180) / Math.PI;
    this.#text.setAttribute('fill', color);
    this.#text.setAttribute(
      'transform',
      `translate(${aligned.x},${aligned.y}) rotate(${angle}) translate(${LABEL_SEP},${-(r + FONT_SIZE / 2)})`,
    );
  }
}
