// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-bspline.cpp, src/live_effects/lpe-bspline.h
/*
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  are_near,
  CubicBezier,
  type Curve,
  LineSegment,
  nearest_time,
  Path,
  type PathVector,
  Point,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import { _, C_ } from '../i18n.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { SPPath } from '../object/sp-path.ts';
import { SPShape } from '../object/sp-shape.ts';
import { closepath_current, move_endpoints } from '../path/path-curve.ts';
import { Preferences } from '../preferences.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { type Parameter, type ParamWidget, ScalarParam } from './parameter/parameter.ts';

const BSPLINE_TOL = 0.001;
const NO_POWER = 0.0;
const DEFAULT_START_POWER = 1.0 / 3.0;
const DEFAULT_END_POWER = 2.0 / 3.0;
const handle_cubic_gap = new Point(0.001, 0.001);

/** A path that starts at start and has the curves cs (they must be contiguous). */
function pathOf(start: Point, cs: readonly Curve[]): Path {
  const p = new Path(start);
  for (const c of cs) p.appendCurve(c);
  return p;
}

/**
 * BSpline (upstream LPEBSpline): the nodes of the path are the control points of a B-spline.
 * The weight of the handles of each node sets how near the curve passes to the node.
 */
export class LPEBSpline extends Effect {
  readonly steps: ScalarParam;
  readonly helper_size: ScalarParam;
  readonly apply_no_weight: BoolParam;
  readonly apply_with_weight: BoolParam;
  readonly only_selected: BoolParam;
  readonly uniform: BoolParam;
  readonly weight: ScalarParam;
  hp: PathVector = [];

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.steps = new ScalarParam(
      _('Steps with CTRL:'),
      _('Change number of steps with CTRL pressed'),
      'steps',
      this,
      2,
    );
    this.helper_size = new ScalarParam(_('Helper size:'), _('Helper size'), 'helper_size', this, 0);
    this.apply_no_weight = new BoolParam(
      _('Apply changes if weight = 0%'),
      _('Apply changes if weight = 0%'),
      'apply_no_weight',
      this,
      true,
    );
    this.apply_with_weight = new BoolParam(
      _('Apply changes if weight > 0%'),
      _('Apply changes if weight > 0%'),
      'apply_with_weight',
      this,
      true,
    );
    this.only_selected = new BoolParam(
      _('Change only selected nodes'),
      _('Change only selected nodes'),
      'only_selected',
      this,
      false,
    );
    this.uniform = new BoolParam(_('Uniform BSpline'), _('Uniform bspline'), 'uniform', this, false);
    this.weight = new ScalarParam(
      _('Change weight %:'),
      _('Change weight percent of the effect'),
      'weight',
      this,
      DEFAULT_START_POWER * 100,
    );
    this.registerParameter(this.weight);
    this.registerParameter(this.steps);
    this.registerParameter(this.helper_size);
    this.registerParameter(this.apply_no_weight);
    this.registerParameter(this.apply_with_weight);
    this.registerParameter(this.only_selected);
    this.registerParameter(this.uniform);

