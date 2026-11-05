// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-attach-path.cpp, src/live_effects/lpe-attach-path.h
/*
 * Copyright (C) Theodore Janeczko 2012 <flutterguy317@gmail.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  are_near,
  CubicBezier,
  type Curve,
  Path,
  type PathVector,
  Point,
  write_svg_path,
} from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../object/sp-object.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { OriginalPathParam } from './parameter/originalpath.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { TransformedPointParam } from './parameter/transformedpoint.ts';
import { VectorParam } from './parameter/vector.ts';

/**
 * The point and the first n derivatives of c at t (upstream Curve::pointAndDerivatives). They come
 * from 2geom in WASM: the effect takes angles of derivatives that may be zero up to rounding.
 */
export function pointAndDerivatives(c: Curve, t: number, n: number): Point[] {
  const path = new Path(c.initialPoint());
  path.appendCurve(c);
  const v = pathBoolopBackend().curvePointAndDerivatives(write_svg_path([path]), t, n);
  const result: Point[] = [];
  for (let i = 0; i + 1 < v.length; i += 2) result.push(new Point(v[i] as number, v[i + 1] as number));
  return result;
}

const atan2 = (p: Point) => Math.atan2(p.y, p.x);

/**
 * Attach path (upstream LPEAttachPath): connects the ends of the path with a curve to a position
 * on one or two other paths.
 */
export class LPEAttachPath extends Effect {
  readonly start_path: OriginalPathParam;
  readonly start_path_position: ScalarParam;
  readonly start_path_curve_start: TransformedPointParam;
  readonly start_path_curve_end: VectorParam;
  readonly end_path: OriginalPathParam;
  readonly end_path_position: ScalarParam;
  readonly end_path_curve_start: TransformedPointParam;
  readonly end_path_curve_end: VectorParam;
  curve_start_previous_origin: Point;
  curve_end_previous_origin: Point;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.start_path = new OriginalPathParam(
      _('Start path:'),
      _('Path to attach to the start of this path'),
      'startpath',
      this,
    );
    this.start_path_position = new ScalarParam(
      _('Start path position:'),
      _('Position to attach path start to'),
      'startposition',
      this,
      0.0,
    );
    this.start_path_curve_start = new TransformedPointParam(
      _('Start path curve start:'),
      _('Starting curve'),
      'startcurvestart',
      this,
      new Point(20, 0) /*, true*/,
    );
    this.start_path_curve_end = new VectorParam(
      _('Start path curve end:'),
      _('Ending curve'),
      'startcurveend',
      this,
      new Point(20, 0) /*, true*/,
    );
    this.end_path = new OriginalPathParam(
      _('End path:'),
      _('Path to attach to the end of this path'),
      'endpath',
      this,
    );
    this.end_path_position = new ScalarParam(
      _('End path position:'),
      _('Position to attach path end to'),
      'endposition',
      this,
      0.0,
    );
    this.end_path_curve_start = new TransformedPointParam(
      _('End path curve start:'),
      _('Starting curve'),
      'endcurvestart',
      this,
      new Point(20, 0) /*, true*/,
    );
    this.end_path_curve_end = new VectorParam(
      _('End path curve end:'),
      _('Ending curve'),
      'endcurveend',
      this,
      new Point(20, 0) /*, true*/,
    );
    this.registerParameter(this.start_path);
    this.registerParameter(this.start_path_position);
    this.registerParameter(this.start_path_curve_start);
    this.registerParameter(this.start_path_curve_end);

    this.registerParameter(this.end_path);
    this.registerParameter(this.end_path_position);
    this.registerParameter(this.end_path_curve_start);
    this.registerParameter(this.end_path_curve_end);

