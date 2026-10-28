// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/line-snapper.cpp, src/line-snapper.h
/*
 * LineSnapper class.
 *
 * Authors:
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *   And others...
 *
 * Copyright (C) 1999-2008 Authors
 */
import { type SnapCandidatePoint, type SnapSourceType, SnapTargetType } from '@inkscape-web/core';
import { L2, type OptRect, type Point, rot90 } from '@inkscape-web/geom';
import {
  type IntermSnapResults,
  lineIntersection,
  projection,
  type SnapConstraint,
  Snapper,
} from './snapper.ts';

/** A line to snap to: its normal and a point on it. */
export type SnapLine = readonly [normal: Point, point_on_line: Point];

/**
 * Base class of the snappers to infinite lines (grids and guides). Subclasses
 * give the lines near a point and record the snapped lines and points.
 */
export abstract class LineSnapper extends Snapper {
  override freeSnap(isr: IntermSnapResults, p: SnapCandidatePoint, _bbox_to_snap: OptRect): void {
    if (!(this._snap_enabled && this._snapmanager.snapprefs.isSourceSnappable(p.getSourceType()))) return;
    /* Get the lines that we will try to snap to */
    for (const [normal, p1] of this._getSnapLines(p.getPoint())) {
      const p2 = p1.add(rot90(normal)); // 2nd point at guide/grid line
      const p_proj = projection(p.getPoint(), p1, p2);
      const dist = L2(p_proj.sub(p.getPoint()));
      //Store any line that's within snapping range, adds the basic line (not the perp or origin) if always snap is true
      if (!(this.getSnapperAlwaysSnap(p.getSourceType()) || dist < this.getSnapperTolerance())) continue;
      this._addSnappedLine(isr, p_proj, dist, p.getSourceType(), p.getSourceNum(), normal, p1);
      // For any line that's within range, we will also look at it's "point on line" p1. For guides
      // this point coincides with its origin; for grids this is of no use, but we cannot
      // discern between grids and guides here
      const dist_p1 = L2(p1.sub(p.getPoint()));
      if (dist_p1 < this.getSnapperTolerance()) {
        // Only relevant for guides; grids don't have an origin per line
        this._addSnappedLinesOrigin(isr, p1, dist_p1, p.getSourceType(), p.getSourceNum(), false);
      }
      // Here we will try to snap either tangentially or perpendicularly to a grid/guide line
      for (const [origin, is_vector] of p.getOriginsAndVectors()) {
        // When snapping a line with a constant vector (constant direction) to a guide or grid line,
        // then either all points will be perpendicular/tangential or none at all. This is not very useful
        if (is_vector) continue;
        // We won't try to snap tangentially; a line being tangential to another line can be achieved by snapping both its endpoints
        if (this._snapmanager.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_PATH_PERPENDICULAR)) {
          // Find the point that leads to a perpendicular snap
          const origin_proj = projection(origin, p1, p2);
          const d = L2(origin_proj.sub(p.getPoint()));
          if (d < this.getSnapperTolerance()) {
            this._addSnappedLinePerpendicularly(
              isr,
              origin_proj,
              d,
              p.getSourceType(),
              p.getSourceNum(),
              false,
            );
          }
        }
      }
    }
  }

  override constrainedSnap(
    isr: IntermSnapResults,
    p: SnapCandidatePoint,
    _bbox_to_snap: OptRect,
    c: SnapConstraint,
  ): void {
    if (!this._snap_enabled || !this._snapmanager.snapprefs.isSourceSnappable(p.getSourceType())) return;
    // project the mouse pointer onto the constraint. Only the projected point will be considered for snapping
    const pp = c.projection(p.getPoint());
    for (const [normal, line_point] of this._getSnapLines(pp)) {
      const point_on_line = c.hasPoint() ? c.getPoint() : pp;
      const line_dir = rot90(normal);
      if (c.isCircular()) {
        // Find the intersections between the line and the circular constraint
        // First, project the origin of the circle onto the line
        const origin = c.getPoint();
        const p_proj = projection(origin, line_point, line_point.add(line_dir));
        const dist = L2(p_proj.sub(origin)); // distance from circle origin to constraint line
        const radius = c.getRadius();
        if (dist === radius) {
          // Only one point of intersection;
          this._addSnappedPoint(isr, p_proj, L2(pp.sub(p_proj)), p.getSourceType(), p.getSourceNum(), true);
        } else if (dist < radius) {
          // Two points of intersection, symmetrical with respect to the projected point
          const l = Math.sqrt(radius * radius - dist * dist);
          const d = L2(line_dir); // length of versor, needed to normalize the versor
          if (d > 0) {
            const v = line_dir.mul(l / d);
            for (const q of [p_proj.add(v), p_proj.sub(v)]) {
              this._addSnappedPoint(
                isr,
                q,
                L2(p.getPoint().sub(q)),
                p.getSourceType(),
                p.getSourceNum(),
                true,
              );
            }
          }
        }
      } else {
        // Find the intersections between the line and the linear constraint
        const t = lineIntersection(point_on_line, c.getDirection(), line_point, line_dir);
        // We're probably dealing with parallel lines, so snapping doesn't make any sense here
        if (!t) continue;
        const dist = L2(t.sub(p.getPoint()));
        if (dist < this.getSnapperTolerance()) {
          // When doing a constrained snap, we're already at an intersection.
          // This snappoint is therefore fully constrained, so there's no need
          // to look for additional intersections; just return the snapped point
          // and forget about the line
          this._addSnappedPoint(isr, t, dist, p.getSourceType(), p.getSourceNum(), true);
        }
      }
    }
  }

  /** The lines near p (desktop coordinates) to snap to. */
  protected abstract _getSnapLines(p: Point): SnapLine[];

  protected abstract _addSnappedLine(
    isr: IntermSnapResults,
    snapped_point: Point,
    snapped_distance: number,
    source: SnapSourceType,
    source_num: number,
    normal_to_line: Point,
    point_on_line: Point,
  ): void;

  /** Will only be overridden in the guide-snapper class, because grid lines don't have an origin. */
  protected _addSnappedLinesOrigin(
    _isr: IntermSnapResults,
    _origin: Point,
    _snapped_distance: number,
    _source_type: SnapSourceType,
    _source_num: number,
    _constrained_snap: boolean,
  ): void {}

  protected abstract _addSnappedPoint(
    isr: IntermSnapResults,
    snapped_point: Point,
    snapped_distance: number,
    source: SnapSourceType,
    source_num: number,
    constrained_snap: boolean,
  ): void;

  protected abstract _addSnappedLinePerpendicularly(
    isr: IntermSnapResults,
    snapped_point: Point,
    snapped_distance: number,
    source: SnapSourceType,
    source_num: number,
    constrained_snap: boolean,
  ): void;
}