    this.weight.param_set_range(NO_POWER, 100.0);
    this.weight.param_set_increments(0.1, 0.1);
    this.weight.param_set_digits(4);
    this.steps.param_set_range(1, 10);
    this.steps.param_set_increments(1, 1);
    this.steps.param_set_digits(0);
    this.helper_size.param_set_range(0.0, 999.0);
    this.helper_size.param_set_increments(1, 1);
    this.helper_size.param_set_digits(2);
  }

  protected override doBeforeEffect(_lpeitem: SPLPEItem): void {
    this.hp = [];
  }

  protected override doOnApply(lpeitem: SPLPEItem): void {
    if (!(lpeitem instanceof SPShape)) {
      console.warn('LPE BSpline can only be applied to shapes (not groups).');
      lpeitem.removeCurrentPathEffect(false);
    }
    this.lpeversion.param_setValue('1.3', true);
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.push(this.hp);
  }

  override newWidget(): { param: Parameter | null; widget: ParamWidget }[] {
    const widgets = super.newWidget();
    // upstream puts the buttons before the weight widget
    const i = widgets.findIndex((w) => w.param === this.weight);
    widgets.splice(Math.max(i, 0), 0, {
      param: null,
      widget: {
        kind: 'buttons',
        buttons: [
          { label: _('Default weight'), onClick: () => this.toDefaultWeight() },
          { label: _('Make cusp'), onClick: () => this.toMakeCusp() },
        ],
      },
    });
    return widgets;
  }

  override onParamWidgetChanged(param: Parameter): void {
    if (param === this.weight || param === this.steps) this.toWeight();
  }

  toDefaultWeight(): void {
    this.changeWeight(DEFAULT_START_POWER * 100);
    if (this.sp_lpe_item) sp_lpe_item_update_patheffect(this.sp_lpe_item, false, true);
    this.makeUndoDone(C_('Undo', 'Change to default weight'));
  }

  toMakeCusp(): void {
    this.changeWeight(NO_POWER);
    if (this.sp_lpe_item) sp_lpe_item_update_patheffect(this.sp_lpe_item, false, true);
    this.makeUndoDone(C_('Undo', 'Change to 0 weight'));
  }

  toWeight(): void {
    this.changeWeight(this.weight.get_value());
    if (this.sp_lpe_item) sp_lpe_item_update_patheffect(this.sp_lpe_item, false, true);
    this.makeUndoDone(C_('Undo', 'Change scalar parameter'));
  }

  changeWeight(weight_ammount: number): void {
    const path = this.sp_lpe_item;
    if (path instanceof SPPath) {
      const curve = path.curveForEdit();
      if (!curve) return;
      path.setAttribute(
        'inkscape:original-d',
        sp_svg_write_path(this.doBSplineFromWidget(curve, weight_ammount / 100.0)),
      );
    }
  }

  override doEffect(curve: PathVector): PathVector {
    return sp_bspline_do_effect(curve, this.helper_size.get_value(), this.hp, this.uniform.get_value());
  }

  /** Set the handles of all (or the selected) nodes to weight_amount (0..1). */
  doBSplineFromWidget(original_pathv: PathVector, weight_amount: number): PathVector {
    if (original_pathv.reduce((n, p) => n + p.size(), 0) < 1) return original_pathv;
    const curve: Path[] = [];
    const apply_no_weight = this.apply_no_weight.get_value();
    const apply_with_weight = this.apply_with_weight.get_value();
    const only_selected = this.only_selected.get_value();
    const gap = (p: Point) => (are_near(weight_amount, NO_POWER, BSPLINE_TOL) ? p : p.add(handle_cubic_gap));
    for (const path_it of original_pathv) {
      if (path_it.empty()) continue;
      let curves = path_it.curves();
      if (path_it.closed()) {
        // the closing line segment has zero-length (within rounding errors). So stop before that one!
        const closingline = curves[curves.length - 1] as Curve;
        if (are_near(closingline.initialPoint(), closingline.finalPoint())) curves = path_it.openCurves();
      }
      const curve_n = new Path(path_it.initialPoint());
      let point_at3 = new Point(0, 0);
      for (const c of curves) {
        const inn = new LineSegment(c.initialPoint(), c.finalPoint());
        const point_at0 = inn.initialPoint();
        point_at3 = inn.finalPoint();
        let point_at1: Point;
        let point_at2: Point;
        if (c instanceof CubicBezier) {
          const c1 = c.controlPoint(1);
          const c2 = c.controlPoint(2);
          if (
            (apply_no_weight && apply_with_weight) ||
            (apply_no_weight && are_near(c1, point_at0)) ||
            (apply_with_weight && !are_near(c1, point_at0))
          ) {
            point_at1 =
              this.isNodePointSelected(point_at0) || !only_selected ? gap(inn.pointAt(weight_amount)) : c1;
          } else {
            point_at1 = c1;
          }
          if (
            (apply_no_weight && apply_with_weight) ||
            (apply_no_weight && are_near(c2, point_at3)) ||
            (apply_with_weight && !are_near(c2, point_at3))
          ) {
            point_at2 =
              this.isNodePointSelected(point_at3) || !only_selected
                ? gap(inn.pointAt(1 - weight_amount))
                : c2;
          } else {
            point_at2 = c2;
          }
        } else if (
          (apply_no_weight && apply_with_weight) ||
          (apply_no_weight && are_near(weight_amount, NO_POWER, BSPLINE_TOL)) ||
          (apply_with_weight && !are_near(weight_amount, NO_POWER, BSPLINE_TOL))
        ) {
          point_at1 =
            this.isNodePointSelected(point_at0) || !only_selected
              ? inn.pointAt(weight_amount).add(handle_cubic_gap)
              : inn.initialPoint();
          point_at2 =
            this.isNodePointSelected(point_at3) || !only_selected
              ? inn.pointAt(1 - weight_amount).add(handle_cubic_gap)
              : inn.finalPoint();
        } else {
          point_at1 = inn.initialPoint();
          point_at2 = inn.finalPoint();
        }
        curve_n.appendCurve(new CubicBezier(curve_n.finalPoint(), point_at1, point_at2, point_at3));
      }
      if (path_it.closed()) {
        move_endpoints(curve_n, path_it.initialPoint(), path_it.initialPoint());
        closepath_current(curve_n);
      } else {
        move_endpoints(curve_n, path_it.initialPoint(), point_at3);
      }
      curve.push(curve_n);
    }
    return curve;
  }
}

