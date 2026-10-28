// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/snapped-line.cpp, src/snapped-line.h
/*
 * SnappedLine class.
 *
 * Authors:
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *
 * Copyright (C) 2007 - 2008 Authors
 */
import { type SnapSourceType, SnapTargetType } from '@inkscape-web/core';
import { L2, Point, rot90 } from '@inkscape-web/geom';
import { SnappedPoint } from './snapped-point.ts';
import { lineIntersection } from './snapper.ts';

/** A snap to an infinite line (a grid line or a guide), given by its normal and a point on it. */
export class SnappedLine extends SnappedPoint {
  readonly #normal_to_line: Point;
  readonly #point_on_line: Point;

  constructor(
    snapped_point: Point,
    snapped_distance: number,
    source: SnapSourceType,
    source_num: number,
    target: SnapTargetType,
    snapped_tolerance: number,
    always_snap: boolean,
    normal_to_line: Point,
    point_on_line: Point,
  ) {
    super(snapped_point, source, source_num, target, snapped_distance, snapped_tolerance, always_snap);
    this.#normal_to_line = normal_to_line;
    this.#point_on_line = point_on_line;
  }

  getNormal(): Point {
    return this.#normal_to_line;
  }
  getPointOnLine(): Point {
    return this.#point_on_line;
  }

  /**
   * The intersection of two lines that are both within snapping range. One
   * could be a grid line, whereas the other could be a guide line. The
   * intersection might be outside the snapping range. The target type is
   * left undefined: the caller sets it. Returns an unsnapped point if the
   * lines are parallel.
   */
  intersect(line: SnappedLine): SnappedPoint {
    const inters_pt = lineIntersection(
      this.#point_on_line,
      rot90(this.#normal_to_line),
      line.#point_on_line,
      rot90(line.#normal_to_line),
    );
    if (!inters_pt) {
      // No intersection
      return new SnappedPoint(new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
    }
    /* If a snapper has been told to "always snap", then this one should be preferred
     * over the other, if that other one has not been told so. (The preferred snapper
     * will be labelled "primary" below)
     */
    const c1 = this.getAlwaysSnap() && !line.getAlwaysSnap();
    /* If neither or both have been told to "always snap", then cast a vote based on
     * the snapped distance. For this we should consider the distance to the snapped
     * line or to the intersection
     */
    const c2 = this._distance < line.getSnapDistance();
    const use_this_as_primary = c1 || c2;
    const primarySL: SnappedLine = use_this_as_primary ? this : line;
    const secondarySL: SnappedLine = use_this_as_primary ? line : this;
    const primaryDist = L2(inters_pt.sub(primarySL.getPoint()));
    const secondaryDist = L2(inters_pt.sub(secondarySL.getPoint()));
    return SnappedPoint.atIntersection(
      inters_pt,
      primarySL.getSourceNum(),
      SnapTargetType.SNAPTARGET_UNDEFINED,
      primaryDist,
      primarySL.getTolerance(),
      primarySL.getAlwaysSnap(),
      secondaryDist,
      secondarySL.getTolerance(),
      secondarySL.getAlwaysSnap(),
    );
  }
}

/** The closest snapped line of list, or null (upstream getClosestSL). */
export function getClosestSL(list: readonly SnappedLine[]): SnappedLine | null {
  let result: SnappedLine | null = null;
  for (const i of list) if (!result || i.getSnapDistance() < result.getSnapDistance()) result = i;
  return result;
}

/** Keep the better intersection point (upstream: the c1/c2/c3 test of getClosestIntersectionSL). */
function better(sp: SnappedPoint, result: SnappedPoint | null): boolean {
  if (!sp.getAtIntersection()) return false;
  if (!result) return true;
  return (
    sp.getSnapDistance() < result.getSnapDistance() ||
    (sp.getSnapDistance() === result.getSnapDistance() &&
      sp.getSecondSnapDistance() < result.getSecondSnapDistance())
  );
}

/**
 * The closest intersection of two snapped lines: both of list1 (list2
 * omitted), or one of each list. Null if there is none.
 */
export function getClosestIntersectionSL(
  list1: readonly SnappedLine[],
  list2?: readonly SnappedLine[],
): SnappedPoint | null {
  let result: SnappedPoint | null = null;
  list1.forEach((i, n) => {
    for (const j of list2 ?? list1.slice(n + 1)) {
      const sp = i.intersect(j);
      if (better(sp, result)) result = sp;
    }
  });
  return result;
}
