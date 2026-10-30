// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/line-geometry.cpp, src/line-geometry.h
/*
 * Routines for dealing with lines (intersections, etc.)
 *
 * Authors:
 *   Maximilian Albert <Anhalter42@gmx.de>
 *
 * Copyright (C) 2007 authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { atan2, dot, L2, Point, type Rect, unit_vector } from '@inkscape-web/geom';
import { Box3D } from './axis-manip.ts';

/** A line through pt with direction v_dir (upstream Box3D::Line). */
export class Line {
  protected pt: Point;
  protected v_dir: Point;
  protected normal: Point;
  protected d0: number;

  /**
   * Draw a line beginning at 'start'. If is_endpoint is true, use 'vec' as the endpoint
   * of the segment. Otherwise interpret it as the direction of the line.
   */
  constructor(start: Point, vec: Point, is_endpoint = true) {
    this.pt = start;
    this.v_dir = is_endpoint ? vec.sub(start) : vec;
    this.normal = this.v_dir.ccw();
    this.d0 = dot(this.normal, this.pt);
  }

  intersect(line: Line): Point | null {
    const denom = dot(this.v_dir, line.normal);
    if (Math.abs(denom) < 1e-6) return null;
    const lambda = (line.d0 - dot(this.pt, line.normal)) / denom;
    return this.pt.add(this.v_dir.mul(lambda));
  }

  direction(): Point {
    return this.v_dir;
  }

  protected set_direction(dir: Point): void {
    this.v_dir = dir;
    this.normal = this.v_dir.ccw();
    this.d0 = dot(this.normal, this.pt);
  }

  /** The point on the line closest to pt. */
  closest_to(pt: Point): Point {
    /* return the intersection of this line with a perpendicular line passing through pt */
    return this.intersect(new Line(pt, this.v_dir.ccw(), false)) ?? new Point(0.0, 0.0);
  }

  /** The intersection with the border of area (upstream: the display area of the desktop). */
  intersection_with_viewbox(vb: Rect): Point | null {
    const e = side_of_intersection(
      vb.corner(0),
      vb.corner(1),
      vb.corner(2),
      vb.corner(3),
      this.pt,
      this.v_dir,
    );
    // perspective line lies outside the canvas
    if (e[0].equals(e[1])) return null;
    return this.intersect(new Line(e[0], e[1]));
  }

  lie_on_same_side(A: Point, B: Point): boolean {
    /* If A is a point in the plane and n is the normal vector of the line then
       the sign of dot(A, n) specifies the half-plane in which A lies.
       Thus A and B lie on the same side if the dot products have equal sign. */
    return (dot(A, this.normal) - this.d0) * (dot(B, this.normal) - this.d0) > 0;
  }

  lambda(pt: Point): number {
    const sign = dot(pt.sub(this.pt), this.v_dir) > 0 ? 1.0 : -1.0;
    const lambda = sign * L2(pt.sub(this.pt));
    // FIXME: It may speed things up (but how much?) if we assume that
    //        pt lies on the line and thus skip the following test
    const test = this.point_from_lambda(lambda);
    if (!pts_coincide(pt, test)) {
      console.warn('Point does not lie on line.');
      return 0;
    }
    return lambda;
  }

  point_from_lambda(lambda: number): Point {
    return this.pt.add(unit_vector(this.v_dir).mul(lambda));
  }
}

function pts_coincide(pt1: Point, pt2: Point): boolean {
  return L2(pt2.sub(pt1)) < Box3D.epsilon;
}

export function determinant(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

/* The coordinates of w with respect to the basis {v1, v2} */
export function coordinates(v1: Point, v2: Point, w: Point): [number, number] {
  const det = determinant(v1, v2);
  // vectors are not linearly independent; we indicate this in the return value(s)
  if (Math.abs(det) < Box3D.epsilon) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  return [determinant(w, v2) / det, determinant(v1, w) / det];
}

/* whether w lies inside the sector spanned by v1 and v2 */
export function lies_in_sector(v1: Point, v2: Point, w: Point): boolean {
  const coords = coordinates(v1, v2, w);
  if (coords[0] === Number.POSITIVE_INFINITY) {
    // catch the case that the vectors are not linearly independent
    // FIXME: Can we assume that it's safe to return true if the vectors point in different directions?
    return dot(v1, v2) < 0;
  }
  return coords[0] >= 0 && coords[1] >= 0;
}

export function lies_in_quadrangle(A: Point, B: Point, C: Point, D: Point, pt: Point): boolean {
  return lies_in_sector(D.sub(A), B.sub(A), pt.sub(A)) && lies_in_sector(D.sub(C), B.sub(C), pt.sub(C));
}

function pos_angle(v: Point, w: Point): number {
  return Math.abs(atan2(v) - atan2(w));
}

/**
 * Returns the two corners of the quadrangle A, B, C, D spanning the edge that is hit by a semiline
 * starting at pt and going into direction dir.
 * If none of the sides is hit, it returns a pair containing two identical points.
 */
export function side_of_intersection(
  A: Point,
  B: Point,
  C: Point,
  D: Point,
  pt: Point,
  dir: Point,
): [Point, Point] {
  const corners = [A, B, C, D];
  let result: [Point, Point] = [A, A];
  let angle = -1;
  for (let i = 0; i < 4; i++) {
    const p = corners[i]!;
    const q = corners[(i + 1) % 4]!;
    const dir_p = p.sub(pt);
    const dir_q = q.sub(pt);
    if (!lies_in_sector(dir_p, dir_q, dir)) continue;
    const tmp_angle = pos_angle(dir_p, dir_q);
    if (tmp_angle > angle) {
      angle = tmp_angle;
      result = [p, q];
    }
  }
  // no intersection found; return a pair containing two identical points
  return angle === -1 ? [A, A] : result;
}
