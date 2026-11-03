// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/powerstrokepointarray.cpp, src/live_effects/parameter/powerstrokepointarray.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 */
import {
  type Affine,
  BezierCurve,
  type Curve,
  curve_nearest_time,
  distanceSq,
  dot,
  type Path,
  type PathVector,
  Point,
  pathv_nearest_time,
} from '@inkscape-web/geom';
import { count_path_curves } from '../../helper/geom.ts';
import { _, C_ } from '../../i18n.ts';
import type { SPItem } from '../../object/sp-item.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../../object/sp-lpe-item.ts';
import { Preferences } from '../../preferences.ts';
import {
  type KnotHolder,
  KnotHolderEntity,
  type KnotState,
  knot_state_ctrl,
} from '../../ui/knot/knot-holder-entity.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { PointArrayParam } from './array.ts';
import type { ParamWidget } from './parameter.ts';

/** The effect that owns the parameter (upstream casts to LPEPowerStroke). */
interface PowerStrokeLike extends Effect {
  knotdragging: boolean;
  not_jump: { get_value(): boolean };
}

const KNOT_TIP = () =>
  _(
    '<b>Stroke width control point</b>: drag to alter the stroke width. <b>Ctrl+click</b> adds a control point, <b>Ctrl+Alt+click</b> deletes it, <b>Shift+click</b> launches width dialog.',
  );

/** Derivative of a Bezier curve at t (de Casteljau on the hodograph). */
function derivativeAt(c: Curve, t: number): Point {
  if (!(c instanceof BezierCurve)) {
    const e = 1e-6;
    return c.pointAt(Math.min(1, t + e)).sub(c.pointAt(Math.max(0, t - e)));
  }
  const pts = c.controlPoints();
  const n = pts.length - 1;
  let q = pts.slice(1).map((p, i) => p.sub(pts[i] as Point).mul(n));
  if (q.length === 0) return new Point(0, 0);
  while (q.length > 1) q = q.slice(1).map((b, i) => (q[i] as Point).lerp(t, b));
  return q[0] as Point;
}

/**
 * The input path of the effect as one function of time (upstream: the Piecewise<D2<SBasis>>
 * paths_to_pw(pathv)): curve i spans the times [i, i + 1).
 */
export class PathTime {
  readonly curves: Curve[];
  constructor(readonly pathv: PathVector) {
    this.curves = pathv.flatMap((p) => [...p.curves()]);
  }
  empty(): boolean {
    return this.curves.length === 0;
  }
  #at(t: number): [Curve, number] {
    const n = this.curves.length;
    const i = Math.min(Math.max(Math.floor(t), 0), n - 1);
    return [this.curves[i] as Curve, t - i];
  }
  valueAt(t: number): Point {
    const [c, s] = this.#at(t);
    return c.pointAt(s);
  }
  /** The unit normal (rot90 of the unit tangent) at t. */
  normalAt(t: number): Point {
    const [c, s] = this.#at(t);
    let d = derivativeAt(c, s);
    if (d.length() < 1e-9) d = derivativeAt(c, Math.min(1, Math.max(0, s + (s < 0.5 ? 1e-3 : -1e-3))));
    if (d.length() < 1e-12) return new Point(0, 0);
    const u = d.normalized();
    return new Point(-u.y, u.x);
  }
  /** Time of the nearest point in [from, to] (upstream nearest_time(p, pwd2, from, to)). */
  nearestTime(p: Point, from = 0, to = this.curves.length): number {
    let best = from;
    let mind = Number.POSITIVE_INFINITY;
    const first = Math.max(0, Math.floor(from));
    const last = Math.min(this.curves.length, Math.ceil(to));
    for (let i = first; i < last; i++) {
      const c = this.curves[i] as Curve;
      const t = curve_nearest_time(p, c);
      const d = distanceSq(c.pointAt(t), p);
      if (d < mind) {
        mind = d;
        best = i + t;
      }
    }
    return Math.min(Math.max(best, from), to);
  }
}

/** The number of curves of the paths before path i (upstream sp_calculate_origin). */
function sp_calculate_origin(i: number, pathv: PathVector): number {
  let origin = 0;
  for (let pos = 0; pos < i && pos < pathv.length; pos++) origin += count_path_curves(pathv[pos] as Path);
  return origin;
}

