// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/draw-anchor.cpp, src/ui/draw-anchor.h
/*
 * Anchors implementation.
 *
 * Authors:
 * Copyright (C) 2000 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2002 Lauris Kaplinski
 * Copyright (C) 2004 Monash University
 */
import type { PathVector, Point } from '@inkscape-web/geom';
import { CanvasItemCtrl, CanvasItemCtrlType } from '../display/control/canvas-item-ctrl.ts';
import type { FreehandBase } from './tools/freehand-base.ts';

/** Half the size of the anchor handle in screen px (the default handle is 9 px). */
const HALF_SIZE = 4.5;

/**
 * The drawing anchor: a node at an end of a path in the pen and pencil tools
 * (the start of the path being drawn, or an end of the selected path), where
 * a click continues or closes the path.
 * TODO: CANVAS_ITEM_CTRL_TYPE_ANCHOR and the large handle size on hover.
 */
export class SPDrawAnchor {
  readonly dc: FreehandBase;
  /** The path the anchor belongs to (shared with the tool's white_curves or green_curve). */
  curve: PathVector;
  /** True for the start of curve, false for its end. */
  readonly start: boolean;
  active = false;
  /** Position in desktop coordinates. */
  dp: Point;
  readonly ctrl: CanvasItemCtrl;

  constructor(dc: FreehandBase, curve: PathVector, start: boolean, delta: Point) {
    this.dc = dc;
    this.curve = curve;
    this.start = start;
    this.dp = delta;
    this.ctrl = new CanvasItemCtrl(
      dc._desktop.getCanvasControls(),
      CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_DEFAULT,
      delta,
    );
    this.ctrl.set_pickable(false); // We do our own checking. (TODO: Should be fixed!)
  }

  /** Remove the handle; clear the references in the tool. */
  destroy(): void {
    this.ctrl.unlink();
    if (this.dc.sa === this) this.dc.sa = null;
    if (this.dc.ea === this) this.dc.ea = null;
  }

  /**
   * Test if the world point w is near the anchor; if so, highlight it and return it, else
   * return null.
   */
  anchorTest(w: Point, activate: boolean): SPDrawAnchor | null {
    const d = this.dp.transformed(this.dc._desktop.d2w()).sub(w);
    if (activate && Math.abs(d.x) <= HALF_SIZE && Math.abs(d.y) <= HALF_SIZE) {
      if (!this.active) {
        this.ctrl.set_hover(true);
        this.active = true;
      }
      return this;
    }
    if (this.active) {
      this.ctrl.set_hover(false);
      this.active = false;
    }
    return null;
  }
}
