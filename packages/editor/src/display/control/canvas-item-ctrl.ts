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
import { Preferences } from '@inkscape-web/core';
import { type Affine, Point } from '@inkscape-web/geom';
import { SPAnchorType } from '../../enums.ts';
import { CanvasItem, type CanvasItemGroup } from './canvas-item.ts';

/** Upstream CanvasItemCtrlType (same order as canvas-item-enums.h). */
export enum CanvasItemCtrlType {
  CANVAS_ITEM_CTRL_TYPE_DEFAULT,
  /** Stretch & Scale */
  CANVAS_ITEM_CTRL_TYPE_ADJ_HANDLE,
  CANVAS_ITEM_CTRL_TYPE_ADJ_SKEW,
  CANVAS_ITEM_CTRL_TYPE_ADJ_ROTATE,
  CANVAS_ITEM_CTRL_TYPE_ADJ_CENTER,
  CANVAS_ITEM_CTRL_TYPE_ADJ_SALIGN,
  CANVAS_ITEM_CTRL_TYPE_ADJ_CALIGN,
  CANVAS_ITEM_CTRL_TYPE_ADJ_MALIGN,
  CANVAS_ITEM_CTRL_TYPE_ANCHOR,
  /** dot-like handle, indicator */
  CANVAS_ITEM_CTRL_TYPE_POINT,
  CANVAS_ITEM_CTRL_TYPE_ROTATE,
  CANVAS_ITEM_CTRL_TYPE_MARGIN,
  CANVAS_ITEM_CTRL_TYPE_CENTER,
  CANVAS_ITEM_CTRL_TYPE_SIZER,
  CANVAS_ITEM_CTRL_TYPE_SHAPER,
  CANVAS_ITEM_CTRL_TYPE_MARKER,
  CANVAS_ITEM_CTRL_TYPE_MESH,
  CANVAS_ITEM_CTRL_TYPE_LPE,
  CANVAS_ITEM_CTRL_TYPE_NODE_AUTO,
  CANVAS_ITEM_CTRL_TYPE_NODE_CUSP,
  CANVAS_ITEM_CTRL_TYPE_NODE_SMOOTH,
  CANVAS_ITEM_CTRL_TYPE_NODE_SYMMETRICAL,
  CANVAS_ITEM_CTRL_TYPE_INVISIPOINT,
}

/** Size of a handle relative to the handle size preference (upstream HandleSize). */
export enum HandleSize {
  XTINY = -4,
  TINY = -2,
  SMALL = -1,
  NORMAL = 0,
  LARGE = 1,
}

/** Range of the size index (upstream MIN_INDEX, MAX_INDEX). */
const MIN_INDEX = 1;
const MAX_INDEX = 15;

type Shape = 'square' | 'diamond' | 'circle' | 'darrow';

interface CtrlStyle {
  shape: Shape;
  /** Factor applied to the size index. */
  scale: number;
  /** Extra px added to the size. */
  size_extra: number;
  fill: string;
  hover: string;
  selected: string;
  opacity?: number;
}

/** The '*' rule of node-handles.css. */
const BASE: CtrlStyle = {
  shape: 'square',
  scale: 2.0,
  size_extra: 1,
  fill: 'white',
  hover: '#0a60e0',
  selected: '#308aff',
};

/**
 * Style per type and state, from share/ui/node-handles.css (the types used so far).
 * TODO: read node-handles.css (and the user's file).
 */
const STYLES: Partial<Record<CanvasItemCtrlType, Partial<CtrlStyle>>> = {
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ADJ_HANDLE]: {
    shape: 'darrow',
    size_extra: 7,
    fill: 'black',
    hover: '#6da7ff',
    selected: '#4992fe',
  },
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_NODE_CUSP]: { shape: 'diamond', scale: 2.828427, size_extra: 2 },
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_SHAPER]: { shape: 'diamond', scale: 2.828427, size_extra: 2 },
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_NODE_SMOOTH]: { shape: 'square', size_extra: 2 },
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_NODE_SYMMETRICAL]: { shape: 'square', size_extra: 2 },
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ANCHOR]: { shape: 'square', size_extra: 2 },
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_SIZER]: { shape: 'square', size_extra: 2 },
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_NODE_AUTO]: { shape: 'circle', scale: 2.256758, size_extra: 2 },
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ROTATE]: { shape: 'circle', scale: 2.256758, size_extra: 2 },
  // despite being invisible size of this handle is important, as it is a hit target for path manipulation
  [CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_INVISIPOINT]: { scale: 2, size_extra: 1, opacity: 0 },
};

function styleOf(type: CanvasItemCtrlType): CtrlStyle {
  return { ...BASE, ...STYLES[type] };
}

/** The default size index (upstream get_size_default). */
function get_size_default(): number {
  const v = Preferences.get().getInt('/options/grabsize/value', 4);
  return Math.min(Math.max(v, MIN_INDEX), MAX_INDEX);
}

/** Outline around handles: white, 1.45 px, 75% opacity ('*' in node-handles.css). */
const OUTLINE_WIDTH = 1.45;
const OUTLINE_OPACITY = 0.75;

