// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-simplify.cpp, src/live_effects/lpe-simplify.h
import {
  type Affine,
  are_near,
  CubicBezier,
  deg_from_rad,
  distance,
  LineSegment,
  type OptRect,
  Path,
  type PathVector,
  Point,
  rad_from_deg,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { closepath_current } from '../path/path-curve.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { ToggleButtonParam } from './parameter/togglebutton.ts';

const rayAngle = (a: Point, b: Point): number => Math.atan2(b.y - a.y, b.x - a.x);
const transformed = (pv: PathVector, m: Affine): PathVector => pv.map((p) => p.transformed(m));

/**
 * Simplify (upstream LPESimplify): simplifies the path with livarot (in WASM), then smooths the
 * joins whose angle is below smooth_angles and draws the nodes and handles as helper paths.
 */
export class LPESimplify extends Effect {
  readonly threshold: ScalarParam;
  readonly steps: ScalarParam;
  readonly smooth_angles: ScalarParam;
  readonly helper_size: ScalarParam;
  readonly simplify_individual_paths: BoolParam;
  readonly simplify_just_coalesce: ToggleButtonParam;
  radius_helper_nodes = 6.0;
  hp: PathVector = [];
  bbox: OptRect = null;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.steps = new ScalarParam(
      _('Repeat'),
      _(
        'Change number of repeats of simplifying operation. Useful for complex paths that need to be significantly simplified. ',
      ),
      'steps',
      this,
      1,
    );
    this.threshold = new ScalarParam(
      _('Complexity'),
      _('Drag slider to set the amount of simplification'),
      'threshold',
      this,
      5,
    );
    this.smooth_angles = new ScalarParam(
      _('Smoothness'),
      _('Max degree difference on handles to perform smoothing'),
      'smooth_angles',
      this,
      360,
    );
    this.helper_size = new ScalarParam(
      _('Handle size'),
      _('Size of the handles in the effect visualization (not editable)'),
      'helper_size',
      this,
      10,
    );
    this.simplify_individual_paths = new BoolParam(
      _('Simplify paths separately'),
      _('Simplify each path individually. This maintains detail in complex shapes.'),
      'simplify_individual_paths',
      this,
      true,
    );
    this.simplify_just_coalesce = new ToggleButtonParam(
      _('Just coalesce'),
      _('Simplify just coalesce'),
      'simplify_just_coalesce',
      this,
      false,
      '',
      'on-outline',
      'off-outline',
    );
    this.registerParameter(this.threshold);
    this.registerParameter(this.steps);
    this.registerParameter(this.smooth_angles);
    this.registerParameter(this.helper_size);
    this.registerParameter(this.simplify_individual_paths);
    this.registerParameter(this.simplify_just_coalesce);
    this.threshold.addSlider(true);
    this.spinbutton_width_chars = 5;
    this.steps.addSlider(true);
    this.steps.param_set_range(1, 50);
    this.steps.param_set_increments(1, 1);
    this.steps.param_set_digits(0);
    this.smooth_angles.addSlider(true);
    this.smooth_angles.param_set_range(0.0, 360.0);
    this.smooth_angles.param_set_increments(1, 1);
    this.helper_size.addSlider(true);
    this.helper_size.param_set_range(0.0, 30);
    this.helper_size.param_set_increments(1, 1);
    this.helper_size.param_set_digits(2);
    this.setVersioningData();
    this.radius_helper_nodes = 6.0;
    this.apply_to_clippath_and_mask = true;
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.hp = [];
    this.bbox = lpeitem.visualBounds();
    this.radius_helper_nodes = this.helper_size.get_value();
  }

  setVersioningData(): void {
    const version = this.lpeversion.param_getSVGValue();
    if (version < '1.3') {
      this.threshold.param_set_range(0.0001, Number.POSITIVE_INFINITY);
      this.threshold.param_set_increments(0.0001, 0.0001);
      this.threshold.param_set_digits(6);
      this.smooth_angles.param_set_digits(2);
    } else {
      this.threshold.param_set_range(0.01, 100.0);
      this.threshold.param_set_increments(0.1, 0.1);
      this.threshold.param_set_digits(2);
      this.smooth_angles.param_set_digits(0);
      this.threshold.param_set_no_leading_zeros();
      this.helper_size.param_set_no_leading_zeros();
      this.smooth_angles.param_set_no_leading_zeros();
    }
  }

  protected override doOnApply(_lpeitem: SPLPEItem): void {
    this.lpeversion.param_setValue('1.3', true);
    this.setVersioningData();
  }

  override doEffect(curve: PathVector): PathVector {
    // Read the version again: it may change after the constructor (doOnApply, undo).
    this.setVersioningData();
    let size = this.bbox ? this.bbox.dimensions().length() : 0;
    if (this.simplify_individual_paths.get_value()) {
      const bounds = curve.reduce<OptRect>((acc, p) => {
        const b = p.boundsFast();
        return acc ? acc.unionWith(b) : b;
      }, null);
      if (bounds) size = bounds.dimensions().length();
    }
    if (this.sp_lpe_item) size /= this.sp_lpe_item.i2docAffine().descrim();
    const factor = this.lpeversion.param_getSVGValue() < '1.3' ? 1 : 10000;
    const d = pathBoolopBackend().simplifyPath(
      sp_svg_write_path(curve),
      (this.threshold.get_value() / factor) * size,
      this.steps.get_value(),
      this.simplify_just_coalesce.get_value(),
    );
    const result = this.generateHelperPathAndSmooth(sp_svg_read_pathv(d));
    // TODO: update_helperpath() (the node tool shows the helper paths).
    return result;
  }

  generateHelperPathAndSmooth(result: PathVector): PathVector {
    if (this.steps.get_value() < 1) return result;
    const tmp_path: PathVector = [];
    const helper_size = this.helper_size.get_value();
    const smooth_angles = this.smooth_angles.get_value();
    for (const path_it of result) {
      if (path_it.empty()) continue;
      let curves = path_it.curves();
      if (path_it.closed()) {
        // if the path is closed, maybe we have to stop a bit earlier because the
        // closing line segment has zerolength.
        const closingline = path_it.closingSegment();
        if (are_near(closingline.initialPoint(), closingline.finalPoint())) curves = path_it.openCurves();
      }
      const first = curves[0];
      if (!first) continue;
      if (helper_size > 0) this.drawNode(first.initialPoint());
      const nCurve = new Path(first.initialPoint());
      let start = new Point(0, 0);
      curves.forEach((curve_it1, i) => {
        const curve_it2 = curves[i + 1];
        let point_at1 = curve_it1.initialPoint();
        let point_at2 = curve_it1.finalPoint();
        const point_at3 = curve_it1.finalPoint();
        let point_at4 = curve_it1.finalPoint();
        if (start.equals(new Point(0, 0))) start = point_at1;
        if (curve_it1 instanceof CubicBezier) {
          point_at1 = curve_it1.controlPoint(1);
          point_at2 = curve_it1.controlPoint(2);
        }
        if (path_it.closed() && !curve_it2) point_at4 = start;
        if (curve_it2 instanceof CubicBezier) point_at4 = curve_it2.controlPoint(1);
        const angle1 = deg_from_rad(rayAngle(point_at2, point_at3));
        const angle2 = deg_from_rad(rayAngle(point_at3, point_at4));
        if (
          smooth_angles >= Math.abs(angle2 - angle1) &&
          !are_near(point_at4, point_at3) &&
          !are_near(point_at2, point_at3)
        ) {
          const dist = distance(point_at2, point_at3);
          const angleFixed = rayAngle(point_at3, point_at4) - rad_from_deg(180.0);
          point_at2 = Point.polar(angleFixed, dist).add(point_at3);
        }
        const c = new CubicBezier(nCurve.finalPoint(), point_at1, point_at2, curve_it1.finalPoint());
        nCurve.appendCurve(c);
        if (helper_size > 0) {
          const [p0, p1, p2, p3] = c.controlPoints() as [Point, Point, Point, Point];
          if (!are_near(p0, p1)) {
            this.drawHandle(p1);
            this.drawHandleLine(p0, p1);
          }
          if (!are_near(p3, p2)) {
            this.drawHandle(p2);
            this.drawHandleLine(p3, p2);
          }
          this.drawNode(curve_it1.finalPoint());
        }
      });
      if (path_it.closed()) closepath_current(nCurve);
      tmp_path.push(nCurve);
    }
    return tmp_path;
  }

  drawNode(p: Point): void {
    const r = this.radius_helper_nodes;
    const svgd =
      'M 0.55,0.5 A 0.05,0.05 0 0 1 0.5,0.55 0.05,0.05 0 0 1 0.45,0.5 0.05,0.05 0 0 1 0.5,0.45 0.05,0.05 0 0 1 0.55,0.5 Z M 0,0 1,0 1,1 0,1 Z';
    const pathv = transformed(
      sp_svg_read_pathv(svgd),
      Scale(r).multiply(Translate(p.sub(new Point(0.5 * r, 0.5 * r)))),
    );
    this.hp.push(...pathv.slice(0, 2));
  }

  drawHandle(p: Point): void {
    const r = this.radius_helper_nodes;
    const svgd =
      'M 0.7,0.35 A 0.35,0.35 0 0 1 0.35,0.7 0.35,0.35 0 0 1 0,0.35 0.35,0.35 0 0 1 0.35,0 0.35,0.35 0 0 1 0.7,0.35 Z';
    const pathv = transformed(
      sp_svg_read_pathv(svgd),
      Scale(r).multiply(Translate(p.sub(new Point(0.35 * r, 0.35 * r)))),
    );
    if (pathv[0]) this.hp.push(pathv[0]);
  }

  drawHandleLine(p: Point, p2: Point): void {
    const path = new Path(p);
    const diameter = this.radius_helper_nodes;
    if (this.helper_size.get_value() > 0 && distance(p, p2) > diameter * 0.35) {
      p2 = p2.sub(Point.polar(rayAngle(p, p2), diameter * 0.35));
    }
    path.appendCurve(new LineSegment(p, p2));
    this.hp.push(path);
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.push(this.hp);
  }
}