/** The ends of an open uniform bspline (upstream: the "uniform" part of sp_bspline_do_effect). */
function uniformEnds(path_in: Path): Path {
  let path_it = path_in;
  let cubic = path_it.at(0);
  if (cubic instanceof CubicBezier) {
    let factor = nearest_time(cubic.controlPoint(2), cubic) / DEFAULT_END_POWER;
    const c0 = cubic;
    const newp = pathOf(c0.controlPoint(0), [
      new CubicBezier(
        c0.controlPoint(0),
        c0.controlPoint(0),
        c0.pointAt(0.5 + (factor - 1)),
        c0.controlPoint(3),
      ),
    ]);
    let rest = path_it.openCurves().slice(1);
    cubic = rest[0] as Curve;
    if (cubic instanceof CubicBezier) {
      factor = nearest_time(cubic.controlPoint(2), cubic) / DEFAULT_END_POWER;
      const c1 = cubic;
      const newp2 = pathOf(c1.controlPoint(0), [
        new CubicBezier(
          c1.controlPoint(0),
          c1.controlPoint(1),
          c1.pointAt(0.5 + (factor - 1)),
          c1.controlPoint(3),
        ),
      ]);
      rest = rest.slice(1);
      newp.setFinal(newp2.at(newp2.sizeOpen() - 1).initialPoint());
      newp.append(newp2);
    }
    const tail = pathOf(rest[0]?.initialPoint() ?? path_it.finalPoint(), rest);
    tail.setInitial(newp.finalPoint());
    newp.append(tail);
    path_it = newp;
  }
  cubic = path_it.at(path_it.sizeOpen() - 1);
  if (cubic instanceof CubicBezier && path_it.sizeOpen() > 2) {
    const last = cubic;
    let factor = (nearest_time(last.controlPoint(1), last) * 0.5) / DEFAULT_START_POWER;
    let newp = pathOf(last.controlPoint(0), [
      new CubicBezier(last.controlPoint(0), last.pointAt(factor), last.controlPoint(3), last.controlPoint(3)),
    ]);
    path_it.erase_last();
    cubic = path_it.at(path_it.sizeOpen() - 1);
    if (cubic instanceof CubicBezier && path_it.sizeOpen() > 3) {
      const prev = cubic;
      factor = (nearest_time(prev.controlPoint(1), prev) * 0.5) / DEFAULT_START_POWER;
      const newp2 = pathOf(prev.controlPoint(0), [
        new CubicBezier(
          prev.controlPoint(0),
          prev.pointAt(factor),
          prev.controlPoint(2),
          prev.controlPoint(3),
        ),
      ]);
      path_it.erase_last();
      newp2.setFinal(newp.at(newp.sizeOpen() - 1).initialPoint());
      newp2.append(newp);
      newp = newp2;
    }
    path_it.setFinal(newp.initialPoint());
    path_it.append(newp);
  }
  return path_it;
}

/**
 * The BSpline of each subpath (upstream sp_bspline_do_effect; also used by the BSpline mode of
 * the drawing tools). Handles are drawn into hp when helper_size > 0.
 */
