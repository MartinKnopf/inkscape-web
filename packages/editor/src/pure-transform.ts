// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/pure-transform.cpp, src/pure-transform.h
/*
 * Class for pure transformations, such as translating, scaling, stretching, skewing, and rotating
 *
 * Authors:
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *
 * Copyright (C) 2015 Diederik van Lierop
 */
import { SnapCandidatePoint, SnapTargetType } from '@inkscape-web/core';
import { type Dim2, L2, type OptRect, Point, Rect } from '@inkscape-web/geom';
import type { SnapManager } from './snap.ts';
import { SnappedPoint } from './snapped-point.ts';
import { SnapConstraint } from './snapper.ts';

/**
 * A transformation of a set of points that SnapManager.snapTransformed()
 * snaps: each transformed point is snapped, the best snap wins, and the
 * transformation that moves its point there is stored.
 * TODO: skew and rotate (PureSkewConstrained, PureRotateConstrained).
 */
export abstract class PureTransform {
  best_snapped_point = new SnappedPoint();

  /** Snap one transformed point p (pt_orig is the point before the transform). */
  protected abstract _snap(
    sm: SnapManager,
    p: SnapCandidatePoint,
    pt_orig: Point,
    bbox_to_snap: OptRect,
  ): SnappedPoint;
  protected abstract getTransformedPoint(p: SnapCandidatePoint): Point;
  protected abstract storeTransform(original_point: SnapCandidatePoint, snapped_point: SnappedPoint): void;

  snap(sm: SnapManager, points: readonly SnapCandidatePoint[], pointer: Point): void {
    let bbox: Rect | null = null;
    const transformed_points = points.map((i, source_num) => {
      /* Work out the transformed version of this point */
      const transformed = this.getTransformedPoint(i);
      // add the current transformed point to the box hulling all transformed points
      bbox = bbox ? bbox.expandTo(transformed) : new Rect(transformed, transformed);
      return new SnapCandidatePoint(
        transformed,
        i.getSourceType(),
        SnapTargetType.SNAPTARGET_UNDEFINED,
        source_num,
      );
    });

    let best_original_point: SnapCandidatePoint | null = null;
    let first_free_snap = true;
    points.forEach((i, n) => {
      const j = transformed_points[n] as SnapCandidatePoint;
      // The object snapper only collects the target nodes for source_num == 0. Therefore we enforce that
      // the first SnapCandidatePoint that is to be snapped always has source_num == 0;
      if (first_free_snap) {
        j.setSourceNum(0);
        first_free_snap = false;
      }
      const snapped_point = this._snap(sm, j, i.getPoint(), bbox);
      snapped_point.setPointerDistance(L2(pointer.sub(i.getPoint())));
      // Find the transformation that describes where the snapped point has
      // ended up, and also the metric for this transformation.
      let store_best_snap = false;
      if (snapped_point.getSnapped()) {
        // We snapped; keep track of the best snap
        if (this.best_snapped_point.isOtherSnapBetter(snapped_point, true)) store_best_snap = true;
      } else if (!this.best_snapped_point.getSnapped()) {
        // So we didn't snap for this point, and none of the points before snapped either.
        // We might still need to apply a constraint though, so keep track of the best non-snapped constrained point.
        if (this.best_snapped_point.isOtherSnapBetter(snapped_point, true)) store_best_snap = true;
      }
      if (store_best_snap || n === 0) {
        best_original_point = i;
        // Can be a point that didn't snap, but then at least we return something meaningful
        this.best_snapped_point = snapped_point;
      }
    });

    if (best_original_point) this.storeTransform(best_original_point, this.best_snapped_point);
    // Using " < 1e6" instead of " < Geom::infinity()" for catching some rounding errors
    const best_metric = this.best_snapped_point.getSnapDistance();
    this.best_snapped_point.setSnapDistance(best_metric < 1e6 ? best_metric : Number.POSITIVE_INFINITY);
  }
}

/** A translation by a vector. */
export class PureTranslate extends PureTransform {
  protected _vector: Point;
  protected _vector_snapped: Point;

  constructor(vector: Point = new Point(0, 0)) {
    super();
    this._vector = vector;
    this._vector_snapped = vector;
  }

  getTranslationSnapped(): Point {
    return this._vector_snapped;
  }

  protected getTransformedPoint(p: SnapCandidatePoint): Point {
    return p.getPoint().add(this._vector);
  }

  protected storeTransform(original_point: SnapCandidatePoint, snapped_point: SnappedPoint): void {
    // Only for translations, the relevant metric will be the real snapped distance,
    // so we don't have to do anything special here
    this._vector_snapped = snapped_point.getPoint().sub(original_point.getPoint());
  }