/**
 * The width points of Power stroke (upstream PowerStrokePointArrayParam): (t, width) with t the
 * time along the path (curve index + time on the curve). Each point has a knot.
 */
export class PowerStrokePointArrayParam extends PointArrayParam {
  knot_color = 0xff88ff00;
  _scale_width = 1;
  unplaced = false;
  current_path = -1;
  #last: PathTime = new PathTime([]);

  constructor(label: string, tip: string, key: string, effect: Effect) {
    super(label, tip, key, effect, 0);
  }

  override param_newWidget(): ParamWidget | null {
    return null;
  }

  override param_update_default(_default_value: string): void {}

  override param_transform_multiply(postmul: Affine, _set: boolean): void {
    // Check if proportional stroke-width scaling is on
    const transform_stroke = Preferences.get().getBool('/options/transform/stroke', true);
    if (transform_stroke) {
      // scale each width knot with the average scaling in X and Y
      this.param_set_and_write_new_value(this._vector.map((p) => new Point(p.x, p.y * postmul.descrim())));
    }
  }

  effect(): PowerStrokeLike {
    return this.param_effect as PowerStrokeLike;
  }

  set_scale_width(scale_width: number): void {
    this._scale_width = scale_width;
  }

  /** Store the input path (upstream set_pwd2 with the path and its normals). */
  set_pwd2(pathv: PathVector): void {
    this.#last = new PathTime(pathv);
  }
  get_pwd2(): PathTime {
    return this.#last;
  }

  /** Recalculate the control points so that they stay at the same place on the new path. */
  recalculate_controlpoints(pv: PathVector): void {
    for (let index = 0; index < this._vector.length; index++) this.knot_reposition(index, pv);
    this.write_to_SVG();
  }

  knot_get(index: number): Point {
    const pwd2 = this.#last;
    const offset_point = this._vector[index];
    if (!offset_point || pwd2.empty() || offset_point.x > pwd2.curves.length || offset_point.x < 0) {
      console.warn(`Broken powerstroke point at ${offset_point?.x}, I won't try to add that`);
      return new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    }
    return pwd2
      .valueAt(offset_point.x)
      .add(pwd2.normalAt(offset_point.x).mul(offset_point.y * this._scale_width));
  }

  knot_reposition(index: number, pathv: PathVector): Point {
    const p = this.knot_get(index);
    const pos = pathv_nearest_time(pathv, p);
    const v = this._vector[index];
    if (pos && v) {
      this._vector[index] = new Point(
        sp_calculate_origin(pos.path_index, pathv) + pos.curve_index + pos.t,
        v.y,
      );
    }
    return p;
  }

  /** Recalculate the control points when the path is reversed. */
  reverse_controlpoints(write: boolean): Point[] {
    const last = this.#last;
    if (last.empty()) return [];
    const n = last.curves.length;
    const controlpoints = this._vector.map((i) => {
      const control_pos = last.valueAt(i.x);
      return new Point(n - last.nearestTime(control_pos), i.y);
    });
    this._vector = controlpoints;
    if (write) this.write_to_SVG();
    return controlpoints;
  }

  median_width(): number {
    const size = this._vector.length;
    if (size === 0) return 1;
    if (size % 2 === 0) {
      return ((this._vector[size / 2 - 1] as Point).y + (this._vector[size / 2] as Point).y) / 2;
    }
    return (this._vector[Math.floor(size / 2)] as Point).y;
  }

  override providesKnotHolderEntities(): boolean {
    return true;
  }

  override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    for (let i = 0; i < this._vector.length; ++i) {
      const e = new PowerStrokePointArrayParamKnotHolderEntity(this, i);
      e.create(null, item, knotholder, 'CANVAS_ITEM_CTRL_TYPE_LPE', 'LPE:PowerStroke', KNOT_TIP());
      knotholder.add(e);
    }
  }

  override paramType(): ParamType {
    return ParamType.POWERSTROKE_POINT_ARRAY;
  }
}

let prev_index = 0;

