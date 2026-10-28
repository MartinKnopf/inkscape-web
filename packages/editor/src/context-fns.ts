// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/context-fns.cpp, src/context-fns.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import { SnapCandidatePoint, SnapSourceType, type SPItem } from '@inkscape-web/core';
import { Point, Rect } from '@inkscape-web/geom';
import type { SPDesktop } from './desktop.ts';
import type { SnappedPoint } from './snapped-point.ts';
import { SnapConstraint } from './snapper.ts';
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
 * The dragged corner snaps (along the constraint with Ctrl); item is the
 * shape being drawn, which is not snapped to.
 */
export function snap_rectangular_box(
  desktop: SPDesktop,
  pt: Point,
  center: Point,
  state: ModifierState,
  item: SPItem | null = null,
): Rect {
  desktop.getSnapIndicator().remove_snaptarget();
  const p: [Point, Point] = [center, pt];
  const confine = mod_trans_confine(state);
  const off_center = mod_trans_off_center(state);
  /* Check if Alt key is pressed */
  const rect_edge = mod_trans_increment(state);

  const m = desktop.getSnapManager();
  m.setup(desktop, false, item);
  let snappoint: SnappedPoint | null = null;
  const candidate = (q: Point) => new SnapCandidatePoint(q, SnapSourceType.SNAPSOURCE_NODE_HANDLE);
  /** Snap both corners (around the center) with snap(); the better snap wins. */
  const snapBoth = (snap: (q: Point, other: Point) => SnappedPoint) => {
    const s0 = snap(p[0], p[1]);
    const s1 = snap(p[1], p[0]);
    /* Choose the best snap and update points accordingly */
    if (s0.getSnapDistance() < s1.getSnapDistance()) {
      if (s0.getSnapped()) {
        p[0] = s0.getPoint();
        p[1] = center.mul(2).sub(s0.getPoint());
        snappoint = s0;
      }
    } else if (s1.getSnapped()) {
      p[0] = center.mul(2).sub(s1.getPoint());
      p[1] = s1.getPoint();
      snappoint = s1;
    }
  };

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
    if (off_center) {
      // Our origin is the centre point rather than the corner point;
      // this means that corner-point movements are bound to each other.
      /* p[0] is the opposite corner of our box */
      p[0] = center.sub(delta);
      /* Try to snap each corner along the constraint vector */
      snapBoth((q, other) => m.constrainedSnap(candidate(q), SnapConstraint.direction(q.sub(other))));
    } else {
      /* Our origin is the opposite corner.  Snap the drag point along the constraint vector */
      p[0] = center;
      const s = m.constrainedSnap(candidate(p[1]), SnapConstraint.direction(p[1].sub(p[0])));
      if (s.getSnapped()) {
        p[1] = s.getPoint();
        snappoint = s;
      }
    }
  } else if (off_center) {
    // Our origin is the centre point rather than the corner point;
    // this means that corner-point movements are bound to each other.
    p[1] = pt;
    p[0] = center.mul(2).sub(p[1]);
    snapBoth((q) => m.freeSnap(candidate(q)));
  } else {
    /* There's no constraint on the corner point, so just snap it to anything */
    p[0] = center;
    p[1] = pt;
    const s = m.freeSnap(candidate(pt));
    if (s.getSnapped()) {
      p[1] = s.getPoint();
      snappoint = s;
    }
  }

  if (snappoint) desktop.getSnapIndicator().set_new_snaptarget(snappoint);
  m.unSetup();

  const dt2doc = desktop.dt2doc();
  const a = p[0].transformed(dt2doc);
  const b = p[1].transformed(dt2doc);
  return new Rect(
    new Point(Math.min(a.x, b.x), Math.min(a.y, b.y)),
    new Point(Math.max(a.x, b.x), Math.max(a.y, b.y)),
  );
}
