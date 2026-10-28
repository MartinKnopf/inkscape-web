// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/snapped-curve.cpp, src/snapped-curve.h
/*
 * SnappedCurve class.
 *
 * Authors:
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *
 * Copyright (C) 2007 - 2008 Authors
 */
import { type SnapSourceType, SnapTargetType } from '@inkscape-web/core';
import type { Curve, OptRect, Point } from '@inkscape-web/geom';
import { SnappedPoint } from './snapped-point.ts';

/**
 * A snap to a curve of a path (or of a bbox edge, page border): the nearest
 * point on the curve, the tangent there and which path and segment it is.
 * TODO: intersections of curves with curves and with guides
 * (SNAPTARGET_PATH_INTERSECTION, SNAPTARGET_PATH_GUIDE_INTERSECTION).
 */
export class SnappedCurve extends SnappedPoint {
  readonly #curve: Curve | null;
  readonly #num_path: number;
  readonly #num_segm: number;

  constructor(
    snapped_point: Point,
    tangent: Point,
    num_path: number,
    num_segm: number,
    snapped_distance: number,
    snapped_tolerance: number,
    always_snap: boolean,
    fully_constrained: boolean,
    curve: Curve | null,
    source: SnapSourceType,
    source_num: number,
    target: SnapTargetType,
    target_bbox: OptRect,
  ) {
    super(
      snapped_point,
      source,
      source_num,
      target,
      snapped_distance,
      snapped_tolerance,
      always_snap,
      false,
      fully_constrained,
      target_bbox,
    );
    this._tangent = tangent;
    this.#curve = curve;
    this.#num_path = num_path;
    this.#num_segm = num_segm;
  }

  getCurve(): Curve | null {
    return this.#curve;
  }
  getNumPath(): number {
    return this.#num_path;
  }
  getNumSegm(): number {
    return this.#num_segm;
  }
}

/**
 * The closest snapped curve of list, or null. exclude_paths skips the
 * SNAPTARGET_PATH curves; paths_only keeps only curves on a path.
 */
export function getClosestCurve(
  list: readonly SnappedCurve[],
  exclude_paths: boolean,
  paths_only = false,
): SnappedCurve | null {
  let result: SnappedCurve | null = null;
  for (const i of list) {
    if (exclude_paths && i.getTarget() === SnapTargetType.SNAPTARGET_PATH) continue;
    if (paths_only && !i.getOnPath()) continue; // This discards for example bounding box edges, page border, and text baseline
    if (!result || i.getSnapDistance() < result.getSnapDistance()) result = i;
  }
  return result;
}
