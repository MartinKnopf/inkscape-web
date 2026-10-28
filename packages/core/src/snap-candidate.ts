// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/snap-candidate.h
/*
 * Authors:
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *
 * Copyright (C) 2010 Authors
 */
import { Affine, type OptRect, type Path, type Point } from '@inkscape-web/geom';
import type { SPItem } from './object/sp-item.ts';
import { SnapSourceType, SnapTargetType } from './snap-enums.ts';

/** A point that is a snap source or a snap target (upstream SnapCandidatePoint). */
export class SnapCandidatePoint {
  #point: Point;
  readonly #source_type: SnapSourceType;
  readonly #target_type: SnapTargetType;
  /**
   * Sequence number of the source point within the set of points that is to be snapped:
   * counts from zero if more points might follow (e.g. in the selector tool), -1 for a single point.
   */
  #source_num: number;
  /** If this is a target that belongs to a bounding box, that bounding box. */
  readonly #target_bbox: OptRect;
  /**
   * For perpendicular or tangential snapping: the starting points of a rotating line
   * (false), or the direction vector of a translating line (true).
   */
  readonly #origins_and_vectors: [Point, boolean][] = [];

  constructor(
    point: Point,
    source: SnapSourceType,
    target: SnapTargetType = SnapTargetType.SNAPTARGET_UNDEFINED,
    source_num = -1,
    bbox: OptRect = null,
  ) {
    this.#point = point;
    this.#source_type = source;
    this.#target_type = target;
    this.#source_num = source_num;
    this.#target_bbox = bbox;
  }

  getPoint(): Point {
    return this.#point;
  }
  getSourceType(): SnapSourceType {
    return this.#source_type;
  }
  getTargetType(): SnapTargetType {
    return this.#target_type;
  }
  isSingleHandle(): boolean {
    return (
      (this.#source_type === SnapSourceType.SNAPSOURCE_NODE_HANDLE ||
        this.#source_type === SnapSourceType.SNAPSOURCE_OTHER_HANDLE) &&
      this.#source_num === -1
    );
  }
  getSourceNum(): number {
    return this.#source_num;
  }
  setSourceNum(num: number): void {
    this.#source_num = num;
  }
  addOrigin(pt: Point): void {
    this.#origins_and_vectors.push([pt, false]);
  }
  addVector(v: Point): void {
    this.#origins_and_vectors.push([v, true]);
  }
  getOriginsAndVectors(): readonly [Point, boolean][] {
    return this.#origins_and_vectors;
  }
  getTargetBBox(): OptRect {
    return this.#target_bbox;
  }
  setPoint(pt: Point): void {
    this.#point = pt;
  }
}

/** An item that is considered for snapping to (upstream SnapCandidateItem). */
export class SnapCandidateItem {
  constructor(
    readonly item: SPItem,
    /** If true, then item refers to a clipping path or a mask. */
    readonly clip_or_mask: boolean,
    /** The transform of the clipped or masked object, for clipping paths and masks. */
    readonly additional_affine: Affine = Affine.identity(),
  ) {}
}

/** A path vector (document coordinates) that is considered for snapping to (upstream SnapCandidatePath). */
export class SnapCandidatePath {
  constructor(
    readonly path_vector: readonly Path[],
    readonly target_type: SnapTargetType,
    readonly target_bbox: OptRect,
    readonly currently_being_edited = false,
  ) {}
}
