// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-perspective-envelope.cpp, src/live_effects/lpe-perspective-envelope.h
/** \file
 * LPE <perspective-envelope> implementation
 */
/*
 * Authors:
 *   Jabiertxof Code migration from python extensions envelope and perspective
 *   Aaron Spike, aaron@ekips.org from envelope and perspective python code
 *   Dmitry Platonov, shadowjack@mail.ru, 2006 perspective approach & math
 *   Jose Hevia (freon) Transform algorithm from envelope
 *
 * Copyright (C) 2007-2014 Authors
 */
import {
  type Affine,
  are_near,
  CubicBezier,
  cross,
  distance,
  Interval,
  LineSegment,
  Path,
  type PathVector,
  Point,
} from '@inkscape-web/geom';
import { pathv_to_linear_and_cubic_beziers } from '../helper/geom.ts';
import { _, C_, N_ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { closepath_current, move_endpoints } from '../path/path-curve.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import type { Parameter, ParamWidget } from './parameter/parameter.ts';
import { PointParam } from './parameter/point.ts';

enum DeformationType {
  DEFORMATION_PERSPECTIVE,
  DEFORMATION_ENVELOPE,
}

const DeformationTypeConverter = new EnumDataConverter<number>([
  { id: DeformationType.DEFORMATION_PERSPECTIVE, label: N_('Perspective'), key: 'perspective' },
  {
    id: DeformationType.DEFORMATION_ENVELOPE,
    label: N_('Envelope deformation'),
    key: 'envelope_deformation',
  },
]);

const sgn = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

/** A line through two points (the parts of Geom::Line used here). */
class Line {
  constructor(
    public a: Point,
    public b: Point,
  ) {}
  setPoints(a: Point, b: Point): void {
    this.a = a;
    this.b = b;
  }
  vector(): Point {
    return this.b.sub(this.a);
  }
  pointAt(t: number): Point {
    return this.a.add(this.vector().mul(t));
  }
  nearestTime(p: Point): number {
    const v = this.vector();
    const l2 = v.dot(v);
    return l2 === 0 ? 0 : p.sub(this.a).dot(v) / l2;
  }
}

/** The time on l1 where it crosses l2, or null for parallel lines (Geom::intersection(Line, Line)). */
function intersectionTime(l1: Line, l2: Line): number | null {
  const d1 = l1.vector();
  const d2 = l2.vector();
  const denom = cross(d1, d2);
  if (denom === 0) return null;
  return cross(l2.a.sub(l1.a), d2) / denom;
}

/** Solve m x = b with LU decomposition and partial pivoting (as gsl_linalg_LU_decomp/solve). */
function luSolve(m: number[][], b: number[]): number[] {
  const n = b.length;
  const a = m.map((r) => [...r]);
  const x = [...b];
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i]?.[k] as number) > Math.abs(a[p]?.[k] as number)) p = i;
    [a[k], a[p]] = [a[p] as number[], a[k] as number[]];
    [x[k], x[p]] = [x[p] as number, x[k] as number];
    const ak = a[k] as number[];
    for (let i = k + 1; i < n; i++) {
      const ai = a[i] as number[];
      const f = (ai[k] as number) / (ak[k] as number);
      ai[k] = f;
      for (let j = k + 1; j < n; j++) ai[j] = (ai[j] as number) - f * (ak[j] as number);
      x[i] = (x[i] as number) - f * (x[k] as number);
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    const ai = a[i] as number[];
    let s = x[i] as number;
    for (let j = i + 1; j < n; j++) s -= (ai[j] as number) * (x[j] as number);
    x[i] = s / (ai[i] as number);
  }
  return x;
}

/**
 * Perspective/Envelope (upstream LPEPerspectiveEnvelope): fits the item into the quadrilateral of
 * four corner knots, by a perspective transform or by an envelope deformation.
 */