    //perceived_path = true;
    this.show_orig_path = true;
    this.curve_start_previous_origin = this.start_path_curve_end.getOrigin();
    this.curve_end_previous_origin = this.end_path_curve_end.getOrigin();
    this.start_path.setUpdating(true);
    this.end_path.setUpdating(true);
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    this.curve_start_previous_origin = this.start_path_curve_end.getOrigin();
    this.curve_end_previous_origin = this.end_path_curve_end.getOrigin();
  }

  protected override doBeforeEffect(_lpeitem: SPLPEItem): void {
    if (this.is_load) {
      this.start_path.reload();
      this.end_path.reload();
      this.end_path.getObject()?.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
      this.start_path.getObject()?.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    }
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    this.start_path.reload();
    this.end_path.reload();
    return false;
  }

  /** The position as a flat time on path, clamped to [0, size] (upstream: written back to the parameter). */
  #clampPosition(position: ScalarParam, path: Path): number {
    if (position.get_value() > path.size()) position.param_set_value(path.size());
    else if (position.get_value() < 0) position.param_set_value(0);
    return position.get_value();
  }

  /** The curve and time on path at the flat time pos. */
  #curveAt(path: Path, pos: number): [Curve, number] {
    return pos >= path.size()
      ? [path.at(path.size() - 1), 1]
      : [path.at(Math.trunc(pos)), pos - Math.trunc(pos)];
  }

  /** The flat time of the nearest point on path (upstream Path::nearestTime().asFlatTime(), from 2geom in WASM). */
  #nearestFlatTime(path: Path, p: Point): number {
    return pathBoolopBackend().pathNearestFlatTime(write_svg_path([path]), p.x, p.y);
  }

  override doEffect(curve: PathVector): PathVector {
    const front = curve[0];
    if (!this.sp_lpe_item || !front) return curve;
    let p = new Path(front.initialPoint());

    const set_start_end = !this.start_path_curve_end.getOrigin().equals(this.curve_start_previous_origin);
    const set_end_end = !this.end_path_curve_end.getOrigin().equals(this.curve_end_previous_origin);

    const start_obj = this.start_path.getObject();
    if (this.start_path.linksToPath() && start_obj) {
      const linked_pathv = this.start_path.get_pathvector();
      const linkedtransform = start_obj.getRelativeTransform(this.sp_lpe_item);
      const linked_front = linked_pathv[0];
      if (linked_front) {
        const transformedpath = linked_front.transformed(linkedtransform);
        this.start_path_curve_start.setOrigin(front.initialPoint());
        const derivs = pointAndDerivatives(front.at(0), 0, 3);
        for (let deriv_n = 1; deriv_n < derivs.length; deriv_n++) {
          const length = (derivs[deriv_n] as Point).length();
          if (!are_near(length, 0)) {
            if (set_start_end) {
              this.start_path_position.param_set_value(
                this.#nearestFlatTime(transformedpath, this.start_path_curve_end.getOrigin()),
              );
            }
            const pos = this.#clampPosition(this.start_path_position, transformedpath);
            const [c, t] = this.#curveAt(transformedpath, pos);
            const derivs_2 = pointAndDerivatives(c, t, 3);
            for (let deriv_n_2 = 1; deriv_n_2 < derivs_2.length; deriv_n_2++) {
              // (upstream reads derivs here, not derivs_2)
              const length_2 = (derivs[deriv_n_2] as Point).length();
              if (!are_near(length_2, 0)) {
                const at = derivs_2[0] as Point;
                this.start_path_curve_end.setOrigin(at);
                this.curve_start_previous_origin = this.start_path_curve_end.getOrigin();
                const startv = this.start_path_curve_start.getVector();
                const endv = this.start_path_curve_end.getVector();
                const startangle = atan2(startv);
                const endangle = atan2(endv);
                const startderiv = atan2(derivs[deriv_n] as Point);
                const endderiv = atan2(derivs_2[deriv_n_2] as Point);
                const pt1 = Point.polar(startangle + startderiv, startv.length());
                const pt2 = Point.polar(endangle + endderiv, endv.length());
                p = new Path(at);
                p.appendCurve(
                  new CubicBezier(at, at.sub(pt2), front.initialPoint().sub(pt1), front.initialPoint()),
                );
                break;
              }
            }
            break;
          }
        }
      }
    }

    p.append(front);

    const end_obj = this.end_path.getObject();
    if (this.end_path.linksToPath() && end_obj) {
      const linked_pathv = this.end_path.get_pathvector();
      const linkedtransform = end_obj.getRelativeTransform(this.sp_lpe_item);
      const linked_front = linked_pathv[0];
      if (linked_front) {
        const transformedpath = linked_front.transformed(linkedtransform);
        const last_seg_reverse = (
          front.size() > 0 ? front.at(front.size() - 1) : front.closingSegment()
        ).reverse();
        this.end_path_curve_start.setOrigin(last_seg_reverse.initialPoint());
        const derivs = pointAndDerivatives(last_seg_reverse, 0, 3);
        for (let deriv_n = 1; deriv_n < derivs.length; deriv_n++) {
          const length = (derivs[deriv_n] as Point).length();
          if (!are_near(length, 0)) {
            if (set_end_end) {
              this.end_path_position.param_set_value(
                this.#nearestFlatTime(transformedpath, this.end_path_curve_end.getOrigin()),
              );
            }
            const pos = this.#clampPosition(this.end_path_position, transformedpath);
            const [c, t] = this.#curveAt(transformedpath, pos);
            const derivs_2 = pointAndDerivatives(c, t, 3);
            for (let deriv_n_2 = 1; deriv_n_2 < derivs_2.length; deriv_n_2++) {
              // (upstream reads derivs here, not derivs_2)
              const length_2 = (derivs[deriv_n_2] as Point).length();
              if (!are_near(length_2, 0)) {
                const at = derivs_2[0] as Point;
                this.end_path_curve_end.setOrigin(at);
                this.curve_end_previous_origin = this.end_path_curve_end.getOrigin();
                const startv = this.end_path_curve_start.getVector();
                const endv = this.end_path_curve_end.getVector();
                const startangle = atan2(startv);
                const endangle = atan2(endv);
                const startderiv = atan2(derivs[deriv_n] as Point);
                const endderiv = atan2(derivs_2[deriv_n_2] as Point);
                const pt1 = Point.polar(startangle + startderiv, startv.length());
                const pt2 = Point.polar(endangle + endderiv, endv.length());
                p.appendCurve(new CubicBezier(p.finalPoint(), front.finalPoint().sub(pt1), at.sub(pt2), at));
                break;
              }
            }
            break;
          }
        }
      }
    }
    return [p];
  }
}
