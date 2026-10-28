// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/snapped-point.cpp, src/snapped-point.h
/*
 * SnappedPoint class.
 *
 * Authors:
 *   Mathieu Dimanche <mdimanche@free.fr>
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *
 * Copyright (C) 2005 - 2012 Authors
 */
import { Preferences, type SnapCandidatePoint, SnapSourceType, SnapTargetType } from '@inkscape-web/core';
import { L2, type OptRect, Point } from '@inkscape-web/geom';

/**
 * The result of snapping a point: where it snapped to, the source and target
 * types, the snap distance and the tolerance (both in desktop units). A point
 * that did not snap has an infinite snap distance.
 * TODO: alignment and distribution snapping (alignment targets, equal distances).
 */
export class SnappedPoint {
  protected _point: Point;
  protected _tangent = new Point(0, 0);
  protected _source: SnapSourceType;
  protected _source_num: number;
  protected _target: SnapTargetType;
  /** If true, the snapped point is at an intersection of e.g. two lines. */
  protected _at_intersection = false;
  /** If true, then the snapped point was found when looking for a constrained snap. */
  protected _constrained_snap: boolean;
  /** If true, then the snapped point was fully constrained (a node or an intersection, not a line). */
  protected _fully_constrained: boolean;
  /** The distance from the original point to the snapped point. */
  protected _distance: number;
  /** The snapper tolerance; never smaller than 1, as it is used for normalization. */
  protected _tolerance: number;
  /** If true, the snapper will always snap, regardless of its tolerance. */
  protected _always_snap: boolean;
  /** For intersections: the distance to the second line, its tolerance and always-snap flag. */
  protected _second_distance = Number.POSITIVE_INFINITY;
  protected _second_tolerance = 1;
  protected _second_always_snap = false;
  /** The bounding box we've snapped to (when applicable); used for the snap indicator. */
  protected _target_bbox: OptRect;
  /** The distance between the pointer and the original source point (not the snapped point). */
  protected _pointer_distance = Number.POSITIVE_INFINITY;

  constructor(
    p: Point = new Point(0, 0),
    source: SnapSourceType = SnapSourceType.SNAPSOURCE_UNDEFINED,
    source_num = -1,
    target: SnapTargetType = SnapTargetType.SNAPTARGET_UNDEFINED,
    d = Number.POSITIVE_INFINITY,
    t = 1,
    a = false,
    constrained_snap = false,
    fully_constrained = false,
    target_bbox: OptRect = null,
  ) {
    this._point = p;
    this._source = source;
    this._source_num = source_num;
    this._target = target;
    this._distance = d;
    this._tolerance = Math.max(t, 1.0);
    this._always_snap = a;
    this._constrained_snap = constrained_snap;
    this._fully_constrained = fully_constrained;
    this._target_bbox = target_bbox;
  }

  /** A snapped point for a candidate point (its position, source and target bbox). */
  static fromCandidate(
    p: SnapCandidatePoint,
    target: SnapTargetType,
    d: number,
    t: number,
    a: boolean,
    constrained_snap: boolean,
    fully_constrained: boolean,
  ): SnappedPoint {
    return new SnappedPoint(
      p.getPoint(),
      p.getSourceType(),
      p.getSourceNum(),
      target,
      d,
      t,
      a,
      constrained_snap,
      fully_constrained,
      p.getTargetBBox(),
    );
  }

  /** A snapped point at the intersection of two lines (or curves), with both distances. */
  static atIntersection(
    p: Point,
    source_num: number,
    target: SnapTargetType,
    d: number,
    t: number,
    a: boolean,
    d2: number,
    t2: number,
    a2: boolean,
  ): SnappedPoint {
    const s = new SnappedPoint(
      p,
      SnapSourceType.SNAPSOURCE_UNDEFINED,
      source_num,
      target,
      d,
      t,
      a,
      false,
      true,
    );
    s._at_intersection = true;
    s._second_distance = d2;
    s._second_tolerance = Math.max(t2, 1.0);
    s._second_always_snap = a2;
    return s;
  }