  protected _snap(
    sm: SnapManager,
    p: SnapCandidatePoint,
    _pt_orig: Point,
    bbox_to_snap: OptRect,
  ): SnappedPoint {
    return sm.freeSnap(p, bbox_to_snap);
  }
}

/** A translation along one axis (direction). */
export class PureTranslateConstrained extends PureTranslate {
  readonly #direction: Dim2;

  constructor(displacement: number, direction: Dim2) {
    super(direction === 0 ? new Point(displacement, 0) : new Point(0, displacement));
    this.#direction = direction;
  }

  protected override _snap(
    sm: SnapManager,
    p: SnapCandidatePoint,
    pt_orig: Point,
    bbox_to_snap: OptRect,
  ): SnappedPoint {
    // When doing a constrained translation, all points will move in the same direction, i.e.
    // either horizontally or vertically. The lines along which they move are therefore all
    // parallel, but might not be co-linear. Therefore we will have to specify the point through
    // which the constraint-line runs here, for each point individually.
    const dir = this.#direction === 0 ? new Point(1, 0) : new Point(0, 1);
    return sm.constrainedSnap(p, SnapConstraint.line(pt_orig, dir), bbox_to_snap);
  }
}

/** A scale by (sx, sy) around an origin; uniform keeps the aspect ratio of the snapped scale. */
export class PureScale extends PureTransform {
  protected _scale: Point;
  protected _scale_snapped: Point;
  protected _origin: Point;
  protected _uniform: boolean;

  constructor(scale: Point, origin: Point, uniform: boolean) {
    super();
    this._scale = scale;
    this._scale_snapped = scale;
    this._origin = origin;
    this._uniform = uniform;
  }

  getScaleSnapped(): Point {
    return this._scale_snapped;
  }

  protected getTransformedPoint(p: SnapCandidatePoint): Point {
    return p.getPoint().sub(this._origin).scaled(this._scale).add(this._origin);
  }

  protected storeTransform(original_point: SnapCandidatePoint, snapped_point: SnappedPoint): void {
    const snapped: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    // If this point *i is horizontally or vertically aligned with
    // the origin of the scaling, then it will scale purely in X or Y
    // We can therefore only calculate the scaling in this direction
    // and the scaling factor for the other direction should remain
    // untouched (unless scaling is uniform of course)
    const a = snapped_point.getPoint().sub(this._origin); // vector to snapped point
    const b = original_point.getPoint().sub(this._origin); // vector to original point (not the transformed point!)
    for (const index of [0, 1] as const) {
      // if SCALING CAN occur in this direction
      if (Math.abs(b.at(index)) > 1e-4) {
        // if SNAPPING DID occur in this direction
        if (Math.abs(Math.abs(a.at(index) / b.at(index)) - Math.abs(this._scale.at(index))) > 1e-7) {
          snapped[index] = a.at(index) / b.at(index); // then calculate it!
        }
        // we might have left result[1-index] = Geom::infinity() if scaling didn't occur in the other direction
      }
    }
    if (snapped[0] === Number.POSITIVE_INFINITY && snapped[1] === Number.POSITIVE_INFINITY) {
      // This point must have been at the origin, so we cannot possibly snap; it won't scale (i.e. won't move while dragging)
      this._scale_snapped = new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
      snapped_point.setSnapDistance(Number.POSITIVE_INFINITY);
      snapped_point.setSecondSnapDistance(Number.POSITIVE_INFINITY);
      return;
    }
    if (this._uniform) {
      // Lock the scaling the be uniform, but keep the sign such that we don't change which quadrant we have dragged into
      if (Math.abs(snapped[0]) < Math.abs(snapped[1]))
        snapped[1] = Math.abs(snapped[0]) * Math.sign(this._scale.y);
      else snapped[0] = Math.abs(snapped[1]) * Math.sign(this._scale.x);
    }
    // Don't ever exit with one of scaling components uninitialized
    for (const index of [0, 1] as const) {
      if (snapped[index] === Number.POSITIVE_INFINITY) snapped[index] = this._scale.at(index);
    }
    this._scale_snapped = new Point(snapped[0], snapped[1]);
    // Compare the resulting scaling with the desired scaling
    const scale_metric = this._scale_snapped.sub(this._scale);
    snapped_point.setSnapDistance(L2(scale_metric));
    snapped_point.setSecondSnapDistance(Number.POSITIVE_INFINITY);
  }

