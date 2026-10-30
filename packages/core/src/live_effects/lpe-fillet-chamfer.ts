// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-fillet-chamfer.cpp, src/live_effects/lpe-fillet-chamfer.h
/*
 * Author(s):
 *   Jabiertxo Arraiza Cenoz <jabier.arraiza@marker.es>
 *
 * Copyright (C) 2014 Author(s)
 */
import {
  are_near,
  CubicBezier,
  type Curve,
  cross,
  distance,
  dot,
  EllipticalArc,
  L2,
  LineSegment,
  middle_point,
  Path,
  type PathVector,
  Point,
  rad_from_deg,
} from '@inkscape-web/geom';
import { count_path_curves, is_straight_curve, pathv_to_linear_and_cubic_beziers } from '../helper/geom.ts';
import {
  arcLengthAt,
  NodeSatellite,
  NodeSatelliteType,
  nodeSatelliteTypeFromKey,
  timeAtArcLength,
} from '../helper/geom-nodesatellite.ts';
import { curveOf, PathVectorNodeSatellites } from '../helper/geom-pathvector_nodesatellites.ts';
import { _, C_, N_ } from '../i18n.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { SPRect } from '../object/sp-rect.ts';
import { SPShape } from '../object/sp-shape.ts';
import { convertUnit, svgLengthUnitAbbr } from '../svg/svg-length.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { HiddenParam } from './parameter/hidden.ts';
import { NodeSatelliteArrayParam } from './parameter/nodesatellitesarray.ts';
import { type Parameter, type ParamWidget, ScalarParam } from './parameter/parameter.ts';
import { UnitParam } from './parameter/unit.ts';

export enum Filletmethod {
  FM_AUTO,
  FM_ARC,
  FM_BEZIER,
  FM_END,
}

const FMConverter = new EnumDataConverter<Filletmethod>(
  [
    { id: Filletmethod.FM_AUTO, label: N_('Auto'), key: 'auto' },
    { id: Filletmethod.FM_ARC, label: N_('Force arc'), key: 'arc' },
    { id: Filletmethod.FM_BEZIER, label: N_('Force bezier'), key: 'bezier' },
  ],
  Filletmethod.FM_END,
);

const TYPE_KEYS: Record<NodeSatelliteType, string> = {
  [NodeSatelliteType.FILLET]: 'F',
  [NodeSatelliteType.INVERSE_FILLET]: 'IF',
  [NodeSatelliteType.CHAMFER]: 'C',
  [NodeSatelliteType.INVERSE_CHAMFER]: 'IC',
  [NodeSatelliteType.INVALID_SATELLITE]: 'KO',
};

/** The angle of the ray from a to b (upstream Geom::Ray::angle). */
const rayAngle = (a: Point, b: Point): number => Math.atan2(b.y - a.y, b.x - a.x);

/** Upstream angle_between(Ray, Ray, cw). */
function rayAngleBetween(v1: Point, v2: Point, cw: boolean): number {
  let angle = Math.atan2(cross(v1, v2), dot(v1, v2));
  if (angle < 0) angle += 2 * Math.PI;
  if (!cw) angle = 2 * Math.PI - angle;
  return angle;
}

/** Upstream angle_between(Line, Line). */
function lineAngleBetween(v1: Point, v2: Point): number {
  let angle = Math.atan2(cross(v1, v2), dot(v1, v2));
  if (angle < 0) angle += Math.PI;
  if (angle === Math.PI) angle = 0;
  return angle;
}

/**
 * Corners (upstream LPEFilletChamfer): rounds (fillet) or cuts (chamfer) the corners of the
 * path, with a knot per corner. The arc length math runs in WASM (helper/geom-nodesatellite.cpp).
 */