export function sp_bspline_do_effect(
  curve: PathVector,
  helper_size: number,
  hp: PathVector,
  uniform: boolean,
): PathVector {
  if (curve.reduce((n, p) => n + p.size(), 0) < 1) return curve;
  const original_pathv = curve;
  const result: Path[] = [];
  const prefs = Preferences.get();
  for (const path_in of original_pathv) {
    if (path_in.empty()) continue;
    if (!prefs.getBool('/tools/nodes/show_outline', true)) hp.push(path_in);
    let path_it = path_in.clone();
    if (uniform && !path_it.closed() && path_it.sizeOpen() > 1) path_it = uniformEnds(path_it);

    let curves = path_it.curves();
    if (path_it.closed()) {
      // the closing line segment has zero-length (within rounding errors). So stop before that one!
      const closingline = curves[curves.length - 1] as Curve;
      if (are_near(closingline.initialPoint(), closingline.finalPoint())) curves = path_it.openCurves();
    }
    let node = new Point(0, 0);
    let point_at1 = new Point(0, 0);
    let point_at2 = new Point(0, 0);
    let next_point_at1 = new Point(0, 0);
    const first = curves[0] as Curve;
    const curve_n = new Path(first.initialPoint());
    for (let i1 = 0; i1 < curves.length; i1++) {
      const c1 = curves[i1] as Curve;
      const c2 = curves[i1 + 1];
      const inn = new LineSegment(c1.initialPoint(), c1.finalPoint());
      let cubic = c1 instanceof CubicBezier ? c1 : null;
      if (cubic) {
        const [p0, p1, p2, p3] = cubic.controlPoints() as [Point, Point, Point, Point];
        if (are_near(p1, p0) && !are_near(p2, p3)) point_at1 = inn.pointAt(DEFAULT_START_POWER);
        else point_at1 = inn.pointAt(nearest_time(p1, inn));
        if (uniform && curve_n.size() === 0) point_at1 = c1.initialPoint();
        if (are_near(p2, p3) && !are_near(p1, p0)) point_at2 = inn.pointAt(DEFAULT_END_POWER);
        else point_at2 = inn.pointAt(nearest_time(p2, inn));
      } else {
        point_at1 = inn.initialPoint();
        point_at2 = inn.finalPoint();
      }
      if (c2) {
        const out = new LineSegment(c2.initialPoint(), c2.finalPoint());
        cubic = c2 instanceof CubicBezier ? c2 : null;
        if (cubic) {
          const [p0, p1, p2, p3] = cubic.controlPoints() as [Point, Point, Point, Point];
          if (are_near(p1, p0) && !are_near(p2, p3)) next_point_at1 = inn.pointAt(DEFAULT_START_POWER);
          else next_point_at1 = out.pointAt(nearest_time(p1, out));
        } else {
          next_point_at1 = out.initialPoint();
        }
      }
      if (path_it.closed() && !c2) {
        const f = curves[0] as Curve;
        const start = new LineSegment(f.initialPoint(), f.finalPoint());
        const helper_initial =
          f instanceof CubicBezier
            ? start.pointAt(nearest_time(f.controlPoint(1), start))
            : start.initialPoint();
        const end = new LineSegment(c1.initialPoint(), c1.finalPoint());
        const helper_final =
          c1 instanceof CubicBezier ? end.pointAt(nearest_time(c1.controlPoint(2), end)) : end.finalPoint();
        node = new LineSegment(helper_initial, helper_final).pointAt(0.5);
        curve_n.appendCurve(new CubicBezier(curve_n.finalPoint(), point_at1, point_at2, node));
        move_endpoints(curve_n, node, node);
      } else if (!c2) {
        if (uniform) {
          curve_n.appendCurve(
            new CubicBezier(curve_n.finalPoint(), point_at1, c1.finalPoint(), c1.finalPoint()),
          );
        } else {
          curve_n.appendCurve(new CubicBezier(curve_n.finalPoint(), point_at1, point_at2, c1.finalPoint()));
        }
        move_endpoints(curve_n, (curves[0] as Curve).initialPoint(), c1.finalPoint());
      } else {
        node = new LineSegment(point_at2, next_point_at1).pointAt(0.5);
        const cubic2 = c1 instanceof CubicBezier ? c1 : null;
        if (
          (cubic && are_near(cubic.controlPoint(0), cubic.controlPoint(1))) ||
          (cubic2 && are_near(cubic2.controlPoint(2), cubic2.controlPoint(3)))
        ) {
          node = c1.finalPoint();
        }
        curve_n.appendCurve(new CubicBezier(curve_n.finalPoint(), point_at1, point_at2, node));
      }
      if (!are_near(node, c1.finalPoint()) && helper_size > 0.0)
        hp.push(sp_bspline_drawHandle(node, helper_size));
    }
    if (path_it.closed()) closepath_current(curve_n);
    result.push(curve_n);
  }
  if (helper_size > 0.0 && result[0]) hp.push(result[0]);
  return result;
}

function sp_bspline_drawHandle(p: Point, helper_size: number): Path {
  const svgd = 'M 1,0.5 A 0.5,0.5 0 0 1 0.5,1 0.5,0.5 0 0 1 0,0.5 0.5,0.5 0 0 1 0.5,0 0.5,0.5 0 0 1 1,0.5 Z';
  const aff = Scale(helper_size).multiply(Translate(p.sub(new Point(0.5 * helper_size, 0.5 * helper_size))));
  return (sp_svg_read_pathv(svgd)[0] as Path).transformed(aff);
}
