// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/control/canvas-item-ctrl.cpp, src/display/control/canvas-item-ctrl.h, src/display/control/canvas-item-enums.h, src/display/control/ctrl-handle-rendering.cpp, share/ui/node-handles.css
/*
 * A class to represent a control node.
 *
 * Authors:
 *   Tavmjong Bah
 *   Sanidhya Singh
 *
 * Copyright (C) 2020 Tavmjong Bah
 */
import { type Affine, Point } from '@inkscape-web/geom';
import { SPAnchorType } from '../../enums.ts';
import { CanvasItem, type CanvasItemGroup } from './canvas-item.ts';

/** Upstream CanvasItemCtrlType (the types used so far). */
export enum CanvasItemCtrlType {
  CANVAS_ITEM_CTRL_TYPE_DEFAULT,
  /** Stretch & Scale */
  CANVAS_ITEM_CTRL_TYPE_ADJ_HANDLE,
}

/**
 * Size and fill colors per type and state, from share/ui/node-handles.css.
 * Size: scale × /options/grabsize/value (4) + size-extra.
 * TODO: read node-handles.css and the handle size preference.
 */
const STYLES: Record<CanvasItemCtrlType, { size: number; fill: string; hover: string; selected: string }> = {
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_DEFAULT]: {
    size: 9,
    fill: 'white',
    hover: '#0a60e0',
    selected: '#308aff',
  },
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ADJ_HANDLE]: {
    size: 15,
    fill: 'black',
    hover: '#6da7ff',
    selected: '#4992fe',
  },
};

/**
 * A handle at a desktop point with a fixed screen size (upstream
 * CanvasItemCtrl). Scale handles are double arrows that point away from the
 * anchor; other types are squares.
 * TODO: the other shapes and types, handle size preference, rotated canvas.
 */
export class CanvasItemCtrl extends CanvasItem {
  readonly #type: CanvasItemCtrlType;
  #position = new Point(0, 0);
  #anchor = SPAnchorType.SP_ANCHOR_CENTER;
  #hover = false;
  #selected = false;
  readonly #path: SVGPathElement;

  constructor(group: CanvasItemGroup, type: CanvasItemCtrlType, position?: Point) {
    super(group, 'CanvasItemCtrl');
    this.#type = type;
    this.set_pickable(true);
    this.#path = this._createElement('path');
    this.#path.setAttribute('stroke', 'white');
    this.#path.setAttribute('stroke-width', '1');
    this.#path.setAttribute('paint-order', 'stroke');
    if (position) this.#position = position;
    this.request_update();
  }

  /** Position in desktop coordinates. */
  set_position(position: Point): void {
    this.#position = position;
    this.request_update();
  }
  get_position(): Point {
    return this.#position;
  }

  set_anchor(anchor: SPAnchorType): void {
    this.#anchor = anchor;
    this.request_update();
  }

  set_hover(hover: boolean): void {
    this.#hover = hover;
    this.request_update();
  }

  set_selected(selected: boolean): void {
    this.#selected = selected;
    this.request_update();
  }

  protected _update(affine: Affine): void {
    const style = STYLES[this.#type];
    const size = style.size;
    const half = size / 2;
    const p = this.#position.transformed(affine);
    this.#path.setAttribute('fill', this.#hover ? style.hover : this.#selected ? style.selected : style.fill);

    if (
      this.#type === CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ADJ_HANDLE &&
      this.#anchor !== SPAnchorType.SP_ANCHOR_CENTER
    ) {
      // Point away from the anchor; the arrow sits next to the position.
      let angle = this.#anchor * (Math.PI / 4);
      // Affine flips if view orientation has been altered (horizontal or vertical flip).
      // TODO: the y axis direction of the desktop (_context->yaxisdown()).
      if (affine.flips()) angle = -angle;
      const dx = -(half + 2) * Math.cos(angle); // Add a bit to prevent tip from overlapping due to rounding errors.
      const dy = -(half + 2) * Math.sin(angle);
      this.#path.setAttribute('d', darrowPath(size));
      this.#path.setAttribute(
        'transform',
        `translate(${Math.round(p.x + dx)},${Math.round(p.y + dy)}) rotate(${(angle * 180) / Math.PI}) translate(${-half},${-half})`,
      );
    } else {
      this.#path.setAttribute('d', `M 0.5,0.5 H ${size - 0.5} V ${size - 0.5} H 0.5 Z`);
      this.#path.setAttribute('transform', `translate(${Math.round(p.x - half)},${Math.round(p.y - half)})`);
    }
  }
}

/** A horizontal double arrow in a size × size box (upstream draw_darrow, without the 45° pixel alignment). */
function darrowPath(size: number): string {
  // Tip of arrow (0)
  const tip_x = 0.5; // At edge, allow room for stroke.
  const tip_y = size / 2.0; // Center
  // Length of arrowhead (not including stroke).
  const delta = Math.round((size - 1) / 4.0 + tip_x) - tip_x;
  // Outer corner (1) and inner corner (2)
  const out_x = tip_x + delta;
  const out_y = tip_y - delta;
  const in_x = out_x;
  const in_y = Math.round(out_y + delta / 2.0);
  const pts = [
    [tip_x, tip_y],
    [out_x, out_y],
    [in_x, in_y],
    [size - in_x, in_y],
    [size - out_x, out_y],
    [size - tip_x, tip_y],
    [size - out_x, size - out_y],
    [size - in_x, size - in_y],
    [in_x, size - in_y],
    [out_x, size - out_y],
  ];
  return `M ${pts.map(([x, y]) => `${x},${y}`).join(' L ')} Z`;
}