export class LPEFilletChamfer extends Effect {
  readonly unit: UnitParam;
  readonly nodesatellites_param: NodeSatelliteArrayParam;
  readonly method: EnumParam<Filletmethod>;
  readonly mode: HiddenParam;
  readonly radius: ScalarParam;
  readonly chamfer_steps: ScalarParam;
  readonly chamfer_scale: ScalarParam;
  readonly flexible: BoolParam;
  readonly only_selected: BoolParam;
  readonly use_knot_distance: BoolParam;
  readonly hide_knots: BoolParam;
  readonly apply_no_radius: BoolParam;
  readonly apply_with_radius: BoolParam;
  helperpath = false;
  previous_unit = '';
  _pathvector_nodesatellites: PathVectorNodeSatellites | null = null;
  _hp: PathVector = [];

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.unit = new UnitParam(_('Unit:'), _('Unit'), 'unit', this, 'px');
    this.nodesatellites_param = new NodeSatelliteArrayParam(
      'NodeSatellite_param',
      'NodeSatellite_param',
      'nodesatellites_param',
      this,
    );
    this.method = new EnumParam(
      _('Method:'),
      _('Method to calculate the fillet or chamfer'),
      'method',
      FMConverter,
      this,
      Filletmethod.FM_AUTO,
    );
    this.mode = new HiddenParam(_('Mode:'), _('Mode, e.g. fillet or chamfer'), 'mode', this, 'F', true);
    this.radius = new ScalarParam(_('Radius:'), _('Radius, in unit or %'), 'radius', this, 0.0);
    this.chamfer_steps = new ScalarParam(_('Chamfer steps:'), _('Chamfer steps'), 'chamfer_steps', this, 1);
    this.chamfer_scale = new ScalarParam(
      _('Chamfer scale (%):'),
      _('Scale chamfer steps toward the single-step chamfer line'),
      'chamfer_scale',
      this,
      100.0,
    );
    this.flexible = new BoolParam(_('Radius in %'), _('Flexible radius size (%)'), 'flexible', this, false);
    this.only_selected = new BoolParam(
      _('Change only selected nodes'),
      _('Change only selected nodes'),
      'only_selected',
      this,
      false,
    );
    this.use_knot_distance = new BoolParam(
      _('Use knots distance instead radius'),
      _('Use knots distance instead radius'),
      'use_knot_distance',
      this,
      true,
    );
    this.hide_knots = new BoolParam(_('Hide knots'), _('Hide knots'), 'hide_knots', this, false);
    this.apply_no_radius = new BoolParam(
      _('Apply changes if radius = 0'),
      _('Apply changes if radius = 0'),
      'apply_no_radius',
      this,
      true,
    );
    this.apply_with_radius = new BoolParam(
      _('Apply changes if radius > 0'),
      _('Apply changes if radius > 0'),
      'apply_with_radius',
      this,
      true,
    );
    const satellites_param = lpeobject.getAttribute('satellites_param');
    if (satellites_param) lpeobject.setAttribute('nodesatellites_param', satellites_param);
    this.registerParameter(this.nodesatellites_param);
    this.registerParameter(this.radius);
    this.registerParameter(this.unit);
    this.registerParameter(this.method);
    this.registerParameter(this.mode);
    this.registerParameter(this.chamfer_steps);
    this.registerParameter(this.chamfer_scale);
    this.registerParameter(this.flexible);
    this.registerParameter(this.use_knot_distance);
    this.registerParameter(this.apply_no_radius);
    this.registerParameter(this.apply_with_radius);
    this.registerParameter(this.only_selected);
    this.registerParameter(this.hide_knots);
    this.radius.param_set_range(0.0, Number.MAX_VALUE);
    this.radius.param_set_increments(1, 1);
    this.radius.param_set_digits(4);
    this.chamfer_steps.param_set_range(1, 2147483647);
    this.chamfer_steps.param_set_increments(1, 1);
    this.chamfer_steps.param_make_integer();
    this.chamfer_scale.param_set_range(0.0, 100.0);
    this.chamfer_scale.param_set_increments(1, 10);
    this.chamfer_scale.param_set_digits(2);
    this._provides_knotholder_entities = true;
    this._provides_path_adjustment = true;
  }

  /** The satellite type of the mode parameter. */
  #modeType(): NodeSatelliteType {
    return nodeSatelliteTypeFromKey(this.mode.param_getSVGValue()) ?? NodeSatelliteType.FILLET;
  }

  protected override doOnApply(lpeItem: SPLPEItem): void {
    if (!(lpeItem instanceof SPShape)) {
      console.warn('LPE Fillet/Chamfer can only be applied to shapes (not groups).');
      lpeItem.removeCurrentPathEffect(false);
      return;
    }
    let pathv = pathv_to_linear_and_cubic_beziers(lpeItem.curve() ?? []);
    let power = this.radius.get_value();
    // (upstream declares a second `a` inside the rect branch, so this one stays 0)
    const a = 0;
    const doc = this.getSPDoc();
    if (lpeItem instanceof SPRect && doc) {
      let ra = Math.max(lpeItem.getVisibleRx(), lpeItem.getVisibleRy());
      if (ra) {
        lpeItem.setRx(true, 0);
        lpeItem.setRy(true, 0);
        const r = lpeItem.getRect();
        const p = new Path(r.corner(0));
        for (let i = 1; i <= 3; i++) p.appendCurve(new LineSegment(p.finalPoint(), r.corner(i)));
        p.close();
        pathv = [p];
        if (!are_near(ra, 0)) {
          ra /= doc.getDocumentScale().x;
          this.unit.param_set_value(svgLengthUnitAbbr(doc.getRoot().width.unit));
          this.flexible.param_setValue(false);
          this.radius.param_set_value(ra);
          power = ra;
        }
      }
    }
    if (!this.flexible.get_value() && are_near(a, 0) && doc) {
      const trans = lpeItem.transform.inverse();
      power = convertUnit(power, this.unit.get_abbreviation(), 'px') / doc.getDocumentScale().x;
      power *= (trans.expansionX() + trans.expansionY()) / 2.0;
    }
    this._pathvector_nodesatellites ??= new PathVectorNodeSatellites();
    const nodesatellite = this.#newSatellite(power);
    this._pathvector_nodesatellites.recalculateForNewPathVector(pathv, nodesatellite);
    this.nodesatellites_param.setPathVectorNodeSatellites(this._pathvector_nodesatellites);
  }

  #newSatellite(power: number): NodeSatellite {
    const nodesatellite = new NodeSatellite(this.#modeType());
    nodesatellite.setSteps(this.chamfer_steps.get_value());
    nodesatellite.setAngle(this.chamfer_scale.get_value());
    nodesatellite.setAmount(power);
    nodesatellite.setIsTime(this.flexible.get_value());
    nodesatellite.setHasMirror(true);
    nodesatellite.setHidden(this.hide_knots.get_value());
    return nodesatellite;
  }

  override newWidget(): { param: Parameter | null; widget: ParamWidget }[] {
    const widgets = super.newWidget();
    // The radius, steps and scale widgets apply their value to the corners (upstream connects
    // their value_changed signals); the dialog calls applyParam() after writing them.
    widgets.push({
      param: null,
      widget: {
        kind: 'buttons',
        buttons: [
          { label: _('Fillet'), onClick: () => this.updateNodeSatelliteType(NodeSatelliteType.FILLET) },
          {
            label: _('Inverse fillet'),
            onClick: () => this.updateNodeSatelliteType(NodeSatelliteType.INVERSE_FILLET),
          },
        ],
      },
    });
    widgets.push({
      param: null,
      widget: {
        kind: 'buttons',
        buttons: [
          { label: _('Chamfer'), onClick: () => this.updateNodeSatelliteType(NodeSatelliteType.CHAMFER) },
          {
            label: _('Inverse chamfer'),
            onClick: () => this.updateNodeSatelliteType(NodeSatelliteType.INVERSE_CHAMFER),
          },
        ],
      },
    });
    return widgets;
  }

  /** Apply the radius, steps or scale widget to the corners (upstream value_changed handlers). */
  override onParamWidgetChanged(param: Parameter): void {
    if (param === this.radius) this.updateAmount();
    else if (param === this.chamfer_steps) this.updateChamferSteps();
    else if (param === this.chamfer_scale) this.updateChamferScale();
  }

  updateAmount(): void {
    const pvs = this._pathvector_nodesatellites;
    if (!pvs) return; // empty item
    this.setSelected(pvs);
    let power = this.radius.get_value();
    const doc = this.getSPDoc();
    if (!this.flexible.get_value() && doc) {
      power = convertUnit(power, this.unit.get_abbreviation(), 'px') / doc.getDocumentScale().x;
      const lpeitems = this.getCurrrentLPEItems();
      if (lpeitems.length === 1) {
        this.sp_lpe_item = lpeitems[0] as SPLPEItem;
        const trans = this.sp_lpe_item.transform.inverse();
        power *= (trans.expansionX() + trans.expansionY()) / 2.0;
      }
    }
    pvs.updateAmount(
      power,
      this.apply_no_radius.get_value(),
      this.apply_with_radius.get_value(),
      this.only_selected.get_value(),
      this.use_knot_distance.get_value(),
      this.flexible.get_value(),
    );
    this.nodesatellites_param.setPathVectorNodeSatellites(pvs);
  }

  updateChamferSteps(): void {
    const pvs = this._pathvector_nodesatellites;
    if (!pvs) return; // empty item
    this.setSelected(pvs);
    pvs.updateSteps(
      this.chamfer_steps.get_value(),
      this.apply_no_radius.get_value(),
      this.apply_with_radius.get_value(),
      this.only_selected.get_value(),
    );
    this.nodesatellites_param.setPathVectorNodeSatellites(pvs);
  }

  updateChamferScale(): void {
    const pvs = this._pathvector_nodesatellites;
    if (!pvs) return; // empty item
    this.setSelected(pvs);
    pvs.updateAngle(
      this.chamfer_scale.get_value(),
      this.apply_no_radius.get_value(),
      this.apply_with_radius.get_value(),
      this.only_selected.get_value(),
    );
    this.nodesatellites_param.setPathVectorNodeSatellites(pvs);
  }

  updateNodeSatelliteType(nodesatellitetype: NodeSatelliteType): void {
    const pvs = this._pathvector_nodesatellites;
    if (!pvs) return; // empty item
    this.mode.param_setValue(TYPE_KEYS[nodesatellitetype], true);
    this.setSelected(pvs);
    pvs.updateNodeSatelliteType(
      nodesatellitetype,
      this.apply_no_radius.get_value(),
      this.apply_with_radius.get_value(),
      this.only_selected.get_value(),
    );
    this.nodesatellites_param.setPathVectorNodeSatellites(pvs);
    this.makeUndoDone(C_('Undo', 'Change enumeration parameter'));
  }

  setSelected(pvs: PathVectorNodeSatellites): void {
    const lpeitems = this.getCurrrentLPEItems();
    if (lpeitems.length !== 1) return;
    this.sp_lpe_item = lpeitems[0] as SPLPEItem;
    const pathv = pvs.getPathVector();
    const nodesatellites = pvs.getNodeSatellites();
    nodesatellites.forEach((sats, i) => {
      sats.forEach((s, j) => {
        const curve_in = curveOf(pathv[i] as Path, j);
        s.setSelected(this.only_selected.get_value() && this.isNodePointSelected(curve_in.initialPoint()));
      });
    });
    pvs.setNodeSatellites(nodesatellites);
  }

  protected override doBeforeEffect(lpeItem: SPLPEItem): void {
    if (this.pathvector_before_effect.length === 0) return;
    if (!(lpeItem instanceof SPShape)) {
      console.warn('LPE Fillet can only be applied to shapes (not groups).');
      return;
    }
    const legacy_without_chamfer_scale = this.is_load && !this.getLPEObj().getAttribute('chamfer_scale');
    //fillet chamfer specific calls
    this.nodesatellites_param.setUseDistance(this.use_knot_distance.get_value());
    this.nodesatellites_param.setCurrentZoom(this.current_zoom);
    //mandatory call
    this.nodesatellites_param.setEffectType(this.effectType());
    const pathv = pathv_to_linear_and_cubic_beziers(this.pathvector_before_effect);
    let nodesatellites = this.nodesatellites_param.data().map((v) => v.map((s) => s.clone()));
    if (nodesatellites.length === 0) {
      this.doOnApply(lpeItem); // dont want _impl to not update versioning
      nodesatellites = this.nodesatellites_param.data().map((v) => v.map((s) => s.clone()));
    }
    const flexible = this.flexible.get_value();
    for (let i = 0; i < nodesatellites.length; ++i) {
      // We have more nodesatellites vectors than paths. This could happen if two paths are merged.
      if (i >= pathv.length) break;
      const path = pathv[i] as Path;
      const sats = nodesatellites[i] as NodeSatellite[];
      const curves_in_path = count_path_curves(path);
      for (let j = 0; j < sats.length; ++j) {
        // We have more nodesatellite points than curves in path. This could happen if a path is
        // shortened (the last node is deleted).
        if (j >= curves_in_path) break;
        const s = sats[j] as NodeSatellite;
        const curve_in = curveOf(path, j);
        if (s.is_time !== flexible) {
          s.is_time = flexible;
          const amount = s.amount;
          if (s.is_time) s.amount = timeAtArcLength(amount, curve_in);
          else s.amount = arcLengthAt(amount, curve_in);
        }
        s.hidden = this.hide_knots.get_value();
        if (legacy_without_chamfer_scale) s.angle = 100.0;
        if (this.only_selected.get_value() && this.isNodePointSelected(curve_in.initialPoint()))
          s.setSelected(true);
      }
      if (!path.closed() && sats.length > 0) {
        (sats[0] as NodeSatellite).amount = 0;
        (sats[sats.length - 1] as NodeSatellite).amount = 0;
      }
    }
    this._pathvector_nodesatellites ??= new PathVectorNodeSatellites();
    if (this.is_load || this._adjust_path) {
      let power = this.radius.get_value();
      const doc = this.getSPDoc();
      if (!flexible && doc) {
        power = convertUnit(power, this.unit.get_abbreviation(), 'px') / doc.getDocumentScale().x;
      }
      this._adjust_path = false; // not wait till effect finish
      const nodesatellite = this.#newSatellite(power);
      this._pathvector_nodesatellites.setNodeSatellites(nodesatellites);
      this._pathvector_nodesatellites.recalculateForNewPathVector(pathv, nodesatellite);
      this.nodesatellites_param.setPathVectorNodeSatellites(this._pathvector_nodesatellites, true);
      this.nodesatellites_param.reloadKnots();
    } else {
      this._pathvector_nodesatellites.setPathVector(pathv);
      this._pathvector_nodesatellites.setNodeSatellites(nodesatellites);
      this.nodesatellites_param.setPathVectorNodeSatellites(this._pathvector_nodesatellites, false);
    }
  }

  override adjustForNewPath(): void {
    this._adjust_path = true;
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.push(this._hp);
  }

  addChamferSteps(
    tmp_path: Path,
    path_chamfer: Path,
    end_arc_point: Point,
    steps: number,
    scale: number,
  ): void {
    this.setSelected(this._pathvector_nodesatellites as PathVectorNodeSatellites);
    const start_arc_point = tmp_path.finalPoint();
    if (steps <= 1) {
      tmp_path.appendCurve(new LineSegment(start_arc_point, end_arc_point));
      return;
    }
    const clamped_scale = Math.min(Math.max(scale, 0.0), 100.0);
    const scale_factor = clamped_scale / 100.0;
    const line = end_arc_point.sub(start_arc_point);
    const line_length = L2(line);
    const can_project = line_length > 1e-6;
    const normal = can_project ? new Point(-line.y, line.x).div(line_length) : new Point(0, 0);
    const path_subdivision = 1.0 / steps;
    for (let i = 1; i < steps; i++) {
      let chamfer_step = path_chamfer.pointAt(path_subdivision * i);
      if (can_project && scale_factor < 1.0) {
        const signed_distance = dot(chamfer_step.sub(start_arc_point), normal);
        chamfer_step = chamfer_step.sub(normal.mul(signed_distance * (1.0 - scale_factor)));
      }
      tmp_path.appendCurve(new LineSegment(tmp_path.finalPoint(), chamfer_step));
    }
    tmp_path.appendCurve(new LineSegment(tmp_path.finalPoint(), end_arc_point));
  }

  /** Convert the original path to the LPE path. */
  protected override doEffect_path(path_in: PathVector): PathVector {
    const pvs = this._pathvector_nodesatellites;
    if (!pvs) return path_in; // Empty item pathv with lpe
    const GAP_HELPER = 0.00001;
    const K = (4.0 / 3.0) * (Math.sqrt(2.0) - 1.0);
    const pathv = pvs.getPathVector();
    const nodesatellites = pvs.getNodeSatellites();
    const method = this.method.get_value();
    const path_out: PathVector = [];
    pathv.forEach((path_it, path) => {
      if (path_it.empty()) return;
      let curves = path_it.curves();
      if (path_it.closed()) {
        const closingline = path_it.closingSegment(); // Always a Geom::LineSegment.
        if (are_near(closingline.initialPoint(), closingline.finalPoint())) curves = path_it.openCurves();
      }
      const sats = nodesatellites[path] ?? [];
      const tcurves = count_path_curves(path_it);
      if (tcurves < 2) {
        path_out.push(path_it);
        return;
      }
      const tmp_path = new Path();
      let time0 = 0;
      for (let curve = 0; curve < curves.length; curve++) {
        const curve_it1 = curves[curve] as Curve;
        let next_index = curve + 1;
        if (curve === tcurves - 1 && path_it.closed()) next_index = 0;
        if (curve === tcurves - 1 && !path_it.closed()) {
          if (time0 !== 1) {
            const last_curve = curve_it1.portion(time0, 1);
            // Seamless connection.
            tmp_path.appendCurve(last_curve.reverse().withFinal(tmp_path.finalPoint()).reverse());
          }
          break; // We're done!
        }
        const curve_it2 = curveOf(path_it, next_index);
        const nodesatellite = sats[next_index] ?? new NodeSatellite();
        if (curve === 0) {
          time0 = !path_it.closed() ? 0 : (sats[0] as NodeSatellite).time(curve_it1);
        }
        const s = nodesatellite.arcDistance(curve_it2);
        let time1 = nodesatellite.timeAt(s, true, curve_it1);
        let time2 = nodesatellite.time(curve_it2);
        if (time1 <= time0) time1 = time0;
        if (time2 > 1) time2 = 1;
        let knot_curve_1 = curve_it1.portion(time0, time1);
        const knot_curve_2 = curve_it2.portion(time2, 1);
        if (curve > 0) {
          knot_curve_1 = knot_curve_1.reverse().withFinal(tmp_path.finalPoint()).reverse();
        } else {
          tmp_path.start(curve_it1.pointAt(time0));
        }
        let start_arc_point = knot_curve_1.finalPoint();
        let end_arc_point = curve_it2.pointAt(time2);
        if (time2 === 1) end_arc_point = curve_it2.pointAt(time2 - GAP_HELPER);
        if (time1 === time0) start_arc_point = curve_it1.pointAt(time1 + GAP_HELPER);
        const curveit1 = curve_it1.finalPoint();
        const curveit2 = curve_it2.initialPoint();
        const k1 = distance(start_arc_point, curveit1) * K;
        const k2 = distance(curve_it2.initialPoint(), end_arc_point) * K;
        // rays as (origin, through)
        let ray_1: [Point, Point] = [start_arc_point, curveit1];
        let ray_2: [Point, Point] = [curveit2, end_arc_point];
        if (knot_curve_1 instanceof CubicBezier) ray_1 = [knot_curve_1.controlPoint(2), start_arc_point];
        if (knot_curve_2 instanceof CubicBezier) ray_2 = [end_arc_point, knot_curve_2.controlPoint(1)];
        let ccw_toggle = cross(curveit1.sub(start_arc_point), end_arc_point.sub(start_arc_point)) < 0;
        const v1 = ray_1[1].sub(ray_1[0]);
        const v2 = ray_2[1].sub(ray_2[0]);
        const angle = rayAngleBetween(v1, v2, ccw_toggle);
        const ray1_angle = rayAngle(ray_1[0], ray_1[1]);
        const ray2_angle = rayAngle(ray_2[0], ray_2[1]);
        let handle_angle_1 = ray1_angle - angle;
        let handle_angle_2 = ray2_angle + angle;
        if (ccw_toggle) {
          handle_angle_1 = ray1_angle + angle;
          handle_angle_2 = ray2_angle - angle;
        }
        let handle_1 = Point.polar(ray1_angle, k1).add(start_arc_point);
        const handle_2 = end_arc_point.sub(Point.polar(ray2_angle, k2));
        let inverse_handle_1 = Point.polar(handle_angle_1, k1).add(start_arc_point);
        const inverse_handle_2 = end_arc_point.sub(Point.polar(handle_angle_2, k2));
        if (time0 === 1) {
          handle_1 = start_arc_point;
          inverse_handle_1 = start_arc_point;
        }
        if (time2 === 1) end_arc_point = curve_it2.pointAt(time2);
        if (time1 === time0) start_arc_point = curve_it1.pointAt(time0);
        if (
          time1 !== 1 && // We have a section to replace
          !are_near(angle, rad_from_deg(360)) && // It's not a straight connection
          !curve_it1.isDegenerate() && // Curves are not degenerate.
          !curve_it2.isDegenerate()
        ) {
          if (time1 !== time0 || (time1 === 1 && time0 === 1)) {
            if (!knot_curve_1.isDegenerate()) tmp_path.appendCurve(knot_curve_1);
          }
          const type = nodesatellite.nodesatellite_type;
          const steps = nodesatellite.steps || 1;
          const arc_angle = lineAngleBetween(new Point(1, 0), end_arc_point.sub(start_arc_point));
          const radius =
            distance(start_arc_point, middle_point(start_arc_point, end_arc_point)) / Math.sin(angle / 2.0);
          const rx = radius;
          const ry = rx;
          const eliptical =
            (is_straight_curve(curve_it1) &&
              is_straight_curve(curve_it2) &&
              method !== Filletmethod.FM_BEZIER) ||
            method === Filletmethod.FM_ARC;
          const from = tmp_path.finalPoint();
          switch (type) {
            case NodeSatelliteType.CHAMFER: {
              const path_chamfer = new Path(from);
              if (eliptical) {
                ccw_toggle = !ccw_toggle;
                path_chamfer.appendCurve(
                  new EllipticalArc(from, rx, ry, arc_angle, false, ccw_toggle, end_arc_point),
                );
              } else {
                path_chamfer.appendCurve(new CubicBezier(from, handle_1, handle_2, end_arc_point));
              }
              this.addChamferSteps(tmp_path, path_chamfer, end_arc_point, steps, nodesatellite.angle);
              break;
            }
            case NodeSatelliteType.INVERSE_CHAMFER: {
              const path_chamfer = new Path(from);
              if (eliptical) {
                path_chamfer.appendCurve(
                  new EllipticalArc(from, rx, ry, arc_angle, false, ccw_toggle, end_arc_point),
                );
              } else {
                path_chamfer.appendCurve(
                  new CubicBezier(from, inverse_handle_1, inverse_handle_2, end_arc_point),
                );
              }
              this.addChamferSteps(tmp_path, path_chamfer, end_arc_point, steps, nodesatellite.angle);
              break;
            }
            case NodeSatelliteType.INVERSE_FILLET:
              if (eliptical) {
                tmp_path.appendCurve(
                  new EllipticalArc(from, rx, ry, arc_angle, false, ccw_toggle, end_arc_point),
                );
              } else {
                tmp_path.appendCurve(
                  new CubicBezier(from, inverse_handle_1, inverse_handle_2, end_arc_point),
                );
              }
              break;
            default: // Fillet
              if (eliptical) {
                ccw_toggle = !ccw_toggle;
                tmp_path.appendCurve(
                  new EllipticalArc(from, rx, ry, arc_angle, false, ccw_toggle, end_arc_point),
                );
              } else {
                tmp_path.appendCurve(new CubicBezier(from, handle_1, handle_2, end_arc_point));
              }
              break;
          }
        } else if (!knot_curve_1.isDegenerate()) {
          tmp_path.appendCurve(knot_curve_1);
        }
        time0 = time2;
      }
      if (path_it.closed()) tmp_path.close();
      path_out.push(tmp_path);
    });
    if (this.helperpath) {
      this._hp = path_out;
      return this.pathvector_after_effect; // Original path vector
    }
    this._hp = [];
    return path_out;
  }
}
