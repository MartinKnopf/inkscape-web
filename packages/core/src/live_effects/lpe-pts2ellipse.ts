// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-pts2ellipse.cpp, src/live_effects/lpe-pts2ellipse.h
/** \file
 * LPE <pts2ellipse> implementation
 */
/*
 * Authors:
 *   Markus Schwienbacher
 *
 * Copyright (C) Markus Schwienbacher 2020
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  type Affine,
  atan2,
  Circle,
  CubicBezier,
  cross,
  dot,
  Ellipse,
  HShear,
  LineSegment,
  middle_point,
  Path,
  type PathVector,
  Point,
  Rotate,
  Scale,
  solveLeastSquares,
  Translate,
  unit_vector,
  X,
  Y,
} from '@inkscape-web/geom';
import { _, N_ } from '../i18n.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { ScalarParam } from './parameter/parameter.ts';

export enum EllipseMethod {
  EM_AUTO, // (2..4 points: circle, from 5 points: ellipse)
  EM_CIRCLE, // always fit a circle
  EM_ISOMETRIC_CIRCLE, // use first two edges to generate a sheared ellipse
  EM_PERSPECTIVE_CIRCLE, // use first three edges to generate an ellipse representing a distorted circle in perspective
  EM_STEINER_ELLIPSE, // generate a steiner ellipse from the first three points
  EM_STEINER_INELLIPSE, // generate a steiner inellipse from the first three points
  EM_END,
}

const EMConverter = new EnumDataConverter<EllipseMethod>(
  [
    { id: EllipseMethod.EM_AUTO, label: N_('Auto ellipse'), key: 'auto' },
    { id: EllipseMethod.EM_CIRCLE, label: N_('Force circle'), key: 'circle' },
    { id: EllipseMethod.EM_ISOMETRIC_CIRCLE, label: N_('Isometric circle'), key: 'iso_circle' },
    { id: EllipseMethod.EM_PERSPECTIVE_CIRCLE, label: N_('Perspective circle'), key: 'perspective_circle' },
    { id: EllipseMethod.EM_STEINER_ELLIPSE, label: N_('Steiner ellipse'), key: 'steiner_ellipse' },
    { id: EllipseMethod.EM_STEINER_INELLIPSE, label: N_('Steiner inellipse'), key: 'steiner_inellipse' },
  ],
  EllipseMethod.EM_END,
);

// helper function, transforms a given value into range [0, 2pi]
const range2pi = (a: number): number => {
  a = a % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a;
};

const deg2rad = (a: number): number => (a * Math.PI) / 180.0;

// helper function, calculates the angle between a0 and a1 in ccw sense
// examples: 0..1->1, -1..1->2, pi/4..-pi/4->1.5pi
// full rotations: 0..2pi->2pi, -pi..pi->2pi, pi..-pi->0, 2pi..0->0
const calc_delta_angle = (a0: number, a1: number): number => {
  let da = range2pi(a1 - a0);
  if (Math.abs(da) < 1e-9 && a0 < a1) da = 2 * Math.PI;
  return da;
};

type ProjMatrix = readonly (readonly number[])[];

/** The 3x3 projection matrix applied to the point p (identical to lpe-perspective-envelope.cpp). */
function projectPoint(p: Point, m: ProjMatrix): Point {
  const [m0, m1, m2] = m as [number[], number[], number[]];
  const { x, y } = p;
  return new Point(
    (x * m0[0]! + y * m0[1]! + m0[2]!) / (x * m2[0]! + y * m2[1]! + m2[2]!),
    (x * m1[0]! + y * m1[1]! + m1[2]!) / (x * m2[0]! + y * m2[1]! + m2[2]!),
  );
}

/**
 * Whether the points are in counter clockwise order: the sum of the cross products of the
 * edges at the vertices is negative (the y axis points down).
 */