  // When scaling, a point aligned either horizontally or vertically with the origin can only
  // move in that specific direction; therefore it should only snap in that direction, so this
  // then becomes a constrained snap; otherwise we can use a free snap;
  protected _snap(
    sm: SnapManager,
    p: SnapCandidatePoint,
    pt_orig: Point,
    bbox_to_snap: OptRect,
  ): SnappedPoint {
    const b = pt_orig.sub(this._origin); // vector to original point (not the transformed point!)
    const c1 = Math.abs(b.x) < 1e-6;
    const c2 = Math.abs(b.y) < 1e-6;
    if ((c1 || c2) && !(c1 && c2)) {
      const cvec = c1 ? new Point(0, 1) : new Point(1, 0);
      return sm.constrainedSnap(p, SnapConstraint.line(this._origin, cvec), bbox_to_snap);
    }
    return sm.freeSnap(p, bbox_to_snap);
  }
}

/** A uniform scale where each point moves along the line from the origin (Ctrl). */
export class PureScaleConstrained extends PureScale {
  constructor(scale: Point, origin: Point) {
    super(scale, origin, true); // Non-uniform constrained scaling is not supported
  }

  protected override _snap(
    sm: SnapManager,
    p: SnapCandidatePoint,
    pt_orig: Point,
    bbox_to_snap: OptRect,
  ): SnappedPoint {
    // When uniformly scaling, each point will have its own unique constraint line,
    // running from the scaling origin to the original untransformed point.
    const b = pt_orig.sub(this._origin);
    return sm.constrainedSnap(p, SnapConstraint.line(this._origin, b), bbox_to_snap);
  }
}

/** A stretch along one axis (direction) by magnitude; uniform scales both axes. */
export class PureStretchConstrained extends PureTransform {
  readonly #magnitude: number;
  #stretch_snapped: Point;
  readonly #origin: Point;
  readonly #direction: Dim2;
  readonly #uniform: boolean;

  constructor(magnitude: number, origin: Point, direction: Dim2, uniform: boolean) {
    super();
    this.#magnitude = magnitude;
    this.#origin = origin;
    this.#direction = direction;
    this.#uniform = uniform;
    this.#stretch_snapped = this.#scale(magnitude);
  }

  getStretchSnapped(): Point {
    return this.#stretch_snapped;
  }
  getMagnitude(): number {
    return this.#magnitude;
  }
  getMagnitudeSnapped(): number {
    return this.#stretch_snapped.at(this.#direction);
  }

  #scale(m: number): Point {
    if (this.#uniform) return new Point(m, m);
    return this.#direction === 0 ? new Point(m, 1) : new Point(1, m);
  }

  protected getTransformedPoint(p: SnapCandidatePoint): Point {
    return p.getPoint().sub(this.#origin).scaled(this.#scale(this.#magnitude)).add(this.#origin);
  }

  protected _snap(
    sm: SnapManager,
    p: SnapCandidatePoint,
    pt_orig: Point,
    bbox_to_snap: OptRect,
  ): SnappedPoint {
    let constraint: SnapConstraint;
    if (this.#uniform) {
      // When uniformly stretching, each point will have its own unique constraint line,
      // running from the scaling origin to the original untransformed point.
      constraint = SnapConstraint.line(this.#origin, pt_orig.sub(this.#origin));
    } else {
      constraint = SnapConstraint.line(pt_orig, this.#direction === 0 ? new Point(1, 0) : new Point(0, 1));
    }
    return sm.constrainedSnap(p, constraint, bbox_to_snap);
  }

  protected storeTransform(original_point: SnapCandidatePoint, snapped_point: SnappedPoint): void {
    const a = snapped_point.getPoint().sub(this.#origin); // vector to snapped point
    const b = original_point.getPoint().sub(this.#origin); // vector to original point (not the transformed point!)
    const d = this.#direction;
    const o = (1 - d) as Dim2;
    const s: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    if (Math.abs(b.at(d)) > 1e-4) {
      // if STRETCHING will occur for this point
      s[d] = a.at(d) / b.at(d);
      s[o] = this.#uniform ? s[d] : 1;
    } else if (this.#uniform && Math.abs(b.at(o)) > 1e-4) {
      // STRETCHING might occur for this point, but only when the stretching is uniform
      s[o] = a.at(o) / b.at(o);
      s[d] = s[o];
    }
    this.#stretch_snapped = new Point(s[0], s[1]);
    // _stretch_snapped might have one or both components at infinity!
    // Store the metric for this transformation as a virtual distance
    snapped_point.setSnapDistance(Math.abs(s[d] - this.#magnitude));
    snapped_point.setSecondSnapDistance(Number.POSITIVE_INFINITY);
  }
}
