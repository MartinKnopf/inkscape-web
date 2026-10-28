// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/helper/geom.cpp, src/helper/geom.h, src/helper/geom-curves.h
/*
 * Specific geometry functions for Inkscape, not provided my lib2geom.
 *
 * Author:
 *   Johan Engelen <goejendaagh@zonnet.nl>
 *
 * Copyright (C) 2008 Johan Engelen
 */
import {
  type Affine,
  are_near,
  BezierCurve,
  CubicBezier,
  type Curve,
  EllipticalArc,
  LineSegment,
  Path,
  type PathVector,
  Point,
} from '@inkscape-web/geom';

/**
 * Whether c is a line, or a Bezier curve whose control points lie on the line
 * through its end points (upstream is_straight_curve).
 */
export function is_straight_curve(c: Curve): boolean {
  if (c instanceof LineSegment) return true;
  if (!(c instanceof BezierCurve)) return false;
  const a = c.initialPoint();
  const d = c.finalPoint().sub(a);
  const len = d.length();
  for (let i = 1; i < c.order(); i++) {
    const v = c.controlPoint(i).sub(a);
    // Distance of the control point from the line.
    const dist = len === 0 ? v.length() : Math.abs(d.cross(v)) / len;
    if (!are_near(dist, 0)) return false;
  }
  return true;
}

/**
 * The path vector with all segments converted to lines and cubic Bezier curves
 * (upstream pathv_to_linear_and_cubic_beziers). Quadratic curves are elevated
 * to cubics; elliptical arcs are approximated with one cubic per quarter turn
 * (upstream converts other curves with cubicbezierpath_from_sbasis).
 */
export function pathv_to_linear_and_cubic_beziers(pathv: readonly Path[]): PathVector {
  const output: PathVector = [];
  for (const pit of pathv) {
    const out = new Path(pit.initialPoint());
    output.push(out);
    for (const cit of pit.openCurves()) {
      if (is_straight_curve(cit)) {
        out.appendCurve(new LineSegment(cit.initialPoint(), cit.finalPoint()));
      } else if (cit instanceof BezierCurve && cit.order() === 3) {
        const [p0, p1, p2, p3] = cit.controlPoints() as [Point, Point, Point, Point];
        out.appendCurve(new CubicBezier(p0, p1, p2, p3));
      } else if (cit instanceof BezierCurve && cit.order() === 2) {
        const [p0, q, p2] = cit.controlPoints() as [Point, Point, Point];
        out.appendCurve(new CubicBezier(p0, p0.lerp(2 / 3, q), p2.lerp(2 / 3, q), p2));
      } else if (cit instanceof EllipticalArc) {
        for (const c of arc_to_cubics(cit)) out.appendCurve(c);
      }
    }
    out.close(pit.closed());
  }
  return output;
}

/** Cubic Bezier approximation of an elliptical arc, one curve per quarter turn or less. */
function arc_to_cubics(arc: EllipticalArc): CubicBezier[] {
  const sweep = arc.angularExtent() * (arc.sweep() ? 1 : -1);
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const m: Affine = arc.unitCircleTransform();
  const start = arc.initialAngle().radians();
  const result: CubicBezier[] = [];
  let prev = arc.initialPoint();
  for (let i = 0; i < n; i++) {
    const a0 = start + i * step;
    const a1 = a0 + step;
    const u0 = new Point(Math.cos(a0), Math.sin(a0));
    const u1 = new Point(Math.cos(a1), Math.sin(a1));
    const c1 = u0.add(new Point(-u0.y, u0.x).mul(k)).transformed(m);
    const c2 = u1.sub(new Point(-u1.y, u1.x).mul(k)).transformed(m);
    const end = i === n - 1 ? arc.finalPoint() : u1.transformed(m);
    result.push(new CubicBezier(prev, c1, c2, end));
    prev = end;
  }
  return result;
}