function is_ccw(pts: readonly Point[]): boolean {
  const n = pts.length;
  // edges about vertex 0
  let e0 = (pts[0] as Point).sub(pts[n - 1] as Point);
  let e1 = (pts[1] as Point).sub(pts[0] as Point);
  let sum = cross(e0, e1);
  // the rest
  for (let i = 1; i < n; i++) {
    e0 = e1;
    e1 = (pts[i] as Point).sub(pts[i - 1] as Point);
    sum += cross(e0, e1);
  }
  // edges about last vertex (closing)
  e0 = e1;
  e1 = (pts[0] as Point).sub(pts[n - 1] as Point);
  sum += cross(e0, e1);
  return sum < 0;
}

/** The start and end angle of an arc between the points p0 and p1 on the unit circle; [a0, a1] if they are the origin. */
function endpoints2angles(
  ccw_wind: boolean,
  use_other_arc: boolean,
  p0: Point,
  p1: Point,
  a0: number,
  a1: number,
): [number, number] {
  if (!p0.isZero() && !p1.isZero()) {
    a0 = atan2(p0);
    a1 = atan2(p1);
    if (!ccw_wind) [a0, a1] = [a1, a0];
    if (!use_other_arc) [a0, a1] = [a1, a0];
  }
  return [a0, a1];
}

/**
 * Circle, ellipse, arc or slice from points (upstream LPEPts2Ellipse): generates an ellipse (or
 * circle) from the vertices of a given path with fitting algorithms, or other constructions
 * (isometric, perspective, Steiner), depending on the settings.
 */
export class LPEPts2Ellipse extends Effect {
  readonly method: EnumParam<EllipseMethod>;
  readonly gen_isometric_frame: BoolParam;
  readonly gen_perspective_frame: BoolParam;
  readonly gen_arc: BoolParam;
  readonly other_arc: BoolParam;
  readonly slice_arc: BoolParam;
  readonly draw_axes: BoolParam;
  readonly draw_perspective_axes: BoolParam;
  readonly rot_axes: ScalarParam;
  readonly draw_ori_path: BoolParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.method = new EnumParam(
      _('Method:'),
      _(
        'Methods to generate the ellipse\n- Auto ellipse: fits a circle (2, 3 or 4 nodes in the path) or an ellipse (at least 5 nodes)\n- Force circle: (at least 2 nodes) always create a circle\n- Isometric circle: (3 nodes) use first two segments as edges\n- Perspective circle: (4 nodes) circle in a square in perspective view\n- Steiner ellipse: (3 nodes) ellipse on a triangle\n- Steiner inellipse: (3 nodes) ellipse inside a triangle',
      ),
      'method',
      EMConverter,
      this,
      EllipseMethod.EM_AUTO,
    );
    this.gen_isometric_frame = new BoolParam(
      _('_Frame (isometric rectangle)'),
      _('Draw parallelogram around the ellipse'),
      'gen_isometric_frame',
      this,
      false,
    );
    this.gen_perspective_frame = new BoolParam(
      _('_Perspective square'),
      _('Draw square surrounding the circle in perspective view\n(only in method "Perspective circle")'),
      'gen_perspective_frame',
      this,
      false,
    );
    this.gen_arc = new BoolParam(
      _('_Arc'),
      _(
        'Generate open arc (open ellipse) based on first and last node\n(only for methods "Auto ellipse" and "Force circle")',
      ),
      'gen_arc',
      this,
      false,
    );
    this.other_arc = new BoolParam(
      _('_Other arc side'),
      _('Switch sides of the arc'),
      'arc_other',
      this,
      false,
    );
    this.slice_arc = new BoolParam(
      _('_Slice arc'),
      _('Create a circle / ellipse segment'),
      'slice_arc',
      this,
      false,
    );
    this.draw_axes = new BoolParam(
      _('A_xes'),
      _('Draw both semi-major and semi-minor axes'),
      'draw_axes',
      this,
      false,
    );
    this.draw_perspective_axes = new BoolParam(
      _('Perspective axes'),
      _('Draw the axes in perspective view\n(only in method "Perspective circle")'),
      'draw_perspective_axes',
      this,
      false,
    );
    this.rot_axes = new ScalarParam(_('Axes rotation'), _('Axes rotation angle [deg]'), 'rot_axes', this, 0);
    this.draw_ori_path = new BoolParam(
      _('Source _path'),
      _('Show the original source path'),
      'draw_ori_path',
      this,
      false,
    );
    this.registerParameter(this.method);
    this.registerParameter(this.gen_arc);
    this.registerParameter(this.other_arc);
    this.registerParameter(this.slice_arc);
    this.registerParameter(this.gen_isometric_frame);
    this.registerParameter(this.draw_axes);
    this.registerParameter(this.gen_perspective_frame);
    this.registerParameter(this.draw_perspective_axes);
    this.registerParameter(this.rot_axes);
    this.registerParameter(this.draw_ori_path);