  getSnapDistance(): number {
    return this._distance;
  }
  setSnapDistance(d: number): void {
    this._distance = d;
  }
  getTolerance(): number {
    return this._tolerance;
  }
  getAlwaysSnap(): boolean {
    return this._always_snap;
  }
  getSecondSnapDistance(): number {
    return this._second_distance;
  }
  setSecondSnapDistance(d: number): void {
    this._second_distance = d;
  }
  getSecondTolerance(): number {
    return this._second_tolerance;
  }
  getSecondAlwaysSnap(): boolean {
    return this._second_always_snap;
  }
  getPointerDistance(): number {
    return this._pointer_distance;
  }
  setPointerDistance(d: number): void {
    this._pointer_distance = d;
  }
  /** The snapped point. */
  getPoint(): Point {
    return this._point;
  }
  setPoint(p: Point): void {
    this._point = p;
  }
  getTangent(): Point {
    return this._tangent;
  }
  getAtIntersection(): boolean {
    return this._at_intersection;
  }
  getFullyConstrained(): boolean {
    return this._fully_constrained;
  }
  getConstrainedSnap(): boolean {
    return this._constrained_snap;
  }
  getSnapped(): boolean {
    return this._distance < Number.POSITIVE_INFINITY;
  }
  getTarget(): SnapTargetType {
    return this._target;
  }
  setTarget(target: SnapTargetType): void {
    this._target = target;
  }
  getSource(): SnapSourceType {
    return this._source;
  }
  setSource(source: SnapSourceType): void {
    this._source = source;
  }
  getSourceNum(): number {
    return this._source_num;
  }
  getTargetBBox(): OptRect {
    return this._target_bbox;
  }

  /** p if we have not snapped, else the snapped point (upstream getPointIfSnapped). */
  getPointIfSnapped(p: Point): Point {
    // When we have snapped then return the snapped point; otherwise p will be left untouched
    return this.getSnapped() ? this._point : p;
  }