export class LPEPerspectiveEnvelope extends GroupBBoxEffect {
  readonly horizontal_mirror: BoolParam;
  readonly vertical_mirror: BoolParam;
  readonly overflow_perspective: BoolParam;
  readonly deform_type: EnumParam<number>;
  readonly up_left_point: PointParam;
  readonly up_right_point: PointParam;
  readonly down_left_point: PointParam;
  readonly down_right_point: PointParam;
  handles: Point[] = [];

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.horizontal_mirror = new BoolParam(
      _('Mirror movements in horizontal'),
      _('Mirror movements in horizontal'),
      'horizontal_mirror',
      this,
      false,
    );
    this.vertical_mirror = new BoolParam(
      _('Mirror movements in vertical'),
      _('Mirror movements in vertical'),
      'vertical_mirror',
      this,
      false,
    );
    this.overflow_perspective = new BoolParam(
      _('Overflow perspective'),
      _('Overflow perspective'),
      'overflow_perspective',
      this,
      false,
    );
    this.deform_type = new EnumParam(
      _('Type'),
      _('Select the type of deformation'),
      'deform_type',
      DeformationTypeConverter,
      this,
      DeformationType.DEFORMATION_PERSPECTIVE,
    );
    this.up_left_point = new PointParam(
      _('Top Left'),
      _('Top Left - <b>Ctrl+Alt+Click</b>: reset, <b>Ctrl</b>: move along axes'),
      'up_left_point',
      this,
    );
    this.up_right_point = new PointParam(
      _('Top Right'),
      _('Top Right - <b>Ctrl+Alt+Click</b>: reset, <b>Ctrl</b>: move along axes'),
      'up_right_point',
      this,
    );
    this.down_left_point = new PointParam(
      _('Down Left'),
      _('Down Left - <b>Ctrl+Alt+Click</b>: reset, <b>Ctrl</b>: move along axes'),
      'down_left_point',
      this,
    );
    this.down_right_point = new PointParam(
      _('Down Right'),
      _('Down Right - <b>Ctrl+Alt+Click</b>: reset, <b>Ctrl</b>: move along axes'),
      'down_right_point',
      this,
    );
    this.registerParameter(this.deform_type);
    this.registerParameter(this.horizontal_mirror);
    this.registerParameter(this.vertical_mirror);
    this.registerParameter(this.overflow_perspective);
    this.registerParameter(this.up_left_point);
    this.registerParameter(this.up_right_point);
    this.registerParameter(this.down_left_point);
    this.registerParameter(this.down_right_point);
    this.apply_to_clippath_and_mask = true;
  }

  #points(): PointParam[] {
    return [this.up_left_point, this.up_right_point, this.down_left_point, this.down_right_point];
  }

  protected override transform_multiply(postmul: Affine, _set: boolean): void {
    if (this.sp_lpe_item?.pathEffectsEnabled() && this.sp_lpe_item.optimizeTransforms()) {
      for (const p of this.#points()) p.param_transform_multiply(postmul, false);
    }
  }

  override doEffect(curve_in: PathVector): PathVector {
    let projmatrix: number[][] | null = null;
    const X = this.boundingbox_X;
    const Y = this.boundingbox_Y;
    if (this.deform_type.get_value() === DeformationType.DEFORMATION_PERSPECTIVE) {
      const source_handles = [
        new Point(X.min(), Y.max()),
        new Point(X.min(), Y.min()),
        new Point(X.max(), Y.min()),
        new Point(X.max(), Y.max()),
      ];
      const solmatrix = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
      const free_term = new Array<number>(8).fill(0);
      for (let i = 0; i < 4; ++i) {
        const s = source_handles[i] as Point;
        const h = this.handles[i] ?? s;
        const r = solmatrix[i] as number[];
        const r4 = solmatrix[i + 4] as number[];
        r[0] = s.x;
        r[1] = s.y;
        r[2] = 1;
        r[6] = -h.x * s.x;
        r[7] = -h.x * s.y;
        r4[3] = s.x;
        r4[4] = s.y;
        r4[5] = 1;
        r4[6] = -h.y * s.x;
        r4[7] = -h.y * s.y;
        free_term[i] = h.x;
        free_term[i + 4] = h.y;
      }
      const x = luSolve(solmatrix, free_term);
      projmatrix = [
        [x[0] as number, x[1] as number, x[2] as number],
        [x[3] as number, x[4] as number, x[5] as number],
        [x[6] as number, x[7] as number, 1.0],
      ];
    }
    const project = (p: Point) =>
      projmatrix ? this.projectPointMatrix(p, projmatrix) : this.projectPoint(p);
    const original_pathv = pathv_to_linear_and_cubic_beziers(curve_in);
    const curve: PathVector = [];
    let point_at3 = new Point(0, 0);
    for (const path_it of original_pathv) {
      if (path_it.empty()) continue;
      let curves = path_it.curves();
      if (path_it.closed()) {
        const closingline = path_it.closingSegment();
        if (are_near(closingline.initialPoint(), closingline.finalPoint())) curves = path_it.openCurves();
      }
      const nCurve = new Path(project((curves[0] ?? path_it.closingSegment()).initialPoint()));
      for (const c of curves) {
        let point_at1: Point;
        let point_at2: Point;
        if (c instanceof CubicBezier) {
          point_at1 = c.controlPoint(1);
          point_at2 = c.controlPoint(2);
        } else {
          point_at1 = c.initialPoint();
          point_at2 = c.finalPoint();
        }
        point_at3 = c.finalPoint();
        point_at1 = project(point_at1);
        point_at2 = project(point_at2);
        point_at3 = project(point_at3);
        if (c instanceof CubicBezier) {
          nCurve.appendCurve(new CubicBezier(nCurve.finalPoint(), point_at1, point_at2, point_at3));
        } else {
          nCurve.appendCurve(new LineSegment(nCurve.finalPoint(), point_at3));
        }
      }
      if (path_it.closed()) {
        move_endpoints(nCurve, point_at3, point_at3);
        closepath_current(nCurve);
      }
      curve.push(nCurve);
    }
    return curve;
  }

  projectPoint(p: Point): Point {
    const width = this.boundingbox_X.extent();
    const height = this.boundingbox_Y.extent();
    const delta_x = this.boundingbox_X.min() - p.x;
    const delta_y = this.boundingbox_Y.max() - p.y;
    const x_ratio = (delta_x * -1) / width;
    const y_ratio = delta_y / height;
    const ul = this.up_left_point.value;
    const ur = this.up_right_point.value;
    const dl = this.down_left_point.value;
    const dr = this.down_right_point.value;
    const vert = new Line(this.pointAtRatio(y_ratio, dl, ul), this.pointAtRatio(y_ratio, dr, ur));
    const horiz = new Line(this.pointAtRatio(x_ratio, dl, dr), this.pointAtRatio(x_ratio, ul, ur));
    const ta = intersectionTime(horiz, vert);
    return ta !== null ? horiz.pointAt(ta) : p;
  }

  projectPointMatrix(p: Point, m: number[][]): Point {
    const [m0, m1, m2] = m as [number[], number[], number[]];
    const w = p.x * (m2[0] as number) + p.y * (m2[1] as number) + (m2[2] as number);
    return new Point(
      (p.x * (m0[0] as number) + p.y * (m0[1] as number) + (m0[2] as number)) / w,
      (p.x * (m1[0] as number) + p.y * (m1[1] as number) + (m1[2] as number)) / w,
    );
  }

  pointAtRatio(ratio: number, A: Point, B: Point): Point {
    return new Point(A.x + ratio * (B.x - A.x), A.y + ratio * (B.y - A.y));
  }

  override newWidget(): { param: Parameter | null; widget: ParamWidget }[] {
    const widgets = super.newWidget();
    widgets.push({
      param: null,
      widget: {
        kind: 'buttons',
        buttons: [{ label: _('_Clear').replace('_', ''), onClick: () => this.#clear() }],
      },
    });
    return widgets;
  }

  #clear(): void {
    this.resetGrid();
    for (const p of this.#points()) p.write_to_SVG();
    this.makeUndoDone(C_('Undo', 'Change point parameter'));
  }

  vertical(param_one: PointParam, param_two: PointParam, vert: Line): void {
    let A = param_one.value;
    let B = param_two.value;
    const Yv = (A.y + B.y) / 2;
    A = new Point(A.x, Yv);
    B = new Point(B.x, Yv);
    const nearest = vert.pointAt(vert.nearestTime(A));
    const distance_one = distance(A, nearest);
    const distance_two = distance(B, nearest);
    let distance_middle = (distance_one + distance_two) / 2;
    if (A.x > B.x) distance_middle *= -1;
    param_one.param_setValue(new Point(nearest.x - distance_middle, A.y));
    param_two.param_setValue(new Point(nearest.x + distance_middle, B.y));
  }

  horizontal(param_one: PointParam, param_two: PointParam, horiz: Line): void {
    let A = param_one.value;
    let B = param_two.value;
    const Xv = (A.x + B.x) / 2;
    A = new Point(Xv, A.y);
    B = new Point(Xv, B.y);
    const nearest = horiz.pointAt(horiz.nearestTime(A));
    const distance_one = distance(A, nearest);
    const distance_two = distance(B, nearest);
    let distance_middle = (distance_one + distance_two) / 2;
    if (A.y > B.y) distance_middle *= -1;
    param_one.param_setValue(new Point(A.x, nearest.y - distance_middle));
    param_two.param_setValue(new Point(B.x, nearest.y + distance_middle));
  }

  #fixZeroSize(): void {
    if (are_near(this.boundingbox_X.min(), this.boundingbox_X.max())) {
      this.boundingbox_X = new Interval(this.boundingbox_X.min() - 3, this.boundingbox_X.max() + 3);
    }
    if (are_near(this.boundingbox_Y.min(), this.boundingbox_Y.max())) {
      this.boundingbox_Y = new Interval(this.boundingbox_Y.min() - 3, this.boundingbox_Y.max() + 3);
    }
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem, false, true);
    this.#fixZeroSize();
    const X = this.boundingbox_X;
    const Y = this.boundingbox_Y;
    const vert = new Line(new Point(X.middle(), Y.max()), new Point(X.middle(), Y.min()));
    const horiz = new Line(new Point(X.min(), Y.middle()), new Point(X.max(), Y.middle()));
    if (this.vertical_mirror.get_value()) {
      this.vertical(this.up_left_point, this.up_right_point, vert);
      this.vertical(this.down_left_point, this.down_right_point, vert);
    }
    if (this.horizontal_mirror.get_value()) {
      this.horizontal(this.up_left_point, this.down_left_point, horiz);
      this.horizontal(this.up_right_point, this.down_right_point, horiz);
    }
    this.setDefaults();
    const ul = this.up_left_point.value;
    const ur = this.up_right_point.value;
    const dl = this.down_left_point.value;
    const dr = this.down_right_point.value;
    if (are_near(ul, ur) && are_near(ur, dl) && are_near(dl, dr)) {
      console.warn(
        'Perspective/Envelope LPE::doBeforeEffect - lpeobj with invalid parameter, the same value in 4 handles!',
      );
      this.resetGrid();
      return;
    }
    if (this.deform_type.get_value() !== DeformationType.DEFORMATION_PERSPECTIVE) return;
    if (this.overflow_perspective.get_value() || this.handles.length !== 4) {
      this.handles = [dl, ul, ur, dr];
      return;
    }
    const params = [this.down_left_point, this.up_left_point, this.up_right_point, this.down_right_point];
    const moved = params.map((p, i) => !(this.handles[i] as Point).equals(p.value));
    this.handles = params.map((p) => p.value);
    const h = this.handles;
    // Keep each handle inside the triangle of the other three (upstream: four blocks).
    // (upstream: one block per handle with the lines of the other three)
    for (let k = 0; k < 4; k++) {
      const a0 = h[[3, 0, 1, 2][k] as number] as Point;
      const a1 = h[[1, 2, 3, 0][k] as number] as Point;
      const b0 = h[[1, 2, 3, 0][k] as number] as Point;
      const b1 = h[[2, 3, 0, 1][k] as number] as Point;
      const c0 = h[[2, 3, 0, 1][k] as number] as Point;
      const c1 = h[[3, 0, 1, 2][k] as number] as Point;
      const p = h[k] as Point;
      const line_a = new Line(a0, a1);
      const line_b = new Line(b0, b1);
      const line_c = new Line(c0, c1);
      const position_a = sgn(cross(a0.sub(a1), p.sub(a1)));
      const position_b = sgn(cross(b0.sub(b1), p.sub(b1)));
      const position_c = sgn(cross(c0.sub(c1), p.sub(c1)));
      if (!moved[k]) continue;
      const param = params[k] as PointParam;
      if (position_a !== 1) param.param_setValue(line_a.pointAt(line_a.nearestTime(p)), true);
      if (position_b === 1) param.param_setValue(line_b.pointAt(line_b.nearestTime(p)), true);
      if (position_c === 1) param.param_setValue(line_c.pointAt(line_c.nearestTime(p)), true);
    }
  }

  setDefaults(): void {
    this.#fixZeroSize();
    const X = this.boundingbox_X;
    const Y = this.boundingbox_Y;
    this.up_left_point.param_update_default(new Point(X.min(), Y.min()));
    this.up_right_point.param_update_default(new Point(X.max(), Y.min()));
    this.down_right_point.param_update_default(new Point(X.max(), Y.max()));
    this.down_left_point.param_update_default(new Point(X.min(), Y.max()));
  }

  resetGrid(): void {
    this.up_left_point.param_set_default();
    this.up_right_point.param_set_default();
    this.down_right_point.param_set_default();
    this.down_left_point.param_set_default();
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    this.original_bbox(item as SPLPEItem, false, true);
    this.setDefaults();
    this.resetGrid();
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.length = 0;
    const pts = [
      this.up_left_point,
      this.up_right_point,
      this.down_right_point,
      this.down_left_point,
      this.up_left_point,
    ];
    const c = new Path(this.up_left_point.value);
    for (const p of pts.slice(1)) c.appendCurve(new LineSegment(c.finalPoint(), p.value));
    hp_vec.push([c]);
  }
}