    this.rot_axes.param_set_range(-360, 360);
    this.rot_axes.param_set_increments(1, 10);

    this.show_orig_path = true;
  }

  /**
   * An arc of the unit circle from the angle start to end as cubic Beziers (at most a quarter circle
   * each), transformed by affine. Gives the closed path for a full circle or a slice, or null if the
   * angle is 0.
   */
  unit_arc_path(affine: Affine, start = 0.0, end = 2.0 * Math.PI, slice = false): Path | null {
    const arc_angle = calc_delta_angle(start, end);
    if (Math.abs(arc_angle) < 1e-9) {
      console.warn('angle was 0');
      return null;
    }

    // the delta angle
    let da = Math.PI / 2;
    // number of segments with da length
    let nda = Math.ceil(arc_angle / (Math.PI / 2));
    // recalculate da
    da = arc_angle / nda;

    let closed = false;
    if (Math.abs(arc_angle - 2 * Math.PI) < 1e-8) {
      closed = true;
      da = Math.PI / 2;
      nda = 4;
    }

    let s = range2pi(start);
    end = s + arc_angle;

    let x0 = Math.cos(s);
    let y0 = Math.sin(s);
    // construct the path
    let path = new Path(new Point(x0, y0));
    for (let i = 0; i < nda; ) {
      let e = s + da;
      if (e > end) e = end;
      const len = (4 * Math.tan((e - s) / 4)) / 3;
      const x1 = x0 + len * Math.cos(s + Math.PI / 2);
      const y1 = y0 + len * Math.sin(s + Math.PI / 2);
      const x3 = Math.cos(e);
      const y3 = Math.sin(e);
      const x2 = x3 + len * Math.cos(e - Math.PI / 2);
      const y2 = y3 + len * Math.sin(e - Math.PI / 2);
      // The path is stitching: the curve starts at the end of the last one.
      path.appendCurve(
        new CubicBezier(path.finalPoint(), new Point(x1, y1), new Point(x2, y2), new Point(x3, y3)),
      );
      s = ++i * da + start;
      x0 = Math.cos(s);
      y0 = Math.sin(s);
    }

    if (slice && !closed) path.appendCurve(new LineSegment(path.finalPoint(), new Point(0.0, 0.0)));
    path = path.transformed(affine);

    if ((slice && !closed) || closed) path.close(true);
    return path;
  }

  gen_iso_frame_paths(path_out: PathVector, affine: Affine): void {
    const rect = new Path(new Point(-1, -1));
    for (const p of [new Point(+1, -1), new Point(+1, +1), new Point(-1, +1)]) {
      rect.appendCurve(new LineSegment(rect.finalPoint(), p));
    }
    const transformed = rect.transformed(affine);
    transformed.close(true);
    path_out.push(transformed);
  }

  gen_perspective_frame_paths(path_out: PathVector, rot_angle: number, projmatrix: ProjMatrix): void {
    const pts0 = [new Point(-1.0, -1.0), new Point(+1.0, -1.0), new Point(+1.0, +1.0), new Point(-1.0, +1.0)];
    const affine2 = Rotate(-rot_angle);
    const pts = pts0.map((p) => projectPoint(p.transformed(affine2), projmatrix));

    const rect = new Path(pts[0] as Point);
    for (let i = 1; i < 4; i++) rect.appendCurve(new LineSegment(rect.finalPoint(), pts[i] as Point));
    rect.close(true);
    path_out.push(rect);
  }

  gen_axes_paths(path_out: PathVector, affine: Affine): void {
    for (const [a, b] of [
      [new Point(-1, 0), new Point(1, 0)],
      [new Point(0, -1), new Point(0, 1)],
    ] as const) {
      const p = new Path(a);
      p.appendCurve(new LineSegment(a, b));
      path_out.push(p.transformed(affine));
    }
  }

  gen_perspective_axes_paths(path_out: PathVector, rot_angle: number, projmatrix: ProjMatrix): void {
    const dA = (2.0 * Math.PI) / 4.0; // delta Angle
    const pts = [0, 1, 2, 3].map((h) => {
      const angle = rot_angle + dA * h;
      return projectPoint(new Point(Math.sin(angle), Math.cos(angle)), projmatrix);
    });
    for (const [a, b] of [
      [pts[0] as Point, pts[2] as Point],
      [pts[1] as Point, pts[3] as Point],
    ] as const) {
      const p = new Path(a);
      p.appendCurve(new LineSegment(a, b));
      path_out.push(p);
    }
  }

  /** The frame and the axes that the settings ask for. */
  #frame_and_axes(path_out: PathVector, affine: Affine): void {
    if (this.gen_isometric_frame.get_value()) this.gen_iso_frame_paths(path_out, affine);
    if (this.draw_axes.get_value()) this.gen_axes_paths(path_out, affine);
  }

  /**
   * Generates an ellipse (or circle) from the vertices of a given path, depending on the settings
   * made by the user regarding things like arc, slice, circle etc.
   */
  protected override doEffect_path(path_in: PathVector): PathVector {
    const path_out: PathVector = [];

    // 1) draw original path?
    if (this.draw_ori_path.get_value()) path_out.push(...path_in);

    // 2) get all points
    // (from: extension/internal/odf.cpp)
    const points: Point[] = [];
    for (const pit of path_in) {
      // extract first point of this path
      points.push(pit.initialPoint());
      // iterate over all curves
      for (const cit of pit.curves()) points.push(cit.finalPoint());
    }
    // avoid identical start-point and end-point
    if (points.length > 0 && (points[0] as Point).equals(points[points.length - 1] as Point)) points.pop();

    // 3) modify GUI based on selected method
    // 3.1) arc options
    const method = this.method.get_value();
    switch (method) {
      case EllipseMethod.EM_AUTO:
      case EllipseMethod.EM_CIRCLE:
        this.gen_arc.param_widget_is_enabled(true);
        if (this.gen_arc.get_value()) {
          this.slice_arc.param_widget_is_enabled(true);
          this.other_arc.param_widget_is_enabled(true);
        } else {
          this.other_arc.param_widget_is_enabled(false);
          this.slice_arc.param_widget_is_enabled(false);
        }
        break;
      default:
        this.gen_arc.param_widget_is_enabled(false);
        this.other_arc.param_widget_is_enabled(false);
        this.slice_arc.param_widget_is_enabled(false);
    }
    // 3.2) perspective options
    if (method === EllipseMethod.EM_PERSPECTIVE_CIRCLE) {
      this.gen_perspective_frame.param_widget_is_enabled(true);
      this.draw_perspective_axes.param_widget_is_enabled(true);
    } else {
      this.gen_perspective_frame.param_widget_is_enabled(false);
      this.draw_perspective_axes.param_widget_is_enabled(false);
    }

    // 4) call method specific code
    let failed: boolean;
    switch (method) {
      case EllipseMethod.EM_ISOMETRIC_CIRCLE:
        // special mode: Use first two edges, interpret them as two sides of a parallelogram and
        // generate an ellipse residing inside the parallelogram. This effect is quite useful when
        // generating isometric views. Hence, the name.
        failed = this.genIsometricEllipse(points, path_out) !== 0;
        break;
      case EllipseMethod.EM_PERSPECTIVE_CIRCLE:
        // special mode: Use first four points, interpret them as the perspective representation of a square and
        // draw the ellipse as it was a circle inside that square.
        failed = this.genPerspectiveEllipse(points, path_out) !== 0;
        break;
      case EllipseMethod.EM_STEINER_ELLIPSE:
        failed = this.genSteinerEllipse(points, false, path_out) !== 0;
        break;
      case EllipseMethod.EM_STEINER_INELLIPSE:
        failed = this.genSteinerEllipse(points, true, path_out) !== 0;
        break;
      default:
        failed = this.genFitEllipse(points, path_out) !== 0;
    }
    return failed ? path_in : path_out;
  }

  /**
   * Generates an ellipse (or circle) from the vertices of a given path. Thereby, using fitting
   * algorithms. We need at least 5 points to fit an ellipse. With 5 points each point is on the
   * ellipse. For less points we get a circle. Returns -1 when it cannot.
   */
  genFitEllipse(pts: readonly Point[], path_out: PathVector): number {
    // rotation angle based on user provided rot_axes to position the vertices
    const rot_angle = -deg2rad(this.rot_axes.get_value()); // negative for ccw rotation
    let affine = Rotate(rot_angle);
    let a0 = 0;
    let a1 = 2 * Math.PI;
    const front = pts[0] as Point;
    const back = pts[pts.length - 1] as Point;
    const fit_circle = (): number => {
      try {
        const circle = Circle.fit(pts);
        affine = affine.multiply(Scale(circle.radius)).multiply(Translate(circle.center));
        if (this.gen_arc.get_value()) {
          const p0 = front.sub(circle.center);
          const p1 = back.sub(circle.center);
          const ccw_wind = is_ccw(pts);
          [a0, a1] = endpoints2angles(ccw_wind, this.other_arc.get_value(), p0, p1, a0, a1);
        }
        const path = this.unit_arc_path(affine, a0, a1, this.slice_arc.get_value());
        if (path) path_out.push(path);
        return 0;
      } catch (e) {
        if (e instanceof RangeError) return -1;
        throw e;
      }
    };

    if (pts.length < 2) {
      return -1;
    } else if (pts.length === 2) {
      // simple line: circle in the middle of the line to the vertices
      const radius = front.sub(back).length() * 0.5;
      if (radius < 1e-9) return -1;
      const center = middle_point(front, back);
      affine = affine.multiply(Scale(radius)).multiply(Translate(center));
      const path = this.unit_arc_path(affine);
      if (path) path_out.push(path);
    } else if (pts.length >= 5 && this.method.get_value() === EllipseMethod.EM_AUTO) {
      // do ellipse
      try {
        const ellipse = Ellipse.fit(pts);
        affine = affine
          .multiply(Scale(ellipse.ray(X), ellipse.ray(Y)))
          .multiply(Rotate(ellipse.rotationAngle().radians()))
          .multiply(Translate(ellipse.center()));
        if (this.gen_arc.get_value()) {
          const inv_affine = affine.inverse();
          const p0 = front.transformed(inv_affine);
          const p1 = back.transformed(inv_affine);
          const ccw_wind = is_ccw(pts);
          [a0, a1] = endpoints2angles(ccw_wind, this.other_arc.get_value(), p0, p1, a0, a1);
        }
        const path = this.unit_arc_path(affine, a0, a1, this.slice_arc.get_value());
        if (path) path_out.push(path);
      } catch (e) {
        if (e instanceof RangeError) return -1;
        throw e;
      }
    } else {
      // do a circle (3,4 points, or only_circle set)
      if (fit_circle() !== 0) return -1;
    }

    // draw frame and axes?
    this.#frame_and_axes(path_out, affine);
    return 0;
  }

  genIsometricEllipse(pts: readonly Point[], path_out: PathVector): number {
    // take the first 3 vertices for the edges
    if (pts.length < 3) return -1;
    // calc edges
    const e0 = (pts[0] as Point).sub(pts[1] as Point);
    const e1 = (pts[2] as Point).sub(pts[1] as Point);

    const ce = cross(e0, e1);
    // parallel or one is zero?
    if (Math.abs(ce) < 1e-9) return -1;
    // unit vectors along edges
    const u0 = unit_vector(e0);
    const u1 = unit_vector(e1);
    // calc angles
    const a0 = atan2(e0);
    let a1 = Math.acos(dot(u0, u1)) - Math.PI / 2;
    if (ce < 0) a1 = -a1;
    // lengths: l0= length of edge 0; l1= height of parallelogram
    const l0 = e0.length() * 0.5;
    const e0n = e1.sub(u0.mul(dot(u0, e1)));
    const l1 = e0n.length() * 0.5;

    // center of the ellipse
    const pos = (pts[1] as Point).add(e0.add(e1).mul(0.5));

    // rotation angle based on user provided rot_axes to position the vertices
    const rot_angle = -deg2rad(this.rot_axes.get_value()); // negative for ccw rotation

    // build up the affine transformation
    const affine = Rotate(rot_angle)
      .multiply(Scale(l0, l1))
      .multiply(HShear(-Math.tan(a1)))
      .multiply(Rotate(a0))
      .multiply(Translate(pos));

    const path = this.unit_arc_path(affine);
    if (path) path_out.push(path);

    this.#frame_and_axes(path_out, affine);
    return 0;
  }

  genSteinerEllipse(pts: readonly Point[], gen_inellipse: boolean, path_out: PathVector): number {
    // take the first 3 vertices for the edges
    if (pts.length < 3) return -1;
    const [p0_, p1_, p2_] = pts as [Point, Point, Point];
    // calc center
    const pCenter = p0_.add(p1_).add(p2_).div(3);
    // calc main directions of affine triangle
    const f1 = p2_.sub(pCenter);
    const f2 = p1_.sub(p0_).div(Math.sqrt(3));

    // calc zero angle t0
    const denominator = dot(f1, f1) - dot(f2, f2);
    let t0 = 0;
    if (Math.abs(denominator) > 1e-12) {
      const cot2t0 = (2.0 * dot(f1, f2)) / denominator;
      t0 = Math.atan(cot2t0) / 2.0;
    }

    // evalSteinerEllipse: formula for the evaluation of points on the steiner ellipse using parameter angle
    const pCenter_Pt2 = p2_.sub(pCenter);
    const pPt0_Pt1 = p1_.sub(p0_);
    const evalSteinerEllipse = (angle: number): Point =>
      pCenter_Pt2.mul(Math.cos(angle)).add(pPt0_Pt1.mul(Math.sin(angle) / Math.sqrt(3)));

    // calc relative points of main axes (for axis directions)
    const pRel0 = evalSteinerEllipse(t0);
    const pRel1 = evalSteinerEllipse(t0 + Math.PI / 2);
    let l0 = pRel0.length();
    let l1 = pRel1.length();

    // basic rotation
    let a0 = atan2(pRel0);

    if (l1 > l0) {
      [l0, l1] = [l1, l0];
      a0 += Math.PI / 2;
    }

    // the Steiner inellipse is just scaled down by 2
    if (gen_inellipse) {
      l0 /= 2;
      l1 /= 2;
    }

    // rotation angle based on user provided rot_axes to position the vertices
    const rot_angle = -deg2rad(this.rot_axes.get_value()); // negative for ccw rotation

    // build up the affine transformation
    const affine = Rotate(rot_angle)
      .multiply(Scale(l0, l1))
      .multiply(Rotate(a0))
      .multiply(Translate(pCenter));

    const path = this.unit_arc_path(affine);
    if (path) path_out.push(path);

    this.#frame_and_axes(path_out, affine);
    return 0;
  }

  genPerspectiveEllipse(pts: readonly Point[], path_out: PathVector): number {
    // we need at least four points!
    if (pts.length < 4) return -1;

    // 1) check if the first three edges are a valid perspective
    // calc edge
    const e = [0, 1, 2, 3].map((i) => (pts[i] as Point).sub(pts[(i + 1) % 4] as Point));
    // calc directions
    const c = [0, 1, 2, 3].map((i) => cross(e[i] as Point, e[(i + 1) % 4] as Point)) as [
      number,
      number,
      number,
      number,
    ];
    // is this quad not convex?
    if (!(c.every((v) => v > 0) || c.every((v) => v < 0))) return -1;

    // 2) solve the direct linear transformation (see e.g. lpe-perspective-envelope.cpp or
    // https://franklinta.com/2014/09/08/computing-css-matrix3d-transforms/)

    // the square points in the initial configuration (about the unit circle):
    const pts0 = [new Point(-1.0, -1.0), new Point(+1.0, -1.0), new Point(+1.0, +1.0), new Point(-1.0, +1.0)];

    // build equation in matrix form
    const eqnVec = new Array<number>(8).fill(0);
    const eqnMat: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
    for (let i = 0; i < 4; ++i) {
      const p = pts[i] as Point;
      const q = pts0[i] as Point;
      const r0 = eqnMat[i] as number[];
      const r1 = eqnMat[i + 4] as number[];
      r0[0] = q.x;
      r0[1] = q.y;
      r0[2] = 1;
      r0[6] = -p.x * q.x;
      r0[7] = -p.x * q.y;
      r1[3] = q.x;
      r1[4] = q.y;
      r1[5] = 1;
      r1[6] = -p.y * q.x;
      r1[7] = -p.y * q.y;
      eqnVec[i] = p.x;
      eqnVec[i + 4] = p.y;
    }
    let x: number[];
    try {
      x = solveLeastSquares(eqnMat, eqnVec);
    } catch (e) {
      if (e instanceof RangeError) return -1;
      throw e;
    }
    // transfer the solution to the projection matrix for further use
    const projmatrix: number[][] = [
      [x[0] as number, x[1] as number, x[2] as number],
      [x[3] as number, x[4] as number, x[5] as number],
      [x[6] as number, x[7] as number, 1.0],
    ];

    // 3) generate five points on a unit circle and project them
    const dA = (2.0 * Math.PI) / 5.0; // delta Angle
    const five_pts = [0, 1, 2, 3, 4].map((h) => {
      const angle = dA * h;
      return projectPoint(new Point(Math.sin(angle), Math.cos(angle)), projmatrix);
    });

    // 4) fit the five points to an ellipse with the already known function inside genFitEllipse() function
    // build up the affine transformation
    const rot_angle = -deg2rad(this.rot_axes.get_value()); // negative for ccw rotation
    let affine = Rotate(rot_angle);

    try {
      const ellipse = Ellipse.fit(five_pts);
      affine = affine
        .multiply(Scale(ellipse.ray(X), ellipse.ray(Y)))
        .multiply(Rotate(ellipse.rotationAngle().radians()))
        .multiply(Translate(ellipse.center()));
    } catch (e) {
      if (e instanceof RangeError) return -1;
      throw e;
    }

    const path = this.unit_arc_path(affine);
    if (path) path_out.push(path);

    // 5) frames and axes
    let ccw_wind = false;
    if (this.gen_perspective_frame.get_value() || this.draw_perspective_axes.get_value())
      ccw_wind = is_ccw(pts);
    const ra = ccw_wind ? rot_angle : -rot_angle;

    // draw frame?
    if (this.gen_isometric_frame.get_value()) this.gen_iso_frame_paths(path_out, affine);

    // draw perspective frame?
    if (this.gen_perspective_frame.get_value()) this.gen_perspective_frame_paths(path_out, ra, projmatrix);

    // draw axes?
    if (this.draw_axes.get_value()) this.gen_axes_paths(path_out, affine);

    // draw perspective axes?
    if (this.draw_perspective_axes.get_value()) this.gen_perspective_axes_paths(path_out, ra, projmatrix);

    return 0;
  }
}
