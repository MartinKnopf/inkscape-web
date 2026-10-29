// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path/path-curve.cpp, src/path/path-curve.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Johan Engelen
 *
 * Copyright (C) 2000 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2002 Lauris Kaplinski
 * Copyright (C) 2008 Johan Engelen
 */
import {
  are_near,
  CubicBezier,
  type Curve,
  LineSegment,
  Path,
  type PathVector,
  type Point,
} from '@inkscape-web/geom';

/**
 * Close path: a final line segment is replaced by the closing segment, else
 * the last curve is moved to end at the initial point.
 */
export function closepath_current(path: Path): void {
  const last = path.openCurves()[path.sizeOpen() - 1];
  if (last instanceof LineSegment) {
    path.erase_last();
  } else {
    path.setFinal(path.initialPoint());
  }
  path.close();
}

/** Whether all subpaths are closed. Returns false if the curve is empty. */
export function is_closed(pathv: PathVector): boolean {
  if (pathv.length === 0) return false;
  return pathv.every((path) => path.closed());
}

/** The last curve of the last path (with the closing segment of a closed path), or null. */
export function get_last_segment(pathv: PathVector): Curve | null {
  const back = pathv[pathv.length - 1];
  if (!back || back.empty()) return null;
  const curves = back.curves();
  return curves[curves.length - 1] ?? null;
}

/** The first curve of the first path, or null. */
export function get_first_segment(pathv: PathVector): Curve | null {
  const front = pathv[0];
  if (!front || front.empty()) return null;
  return front.at(0);
}

/**
 * Append copies of the paths of pathv to to. With use_lineto, the first path
 * is joined to the last path of to with a line segment.
 */
export function pathvector_append(to: PathVector, pathv: PathVector, use_lineto = false): void {
  if (pathv.length === 0) return;
  const [first, ...rest] = pathv.map((p) => p.clone());
  if (use_lineto && to.length > 0 && first) {
    const lastpath = to[to.length - 1] as Path;
    lastpath.appendCurve(new LineSegment(lastpath.finalPoint(), first.initialPoint()));
    lastpath.append(first);
  } else if (first) {
    to.push(first);
  }
  to.push(...rest);
}

/**
 * Append pathv to to, continuing the last path of to when pathv starts within
 * tolerance of its end (else joined with a line segment). Returns false (and
 * does nothing) when either is closed.
 */
export function pathvector_append_continuous(to: PathVector, pathv: PathVector, tolerance = 0.0625): boolean {
  if (is_closed(to) || is_closed(pathv)) return false;
  if (pathv.length === 0) return true;
  if (to.length === 0) {
    to.push(...pathv.map((p) => p.clone()));
    return true;
  }
  const lastpath = to[to.length - 1] as Path;
  const first = pathv[0] as Path;
  const d = lastpath.finalPoint().sub(first.initialPoint());
  if (Math.max(Math.abs(d.x), Math.abs(d.y)) <= tolerance) {
    // c1's first subpath can be appended to this curve's last subpath
    const newfirstpath = first.clone();
    newfirstpath.setInitial(lastpath.finalPoint());
    lastpath.append(newfirstpath);
    to.push(...pathv.slice(1).map((p) => p.clone()));
  } else {
    pathvector_append(to, pathv, true);
  }
  return true;
}

/** Remove the last segment of the last path; the path becomes open. */
export function backspace(pathv: PathVector | Path): void {
  const path = pathv instanceof Path ? pathv : pathv[pathv.length - 1];
  if (path && !path.empty()) {
    path.erase_last();
    path.close(false);
  }
}

/** Add p to the last point (and last handle if present) of the last path. */
export function last_point_additive_move(pathv: PathVector, p: Point): void {
  const back = pathv[pathv.length - 1];
  if (!back) return;
  const last = back.openCurves()[back.sizeOpen() - 1];
  // Move handle as well when the last segment is a cubic bezier segment:
  if (last instanceof CubicBezier) {
    const [p0, p1, p2, p3] = last.controlPoints() as [Point, Point, Point, Point];
    back.erase_last();
    back.appendCurve(new CubicBezier(p0, p1, p2.add(p), p3.add(p)));
  } else {
    back.setFinal(back.finalPoint().add(p));
  }
}

/** An open path of the single curve. */
export function path_from_curve(curve: Curve): Path {
  const path = new Path(curve.initialPoint());
  path.appendCurve(curve);
  return path;
}

/** Number of nodes of pathv, as the node tool shows them. TODO: the other helpers of path-curve. */
export function node_count(pathv: PathVector): number {
  let nr = 0;
  for (const path of pathv) {
    // if the path does not have any segments, it is a naked moveto,
    // and therefore any path has at least one valid node
    const sizeClosed = path.sizeClosed();
    nr += Math.max(1, sizeClosed);
    if (path.closed() && sizeClosed > 0) {
      // The last non-degenerate curve (upstream back_closed()).
      const closingline = sizeClosed > path.sizeOpen() ? path.closingSegment() : path.at(sizeClosed - 1);
      // the closing line segment has zero-length (within rounding errors). So stop before that one!
      if (are_near(closingline.initialPoint(), closingline.finalPoint())) nr -= 1;
    }
  }
  return nr;
}

/** Move the start and end of the first path (upstream move_endpoints). */
export function move_endpoints(pathv: PathVector | Path, new_p0: Point, new_p1: Point): void {
  const path = pathv instanceof Path ? pathv : pathv[0];
  if (!path) return;
  path.setInitial(new_p0);
  path.setFinal(new_p1);
}
