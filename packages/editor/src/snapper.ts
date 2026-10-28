// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/snapper.cpp, src/snapper.h
/*
 * Authors:
 *   Mathieu Dimanche <mdimanche@free.fr>
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *
 * Copyright (C) 2006-2007 Johan Engelen <johan@shouraizou.nl>
 * Copyright (C) 2000-2002 Lauris Kaplinski
 */
import type { SnapCandidatePoint, SnapSourceType, SPObject } from '@inkscape-web/core';
import { cross, dot, L2, type OptRect, Point } from '@inkscape-web/geom';
import type { SnapManager } from './snap.ts';
import type { SnappedCurve } from './snapped-curve.ts';
import type { SnappedLine } from './snapped-line.ts';
import type { SnappedPoint } from './snapped-point.ts';

/** The snap results that the snappers collect, before SnapManager.findBestSnap() picks one. */
export interface IntermSnapResults {
  points: SnappedPoint[];
  grid_lines: SnappedLine[];
  guide_lines: SnappedLine[];
  curves: SnappedCurve[];
}

export function newIntermSnapResults(): IntermSnapResults {
  return { points: [], grid_lines: [], guide_lines: [], curves: [] };
}

/** The projection of p on the infinite line through p1 and p2 (upstream Geom::projection(p, Line)). */
export function projection(p: Point, p1: Point, p2: Point): Point {
  const d = p2.sub(p1);
  const l2 = dot(d, d);
  if (l2 === 0) return p1;
  return p1.add(d.mul(dot(p.sub(p1), d) / l2));
}

/**
 * The intersection of the line through a with direction da and the line
 * through b with direction db, or null for parallel lines (upstream Geom::intersection of two Lines).
 */
export function lineIntersection(a: Point, da: Point, b: Point, db: Point): Point | null {
  const denom = cross(da, db);
  if (Math.abs(denom) < 1e-12 * L2(da) * L2(db)) return null;
  const t = cross(b.sub(a), db) / denom;
  return a.add(da.mul(t));
}

enum SnapConstraintType {
  LINE,
  DIRECTION,
  CIRCLE,
  UNDEFINED,
}

/**
 * The constraint of a constrained snap: a line (through a point, in a
 * direction), a direction (a line through the point to snap), or a circle
 * (center, the vector from the center to the original point, radius).
 */
export class SnapConstraint {
  readonly #point: Point;
  readonly #direction: Point;
  readonly #radius: number;
  readonly #type: SnapConstraintType;

  private constructor(point: Point, direction: Point, radius: number, type: SnapConstraintType) {
    this.#point = point;
    this.#direction = direction;
    this.#radius = radius;
    this.#type = type;
  }

  /** A direction constraint, e.g. horizontal or vertical but without a specified point. */
  static direction(d: Point): SnapConstraint {
    return new SnapConstraint(new Point(0, 0), d, 0, SnapConstraintType.DIRECTION);
  }
  /** A linear constraint through p in direction d. */
  static line(p: Point, d: Point): SnapConstraint {
    return new SnapConstraint(p, d, 0, SnapConstraintType.LINE);
  }
  /** A circular constraint. */
  static circle(p: Point, d: Point, r: number): SnapConstraint {
    return new SnapConstraint(p, d, r, SnapConstraintType.CIRCLE);
  }
  /** Undefined, or empty constraint. */
  static undefined(): SnapConstraint {
    return new SnapConstraint(new Point(0, 0), new Point(0, 0), 0, SnapConstraintType.UNDEFINED);
  }

  hasPoint(): boolean {
    return this.#type !== SnapConstraintType.DIRECTION && this.#type !== SnapConstraintType.UNDEFINED;
  }
  getPoint(): Point {
    return this.#point;
  }
  getDirection(): Point {
    return this.#direction;
  }
  getRadius(): number {
    return this.#radius;
  }
  isCircular(): boolean {
    return this.#type === SnapConstraintType.CIRCLE;
  }
  isLinear(): boolean {
    return this.#type === SnapConstraintType.LINE;
  }
  isDirection(): boolean {
    return this.#type === SnapConstraintType.DIRECTION;
  }
  isUndefined(): boolean {
    return this.#type === SnapConstraintType.UNDEFINED;
  }

  /** The projection of p on this constraint. */
  projection(p: Point): Point {
    if (this.#type === SnapConstraintType.CIRCLE) {
      // project on to a circular constraint
      const v_orig = p.sub(this.#point);
      const l = L2(v_orig);
      if (l > 0) return this.#point.add(v_orig.mul(this.#radius / l)); // Length of _direction is equal to the radius
      // point to be projected is exactly at the center of the circle, so any point on the circle is a projection
      return this.#point.add(new Point(this.#radius, 0));
    }
    if (this.#type !== SnapConstraintType.UNDEFINED) {
      // project on to a linear constraint
      const p1_on_cl = this.#type === SnapConstraintType.LINE ? this.#point : p;
      return projection(p, p1_on_cl, p1_on_cl.add(this.#direction));
    }
    console.warn('WARNING: Bug: trying to find the projection onto an undefined constraint');
    return new Point(0, 0);
  }
}

/** Parent for classes that can snap points to something (upstream Snapper). */
export abstract class Snapper {
  protected readonly _snapmanager: SnapManager;
  /** True if this snapper is enabled (only used for grids, for which snapping can be enabled individually). */
  protected _snap_enabled = true;
  protected _snap_visible_only = true;

  constructor(sm: SnapManager) {
    this._snapmanager = sm;
  }

  /** The tolerance of the snapper in desktop units (the screen px tolerance divided by the zoom). */
  abstract getSnapperTolerance(): number;
  /** If true, then the snapper will always snap, regardless of its tolerance. */
  abstract getSnapperAlwaysSnap(source: SnapSourceType): boolean;

  /** True if this Snapper will snap at least one kind of point. */
  ThisSnapperMightSnap(): boolean {
    return this._snap_enabled;
  }

  setEnabled(s: boolean): void {
    this._snap_enabled = s;
  }
  setSnapVisibleOnly(s: boolean): void {
    this._snap_visible_only = s;
  }
  getEnabled(): boolean {
    return this._snap_enabled;
  }
  getSnapVisibleOnly(): boolean {
    return this._snap_visible_only;
  }

  freeSnap(
    _isr: IntermSnapResults,
    _p: SnapCandidatePoint,
    _bbox_to_snap: OptRect,
    _it: readonly SPObject[] | null,
    _unselected_nodes: readonly SnapCandidatePoint[] | null,
  ): void {}

  constrainedSnap(
    _isr: IntermSnapResults,
    _p: SnapCandidatePoint,
    _bbox_to_snap: OptRect,
    _c: SnapConstraint,
    _it: readonly SPObject[] | null,
    _unselected_nodes: readonly SnapCandidatePoint[] | null,
  ): void {}
}