  /**
   * Whether other_one is a better snap than this one. With weighted, the
   * distance of the source point to the pointer counts too
   * (/options/snapweight/value), to choose between source points.
   */
  isOtherSnapBetter(other_one: SnappedPoint, weighted: boolean): boolean {
    if (this.getSnapped() && !other_one.getSnapped()) return false;
    if (!this.getSnapped() && other_one.getSnapped()) return true;

    let dist_other = other_one.getSnapDistance();
    let dist_this = this.getSnapDistance();

    // The distance to the pointer should only be taken into account when finding the best snapped source node (when
    // there's more than one). It is not useful when trying to find the best snapped target point.
    // (both the snap distance and the pointer distance are measured in document pixels, not in screen pixels)
    if (weighted) {
      const dist_pointer_other = other_one.getPointerDistance();
      const dist_pointer_this = this.getPointerDistance();
      // Weight factor: controls which node should be preferred for snapping, which is either
      // the node with the closest snap (w = 0), or the node closest to the mousepointer (w = 1)
      const prefs = Preferences.get();
      let w = Math.min(Math.max(prefs.getDouble('/options/snapweight/value', 0.5), 0), 1);
      if (prefs.getBool('/options/snapclosestonly/value', false)) w = 1;
      if (w > 0 && !(w === 1 && dist_pointer_this === dist_pointer_other)) {
        // The snap distance will always be smaller than the tolerance set for the snapper. The pointer distance can
        // however be very large. To compare these in a fair way, we will have to normalize these metrics first
        // The closest pointer distance will be normalized to 1.0; the other one will be > 1.0
        // The snap distance will be normalized to 1.0 if it's equal to the snapper tolerance
        const norm_p = Math.min(dist_pointer_this, dist_pointer_other) + 1;
        // make sure norm_p is never too close to zero (e.g. when snapping the bbox-corner that was grabbed), by incr. with 1
        const norm_t_other = Math.min(50.0, other_one.getTolerance());
        const norm_t_this = Math.min(50.0, this.getTolerance());
        dist_other = (w * dist_pointer_other) / norm_p + ((1 - w) * dist_other) / norm_t_other;
        dist_this = (w * dist_pointer_this) / norm_p + ((1 - w) * dist_this) / norm_t_this;
      }
    }

    // When snapping to a constraint line only, which is not really a snap but merely a projection
    // to the constraint line, then give this snap a very low priority. Basically, any other snap will do
    if (other_one.getTarget() === SnapTargetType.SNAPTARGET_CONSTRAINT) dist_other += 1e6;
    if (this.getTarget() === SnapTargetType.SNAPTARGET_CONSTRAINT) dist_this += 1e6;

    // If it's closer
    const c1 = dist_other < dist_this;
    // or, if it's for a snapper with "always snap" turned on, and the previous wasn't
    const c2 = other_one.getAlwaysSnap() && !this.getAlwaysSnap();
    // But in no case fall back from a snapper with "always snap" on to one with "always snap" off
    const c2n = !other_one.getAlwaysSnap() && this.getAlwaysSnap();
    // or, if we have a fully constrained snappoint (e.g. to a node or an intersection), while the previous one was only partly constrained (e.g. to a line)
    const c3 =
      other_one.getFullyConstrained() && !other_one.getConstrainedSnap() && !this.getFullyConstrained(); // Do not consider constrained snaps here, because these will always be fully constrained anyway
    // But in no case fall back; (has less priority than c3n, so it is allowed to fall back when c3 is true, see below)
    const c3n = !other_one.getFullyConstrained() && this.getFullyConstrained() && !this.getConstrainedSnap();
    // When both are fully constrained AND coincident, then prefer nodes over intersections
    const d =
      other_one.getFullyConstrained() &&
      this.getFullyConstrained() &&
      L2(other_one.getPoint().sub(this.getPoint())) < 1e-9;
    const c4 = d && !other_one.getAtIntersection() && this.getAtIntersection();
    // But don't fall back...
    const c4n = d && other_one.getAtIntersection() && !this.getAtIntersection();
    // or, if it's just as close then consider the second distance ...
    const c5a = dist_other === dist_this;
    const c5b =
      other_one.getSecondSnapDistance() < this.getSecondSnapDistance() &&
      this.getSecondSnapDistance() < Number.POSITIVE_INFINITY;
    // ... or prefer free snaps over constrained snaps
    const c5c = !other_one.getConstrainedSnap() && this.getConstrainedSnap();

    return (c1 || c2 || c3 || c4 || (c5a && (c5b || c5c))) && !c2n && (!c3n || c2) && !c4n;
  }

  /** True if the snapped point is on a path (or on a line); false for e.g. bounding box edges, page border, and text baseline. */
  getOnPath(): boolean {
    return SNAPTARGETS_ON_PATH.includes(this._target);
  }
}

const SNAPTARGETS_ON_PATH: readonly SnapTargetType[] = [
  SnapTargetType.SNAPTARGET_LINE_MIDPOINT,
  SnapTargetType.SNAPTARGET_PATH,
  SnapTargetType.SNAPTARGET_PATH_PERPENDICULAR,
  SnapTargetType.SNAPTARGET_PATH_TANGENTIAL,
  SnapTargetType.SNAPTARGET_PATH_INTERSECTION,
  SnapTargetType.SNAPTARGET_PATH_GUIDE_INTERSECTION,
  SnapTargetType.SNAPTARGET_PATH_CLIP,
  SnapTargetType.SNAPTARGET_PATH_MASK,
  SnapTargetType.SNAPTARGET_ELLIPSE_QUADRANT_POINT,
];

/**
 * The closest snapped point of list, or null (upstream getClosestSP).
 * TODO: the preference for non-alignment snaps and the merge of alignment and distribution snaps.
 */
export function getClosestSP(list: readonly SnappedPoint[]): SnappedPoint | null {
  let result: SnappedPoint | null = null;
  for (const i of list) {
    if (!result || i.getSnapDistance() < result.getSnapDistance()) result = i;
  }
  return result;
}