/**
 * A handle at a desktop point with a fixed screen size (upstream
 * CanvasItemCtrl). The shape and colors come from the type and the state
 * (normal, hover, selected, click). Scale handles are double arrows that
 * point away from the anchor.
 * TODO: the other shapes and types, rotated canvas, stroke-scale.
 */
export class CanvasItemCtrl extends CanvasItem {
  #type: CanvasItemCtrlType;
  #position = new Point(0, 0);
  #anchor = SPAnchorType.SP_ANCHOR_CENTER;
  #hover = false;
  #selected = false;
  #click = false;
  /** Size index (upstream _width). */
  #width = get_size_default();
  #rel_size = HandleSize.NORMAL;
  readonly #outline: SVGPathElement;
  readonly #path: SVGPathElement;

  constructor(group: CanvasItemGroup, type: CanvasItemCtrlType, position?: Point) {
    super(group, 'CanvasItemCtrl');
    this.#type = type;
    this.set_pickable(true);
    this.#outline = this._createElement('path');
    this.#outline.setAttribute('fill', 'none');
    this.#outline.setAttribute('stroke', 'white');
    this.#outline.setAttribute('stroke-opacity', String(OUTLINE_OPACITY));
    this.#outline.setAttribute('stroke-width', String(1 + 2 * OUTLINE_WIDTH));
    this.#path = this._createElement('path');
    this.#path.setAttribute('stroke', 'black');
    this.#path.setAttribute('stroke-width', '1');
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

  set_type(type: CanvasItemCtrlType): void {
    if (this.#type === type) return;
    this.#type = type;
    this.set_size_default();
  }

  /** Set the size index directly (upstream _set_size). */
  _set_size(size: number): void {
    if (this.#width === size) return;
    this.#width = size;
    this.request_update();
  }

  /** Size relative to the handle size preference. */
  set_size(rel_size: HandleSize): void {
    this.#rel_size = rel_size;
    this.#set_size_via_index(get_size_default());
  }

  set_size_default(): void {
    this.#set_size_via_index(get_size_default());
  }

  #set_size_via_index(size_index: number): void {
    this._set_size(Math.min(Math.max(size_index + this.#rel_size, MIN_INDEX), MAX_INDEX));
  }

  /** Width in screen px (upstream get_width). */
  get_width(): number {
    const style = styleOf(this.#type);
    return this.#width * style.scale + style.size_extra;
  }

  set_hover(hover = true): void {
    this.#hover = hover;
    if (hover) this.#click = false;
    this.request_update();
  }

  set_selected(selected = true): void {
    this.#selected = selected;
    this.request_update();
  }

  set_click(click = true): void {
    this.#click = click;
    if (click) this.#hover = false;
    this.request_update();
  }

  /** Normal state (no hover, no click), with the selected appearance. */
  set_normal(selected = true): void {
    this.#selected = selected;
    this.#hover = false;
    this.#click = false;
    this.request_update();
  }

  protected _update(affine: Affine): void {
    const style = styleOf(this.#type);
    const size = this.get_width();
    const half = size / 2;
    const p = this.#position.transformed(affine);
    this.element.setAttribute('opacity', String(style.opacity ?? 1));
    const fill = this.#hover ? style.hover : this.#selected || this.#click ? style.selected : style.fill;
    this.#path.setAttribute('fill', fill);

    let d: string;
    let transform: string;
    if (style.shape === 'darrow' && this.#anchor !== SPAnchorType.SP_ANCHOR_CENTER) {
      // Point away from the anchor; the arrow sits next to the position.
      let angle = this.#anchor * (Math.PI / 4);
      // Affine flips if view orientation has been altered (horizontal or vertical flip).
      // TODO: the y axis direction of the desktop (_context->yaxisdown()).
      if (affine.flips()) angle = -angle;
      const dx = -(half + 2) * Math.cos(angle); // Add a bit to prevent tip from overlapping due to rounding errors.
      const dy = -(half + 2) * Math.sin(angle);
      d = darrowPath(size);
      transform = `translate(${Math.round(p.x + dx)},${Math.round(p.y + dy)}) rotate(${(angle * 180) / Math.PI}) translate(${-half},${-half})`;
    } else {
      d = shapePath(style.shape, size);
      transform = `translate(${Math.round(p.x) + 0.5 - half},${Math.round(p.y) + 0.5 - half})`;
    }
    for (const el of [this.#outline, this.#path]) {
      el.setAttribute('d', d);
      el.setAttribute('transform', transform);
    }
  }
}

/** Path of a shape in a size × size box. */
function shapePath(shape: Shape, size: number): string {
  const h = size / 2;
  switch (shape) {
    case 'diamond':
      return `M ${h},0.5 L ${size - 0.5},${h} L ${h},${size - 0.5} L 0.5,${h} Z`;
    case 'circle': {
      const r = h - 0.5;
      return `M ${h - r},${h} A ${r},${r} 0 1 0 ${h + r},${h} A ${r},${r} 0 1 0 ${h - r},${h} Z`;
    }
    default:
      return `M 0.5,0.5 H ${size - 0.5} V ${size - 0.5} H 0.5 Z`;
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