export class PowerStrokePointArrayParamKnotHolderEntity extends KnotHolderEntity {
  constructor(
    readonly _pparam: PowerStrokePointArrayParam,
    public _index: number,
  ) {
    super();
  }

  valid_index(index: number): boolean {
    return this._pparam._vector.length > index;
  }

  knot_set(p: Point, _origin: Point, state: KnotState): void {
    if (!this.valid_index(this._index)) return;
    const ps = this._pparam.effect();
    ps.knotdragging = true;
    const pwd2 = this._pparam.get_pwd2();
    const s = this.snap_knot_position(p, state);
    const t2 = (this._pparam._vector[this._index] as Point).x;
    // the time range of the subpath of the point
    let begin = 0;
    let end = 0;
    let i = 0;
    for (const path of pwd2.pathv) {
      const psize = path.size();
      if (t2 >= begin && t2 <= begin + psize) {
        end = begin + psize;
        this._pparam.current_path = i;
        break;
      }
      i++;
      if (path.closed()) i++;
      begin += psize;
    }
    let pos: number;
    if (this._pparam.unplaced) pos = pwd2.nearestTime(s);
    else pos = pwd2.nearestTime(s, begin, end);
    const index = Math.floor(pos);
    if ((pos === begin || pos === end) && pwd2.pathv.length > 1) this._pparam.unplaced = true;
    let bigjump = false;
    if (Math.abs(prev_index - index) > 1) bigjump = true;
    else prev_index = index;
    let t = this._pparam.unplaced ? pwd2.nearestTime(s) : pwd2.nearestTime(s, begin, end);
    if (ps.not_jump.get_value() && bigjump) t = t2;
    const offset = dot(s.sub(pwd2.valueAt(t)), pwd2.normalAt(t));
    this._pparam._vector[this._index] = new Point(t, offset / this._pparam._scale_width);
    if (this._pparam._vector.length === 1) {
      Preferences.get().setDouble('/live_effects/powerstroke/width', offset);
    }
    if (this.item && 'path_effect_list' in this.item) {
      sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, false);
    }
  }

  knot_get(): Point {
    if (!this.valid_index(this._index)) return new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    return this._pparam.knot_get(this._index);
  }

  knot_ungrabbed(_p: Point, _origin: Point, _state: KnotState): void {
    if (this._pparam.unplaced) {
      this._pparam.unplaced = false;
      this._pparam.current_path = -1;
    }
    this._pparam.effect().knotdragging = false;
    this._pparam.effect().makeUndoDone(C_('Undo', 'Move handle'));
  }

  override knot_click(state: KnotState): void {
    // TODO: Shift+click opens the Power stroke width dialog.
    if (!knot_state_ctrl(state)) return;
    const vec = this._pparam._vector;
    const holder = this.parent_holder as (KnotHolder & { entity?: KnotHolderEntity[] }) | null;
    const siblings = (holder?.entity ?? []).filter(
      (e): e is PowerStrokePointArrayParamKnotHolderEntity =>
        e instanceof PowerStrokePointArrayParamKnotHolderEntity && e._pparam === this._pparam,
    );
    if (state.altKey) {
      // delete the clicked knot
      if (vec.length > 1) {
        //Force don't remove last knot
        vec.splice(this._index, 1);
        this._pparam.param_set_and_write_new_value(vec);
        // shift knots down one index
        for (const e of siblings) if (e._index > this._index) --e._index;
        // temporary hide, when knotholder were recreated it finally drop
        this.knot?.hide();
      }
      return;
    }
    // add a knot to XML
    vec.splice(this._index, 0, vec[this._index] as Point); // this clicked knot is duplicated
    this._pparam.param_set_and_write_new_value(vec);
    // shift knots up one index
    for (const e of siblings) if (e._index > this._index) ++e._index;
    // add knot to knotholder
    if (holder && this.item) {
      const e = new PowerStrokePointArrayParamKnotHolderEntity(this._pparam, this._index + 1);
      e.create(null, this.item, holder, 'CANVAS_ITEM_CTRL_TYPE_LPE', 'LPE:PowerStroke', KNOT_TIP());
      holder.add(e);
    }
  }
}
