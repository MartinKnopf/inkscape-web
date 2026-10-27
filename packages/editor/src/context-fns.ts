// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/context-fns.cpp, src/context-fns.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import { Point, Rect } from '@inkscape-web/geom';
import type { SPDesktop } from './desktop.ts';
import {
  type ModifierState,
  mod_trans_confine,
  mod_trans_increment,
  mod_trans_off_center,
} from './ui/tools/tool-base.ts';

const goldenratio = 1.618033988749895; // golden ratio
const midpt_1_goldenratio = (1 + goldenratio) / 2;
const midpt_goldenratio_2 = (goldenratio + 2) / 2;

/**
 * Check to see if the current layer is both unhidden and unlocked.
 * TODO: flash "<b>Current layer is hidden</b>..." in the message context.
 */
export function have_viable_layer(desktop: SPDesktop): boolean {
  const layer = desktop.layerManager().currentLayer();
  return !!layer && !layer.isHidden() && !layer.isLocked();
}

/**
 * The box a rect or ellipse tool draws from center (the press point) to pt,
 * both in desktop coordinates; the result is in document coordinates.
 * trans-confine (Ctrl) makes an integer-ratio or golden-ratio box, with
 * trans-increment (Alt) a square; trans-off-center (Shift) draws around center.
 * TODO: snapping and the snap indicator.
 */
export function snap_rectangular_box(
  desktop: SPDesktop,
  pt: Point,
  center: Point,
  state: ModifierState,
): Rect {
  const p: [Point, Point] = [center, pt];
  const confine = mod_trans_confine(state);
  const off_center = mod_trans_off_center(state);
  /* Check if Alt key is pressed */
  const rect_edge = mod_trans_increment(state);

  if (confine) {
    /* We are constrained to producing integer-ratio rectangles */
    /* Vector from the centre of the box to the point we are dragging to */
    let dx = pt.x - center.x;
    let dy = pt.y - center.y;
    if (!rect_edge) {
      /* Round it so that we have an integer-ratio (or golden ratio) box */
      if (Math.abs(dx) > Math.abs(dy) && dy !== 0.0) {
        const ratio = dx / dy;
        const ratioabs = Math.abs(ratio);
        const sign = ratio < 0 ? -1 : 1;
        if (midpt_1_goldenratio < ratioabs && ratioabs < midpt_goldenratio_2) {
          dx = sign * goldenratio * dy;
        } else {
          dx = Math.floor(ratio + 0.5) * dy;
        }
      } else if (dx !== 0.0) {
        const ratio = dy / dx;
        const ratioabs = Math.abs(ratio);
        const sign = ratio < 0 ? -1 : 1;
        if (midpt_1_goldenratio < ratioabs && ratioabs < midpt_goldenratio_2) {
          dy = sign * goldenratio * dx;
        } else {
          dy = Math.floor(dy / dx + 0.5) * dx;
        }
      }
    } else {
      /* Since Alt+Ctrl is pressed we make mouse pointer lie on square with origin as one corner */
      const ratio = dy / dx;
      const sign = ratio < 0 ? -1 : 1;
      if (Math.abs(dx) > Math.abs(dy) && dy !== 0.0) {
        dy = sign * dx;
      } else if (dx !== 0.0) {
        dx = sign * dy;
      }
    }
    const delta = new Point(dx, dy);
    /* p[1] is the dragged point with the integer-ratio constraint */
    p[1] = center.add(delta);
    // Our origin is the centre point rather than the corner point;
    // this means that corner-point movements are bound to each other.
    /* p[0] is the opposite corner of our box */
    p[0] = off_center ? center.sub(delta) : center;
  } else if (off_center) {
    // Our origin is the centre point rather than the corner point;
    // this means that corner-point movements are bound to each other.
    p[1] = pt;
    p[0] = center.mul(2).sub(p[1]);
  }

  const dt2doc = desktop.dt2doc();
  const a = p[0].transformed(dt2doc);
  const b = p[1].transformed(dt2doc);
  return new Rect(
    new Point(Math.min(a.x, b.x), Math.min(a.y, b.y)),
    new Point(Math.max(a.x, b.x), Math.max(a.y, b.y)),
  );
}
