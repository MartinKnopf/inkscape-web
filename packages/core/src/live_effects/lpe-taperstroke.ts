// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-taperstroke.cpp, src/live_effects/lpe-taperstroke.h
/**
 * @file
 * Taper Stroke path effect, provided as an alternative to Power Strokes
 * for otherwise constant-width paths.
 *
 * Authors:
 *   Liam P White
 *
 * Copyright (C) 2014-2020 Authors
 */
import {
  type Affine,
  are_near,
  LineSegment,
  Path,
  type PathVector,
  Point,
  pathv_nearest_time,
  write_svg_path,
} from '@inkscape-web/geom';
import { pathv_to_linear_and_cubic_beziers } from '../helper/geom.ts';
import { _, N_ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { GeomNodeType, get_nodetype, SPShape } from '../object/sp-shape.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { Preferences } from '../preferences.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { type KnotHolder, type KnotState, LPEKnotHolderEntity } from '../ui/knot/knot-holder-entity.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import { LPETypeConverter } from './effect-enum.ts';
import { lpe_shape_convert_stroke_and_fill, lpe_shape_revert_stroke_and_fill } from './fill-conversion.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { EnumParam } from './parameter/enum.ts';
import { EnumArrayParam } from './parameter/enumarray.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { ScalarArrayParam } from './parameter/scalararray.ts';

const withinRange = (value: number, low: number, high: number): boolean => value > low && value < high;

/** Inkscape::LineJoinType values (helper/geom-pathstroke.h). */
const JOIN_BEVEL = 0;
const JOIN_ROUND = 1;
const JOIN_MITER = 2;
const JOIN_EXTRAPOLATE = 4;

const JoinTypeConverter = new EnumDataConverter<number>([
  { id: JOIN_BEVEL, label: N_('Beveled'), key: 'bevel' },
  { id: JOIN_ROUND, label: N_('Rounded'), key: 'round' },
  { id: JOIN_MITER, label: N_('Miter'), key: 'miter' },
  { id: JOIN_EXTRAPOLATE, label: N_('Extrapolated'), key: 'extrapolated' },
]);

enum TaperShape {
  TAPER_CENTER,
  TAPER_RIGHT,
  TAPER_LEFT,
  TAPER_CLAMP,
  LAST_SHAPE,
}

const TaperShapeTypeConverter = new EnumDataConverter<number>([
  { id: TaperShape.TAPER_CENTER, label: N_('Center'), key: 'center' },
  { id: TaperShape.TAPER_LEFT, label: N_('Left'), key: 'left' },
  { id: TaperShape.TAPER_RIGHT, label: N_('Right'), key: 'right' },
  { id: TaperShape.TAPER_CLAMP, label: N_('Clamp'), key: 'clamp' },
]);

/** The path up to its first node that is not smooth. */
function return_at_first_cusp(path_in: Path): Path {
  const temp = new Path(path_in.initialPoint());
  const curves = path_in.curves();
  for (let i = 0; i < curves.length; i++) {
    temp.appendCurve(curves[i] as LineSegment);
    const next = curves[i + 1];
    if (next && get_nodetype(curves[i] as LineSegment, next) !== GeomNodeType.NODE_SMOOTH) break;
  }
  return temp;
}

/** Number formatting of the C++ stringstream with the classic locale. */
const num = (v: number): string => String(v);

/**
 * Taper stroke (upstream LPETaperStroke): turns the path into a filled outline of a stroke whose
 * ends narrow to a tip. The taper shapes are stretched along the path in WASM (2geom).
 */
export class LPETaperStroke extends Effect {
  readonly subpath: ScalarParam;
  readonly line_width: ScalarParam;
  readonly attach_start: ScalarArrayParam;
  readonly attach_end: ScalarArrayParam;
  readonly start_smoothing: ScalarArrayParam;
  readonly end_smoothing: ScalarArrayParam;
  readonly join_type: EnumParam<number>;
  readonly start_shape: EnumArrayParam;
  readonly end_shape: EnumArrayParam;
  readonly miter_limit: ScalarParam;
  previous_size = 1;
  start_attach_point: Point[] = [];
  end_attach_point: Point[] = [];
  prev_subpath = Number.NaN;
  pathv_out: PathVector = [];

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.subpath = new ScalarParam(
      _('Select subpath:'),
      _('Select the subpath you want to modify'),
      'subpath',
      this,
      1,
    );
    this.line_width = new ScalarParam(
      _('Stroke width:'),
      _('The (non-tapered) width of the path'),
      'stroke_width',
      this,
      1,
    );
    this.attach_start = new ScalarArrayParam(
      _('Start offset:'),
      _('Taper distance from path start'),
      'attach_start',
      this,
      0.2,
    );
    this.attach_end = new ScalarArrayParam(
      _('End offset:'),
      _('The ending position of the taper'),
      'end_offset',
      this,
      0.2,
    );
    this.start_smoothing = new ScalarArrayParam(
      _('Start smoothing:'),
      _('Amount of smoothing to apply to the start taper'),
      'start_smoothing',
      this,
      0.5,
    );
    this.end_smoothing = new ScalarArrayParam(
      _('End smoothing:'),
      _('Amount of smoothing to apply to the end taper'),
      'end_smoothing',
      this,
      0.5,
    );
    this.join_type = new EnumParam(
      _('Join type:'),
      _('Join type for non-smooth nodes'),
      'jointype',
      JoinTypeConverter,
      this,
      JOIN_EXTRAPOLATE,
    );
    this.start_shape = new EnumArrayParam(
      _('Start direction:'),
      _('Direction of the taper at the path start'),
      'start_shape',
      TaperShapeTypeConverter,
      this,
      TaperShape.TAPER_CENTER,
    );
    this.end_shape = new EnumArrayParam(
      _('End direction:'),
      _('Direction of the taper at the path end'),
      'end_shape',
      TaperShapeTypeConverter,
      this,
      TaperShape.TAPER_CENTER,
    );
    this.miter_limit = new ScalarParam(
      _('Miter limit:'),
      _('Limit for miter joins'),
      'miter_limit',
      this,
      100,
    );
    this.show_orig_path = true;
    this._provides_knotholder_entities = true;
    const repr = this.getRepr();
    for (const key of ['start_shape', 'end_shape']) {
      const v = repr?.attribute(key);
      if (!v) {
        repr?.setAttribute(key, 'center');
        if (v !== null && v !== undefined) {
          console.warn(
            `Your taper stroke is not set correctly in LPE id: ${repr?.attribute('id')}, defaulting to center mode`,
          );
        }
      }
    }
    this.attach_start.param_set_digits(3);
    this.attach_end.param_set_digits(3);
    this.subpath.param_set_range(1, 1);
    this.subpath.param_set_increments(1, 1);
    this.subpath.param_set_digits(0);
    this.registerParameter(this.line_width);
    this.registerParameter(this.subpath);
    this.registerParameter(this.attach_start);
    this.registerParameter(this.attach_end);
    this.registerParameter(this.start_smoothing);
    this.registerParameter(this.end_smoothing);
    this.registerParameter(this.join_type);
    this.registerParameter(this.start_shape);
    this.registerParameter(this.end_shape);
    this.registerParameter(this.miter_limit);
  }

  protected override transform_multiply(postmul: Affine, _set: boolean): void {
    const transform_stroke = Preferences.get().getBool('/options/transform/stroke', true);
    if (transform_stroke && !this.sp_lpe_item?.unoptimized())
      this.line_width.param_transform_multiply(postmul, false);
  }

  protected override doOnApply(lpeitem: SPLPEItem): void {
    if (!(lpeitem instanceof SPShape)) {
      console.warn('It only makes sense to apply Taper stroke to paths (not groups).');
      return;
    }
    const width = lpeitem.style ? lpeitem.style.stroke_width.computed : 1;
    lpe_shape_convert_stroke_and_fill(lpeitem);
    const pref_path = `/live_effects/${LPETypeConverter.get_key(this.effectType())}/stroke_width`;
    if (!Preferences.get().isSet(pref_path)) this.line_width.param_set_value(width);
    this.line_width.write_to_SVG();
  }

  protected override doOnRemove(lpeitem: SPLPEItem | null): void {
    if (lpeitem instanceof SPShape) lpe_shape_revert_stroke_and_fill(lpeitem, this.line_width.get_value());
  }

  protected override doEffect_path(_path_in: PathVector): PathVector {
    return this.pathv_out;
  }

  /**
   * @return Always returns a PathVector with three elements.
   *
   *  The positions of the effect knots are accessed to determine
   *  where exactly the input path should be split.
   */
  doEffect_simplePath(path: Path, _index: number, start: number, end: number): PathVector {
    const endTime = Math.max(path.size() - end, start);
    return [path.portion(0, start), path.portion(start, endTime), path.portion(endTime, path.size())];
  }

  protected override doBeforeEffect(_lpeitem: SPLPEItem): void {
    const pathv = pathv_to_linear_and_cubic_beziers(this.pathvector_before_effect);
    const sicepv = pathv.length;
    let write = false;
    const vectors = [this.attach_start, this.attach_end, this.start_smoothing, this.end_smoothing];
    if (this.previous_size !== sicepv) {
      this.subpath.param_set_range(1, sicepv);
      this.subpath.param_readSVGValue('1');
      if (!this.is_load) {
        for (const v of vectors) v._vector = [];
        this.start_shape._vector = [];
        this.end_shape._vector = [];
      }
      this.previous_size = sicepv;
    }
    if (!this.attach_start._vector.length) {
      for (const _p of this.pathvector_before_effect) {
        for (const v of vectors) v._vector.push(0);
        this.start_shape._vector.push('center');
        this.end_shape._vector.push('center');
      }
      for (const v of vectors) v.param_set_default();
      this.start_shape.param_set_default();
      this.end_shape.param_set_default();
      write = true;
    }
    while (this.start_smoothing._vector.length < sicepv) {
      this.start_smoothing._vector.push(0.5);
      write = true;
    }
    while (this.end_smoothing._vector.length < sicepv) {
      this.end_smoothing._vector.push(0.5);
      write = true;
    }
    const subpath = this.subpath.get_value();
    if (this.prev_subpath !== subpath) {
      for (const p of [...vectors, this.start_shape, this.end_shape]) p.param_setActive(subpath - 1);
      this.prev_subpath = subpath;
      this.refresh_widgets = true;
      write = true;
    }
    const attach_startv = [...this.attach_start.data()];
    const attach_endv = [...this.attach_end.data()];
    const start_smoothingv = [...this.start_smoothing.data()];
    const end_smoothingv = [...this.end_smoothing.data()];
    if (write) {
      this.start_smoothing.param_set_and_write_new_value(start_smoothingv);
      this.end_smoothing.param_set_and_write_new_value(end_smoothingv);
      this.attach_start.param_set_and_write_new_value(attach_startv);
      this.attach_end.param_set_and_write_new_value(attach_endv);
      this.start_shape.param_set_and_write_new_value(this.start_shape._vector);
      this.end_shape.param_set_and_write_new_value(this.end_shape._vector);
    }
    this.pathv_out = [];
    if (
      this.pathvector_before_effect.length === 0 ||
      PathVectorCurveCount(this.pathvector_before_effect) === 0
    ) {
      return;
    }
    const backend = pathBoolopBackend();
    const line_width = this.line_width.get_value();
    const miter_limit = this.miter_limit.get_value();
    const join = this.join_type.get_value();
    let index = 0;
    this.start_attach_point = [];
    this.end_attach_point = [];
    for (const path of pathv) {
      const first_cusp = return_at_first_cusp(path);
      const last_cusp = return_at_first_cusp(path.reversed());
      let zeroStart = false; // [distance from start taper knot -> start of path] == 0
      let zeroEnd = false; // [distance from end taper knot -> end of path] == 0
      let metInMiddle = false; // knots are touching
      // there is a pretty good chance that people will try to drag the knots
      // on top of each other, so block it
      const size = path.size();
      if (size === first_cusp.size()) {
        // check to see if the knots were dragged over each other
        // if so, reset the end offset, but still allow the start offset.
        if ((attach_startv[index] ?? 0) >= size - (attach_endv[index] ?? 0)) {
          attach_endv[index] = size - (attach_startv[index] ?? 0);
          metInMiddle = true;
        }
      }
      if (attach_startv[index] === size - (attach_endv[index] ?? 0)) metInMiddle = true;
      if (attach_endv[index] === size - (attach_startv[index] ?? 0)) metInMiddle = true;
      // don't ever let it be zero
      {
        const s = attach_startv[index] ?? 0;
        if (s >= 0 && Math.trunc(s) === s) attach_startv[index] = s - 0.00001;
        const e = attach_endv[index] ?? 0;
        if (e >= 0 && Math.trunc(e) === e) attach_endv[index] = e - 0.00001;
      }
      // don't let it be integer (TODO this is stupid!)
      const allowed_start = first_cusp.size();
      const allowed_end = last_cusp.size();
      if (Math.trunc(attach_startv[index] ?? 0) >= allowed_start)
        attach_startv[index] = allowed_start - 0.00001;
      if (Math.trunc(attach_endv[index] ?? 0) >= allowed_end) attach_endv[index] = allowed_end - 0.00001;
      // Path::operator () means get point at time t
      const sv = attach_startv[index] ?? 0;
      if (sv < 0.0000001 || withinRange(sv, 0.00000001, 0.000001)) {
        attach_startv[index] = 0.0000001;
        zeroStart = true;
      }
      const ev = attach_endv[index] ?? 0;
      if (ev < 0.0000001 || withinRange(ev, 0.00000001, 0.000001)) {
        attach_endv[index] = 0.0000001;
        zeroEnd = true;
      }
      const start_t = attach_startv[index] as number;
      const end_t = attach_endv[index] as number;
      this.start_attach_point.push(first_cusp.pointAt(start_t));
      this.end_attach_point.push(last_cusp.pointAt(end_t));
      const pathv_tmp = this.doEffect_simplePath(path, index, start_t, end_t);
      const real_path = new Path();
      const appendAt = (throwaway_path: Path, allowLine: boolean) => {
        if (
          real_path.size() >= 1 &&
          allowLine &&
          !are_near(real_path.finalPoint(), throwaway_path.initialPoint())
        ) {
          real_path.appendCurve(new LineSegment(real_path.finalPoint(), throwaway_path.initialPoint()));
        } else if (!real_path.empty()) {
          real_path.setFinal(throwaway_path.initialPoint());
        }
        real_path.append(throwaway_path);
      };
      if (!zeroStart && this.start_shape.valid_index(index) && start_smoothingv.length > index) {
        const sm = start_smoothingv[index] as number;
        let pat_str = '';
        let clamp = false;
        switch (TaperShapeTypeConverter.get_id_from_key(this.start_shape._vector[index] as string)) {
          case TaperShape.TAPER_CLAMP:
            clamp = true;
            break;
          case TaperShape.TAPER_RIGHT:
            pat_str = `M 1,0 Q ${num(1 - sm)},0 0,1 L 1,1`;
            break;
          case TaperShape.TAPER_LEFT:
            pat_str = `M 1,0 L 0,0 Q ${num(1 - sm)},1 1,1`;
            break;
          default:
            pat_str = `M 1,0 C ${num(1 - sm)},0 0,0.5 0,0.5 0,0.5 ${num(1 - sm)},1 1,1`;
            break;
        }
        if (!clamp) {
          const d = backend.taperStretchAlong(
            write_svg_path([pathv_tmp[0] as Path]),
            write_svg_path(sp_svg_read_pathv(pat_str)),
            Math.abs(line_width),
          );
          const throwaway_path = sp_svg_read_pathv(d)[0];
          if (throwaway_path) real_path.append(throwaway_path);
        }
      }
      if (!metInMiddle) {
        // append the outside outline of the path (goes with the direction of the path)
        const throwaway_path = this.#halfOutline(
          pathv_tmp[1] as Path,
          Math.abs(line_width) / 2,
          miter_limit,
          join,
        );
        if (throwaway_path) {
          if (!zeroStart && real_path.size() >= 1 && throwaway_path.size() >= 1) {
            if (!are_near(real_path.finalPoint(), throwaway_path.initialPoint())) {
              real_path.appendCurve(new LineSegment(real_path.finalPoint(), throwaway_path.initialPoint()));
            } else {
              real_path.setFinal(throwaway_path.initialPoint());
            }
          }
          if (real_path.empty()) real_path.start(throwaway_path.initialPoint());
          real_path.append(throwaway_path);
        }
      }
      if (!zeroEnd && this.end_shape.valid_index(index) && end_smoothingv.length > index) {
        const sm = end_smoothingv[index] as number;
        let pat_str_1 = '';
        let clamp = false;
        switch (TaperShapeTypeConverter.get_id_from_key(this.end_shape._vector[index] as string)) {
          case TaperShape.TAPER_CLAMP:
            clamp = true;
            break;
          case TaperShape.TAPER_RIGHT:
            pat_str_1 = `M 0,1 L 1,1 Q ${num(sm)},0 0,0`;
            break;
          case TaperShape.TAPER_LEFT:
            pat_str_1 = `M 0,1 Q ${num(sm)},1 1,0 L 0,0`;
            break;
          default:
            pat_str_1 = `M 0,1 C ${num(sm)},1 1,0.5 1,0.5 1,0.5 ${num(sm)},0 0,0`;
            break;
        }
        if (!clamp) {
          const d = backend.taperStretchAlong(
            write_svg_path([pathv_tmp[2] as Path]),
            write_svg_path(sp_svg_read_pathv(pat_str_1)),
            Math.abs(line_width),
          );
          const throwaway_path = sp_svg_read_pathv(d)[0];
          if (throwaway_path) appendAt(throwaway_path, true);
        }
      }
      if (!metInMiddle) {
        // append the inside outline of the path (against direction)
        const throwaway_path = this.#halfOutline(
          (pathv_tmp[1] as Path).reversed(),
          Math.abs(line_width) / 2,
          miter_limit,
          join,
        );
        if (throwaway_path) appendAt(throwaway_path, true);
      }
      if (!real_path.empty()) {
        if (!are_near(real_path.finalPoint(), real_path.initialPoint())) {
          real_path.appendCurve(new LineSegment(real_path.finalPoint(), real_path.initialPoint()));
        } else {
          real_path.setFinal(real_path.initialPoint());
        }
      }
      real_path.close();
      this.pathv_out.push(real_path);
      index++;
    }
  }

  #halfOutline(path: Path, width: number, miter: number, join: number): Path | null {
    const d = pathBoolopBackend().halfOutline(write_svg_path([path]), width, miter, join);
    return d ? (sp_svg_read_pathv(d)[0] ?? null) : null;
  }

  protected override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    for (let i = 0; i < this.attach_start._vector.length; i++) {
      const e = new KnotHolderEntityAttachBegin(this, i);
      e.create(
        null,
        item,
        knotholder,
        'CANVAS_ITEM_CTRL_TYPE_LPE',
        'LPE:TaperStrokeBegin',
        _(
          '<b>Start point of the taper</b>: drag to alter the taper, <b>Shift+click</b> changes the taper direction',
        ),
      );
      knotholder.add(e);
      const f = new KnotHolderEntityAttachEnd(this, i);
      f.create(
        null,
        item,
        knotholder,
        'CANVAS_ITEM_CTRL_TYPE_LPE',
        'LPE:TaperStrokeEnd',
        _(
          '<b>End point of the taper</b>: drag to alter the taper, <b>Shift+click</b> changes the taper direction',
        ),
      );
      knotholder.add(f);
    }
  }
}

function PathVectorCurveCount(pv: PathVector): number {
  return pv.reduce((n, p) => n + p.size(), 0);
}

/** Time of the point of path nearest to p (upstream nearest_time(p, path.toPwSb())). */
function pathNearestTime(path: Path, p: Point): number {
  const t = pathv_nearest_time([path], p);
  return t ? t.curve_index + t.t : 0;
}

abstract class KnotHolderEntityAttach extends LPEKnotHolderEntity<LPETaperStroke> {
  protected readonly _index: number;
  constructor(effect: LPETaperStroke, index: number) {
    super(effect);
    this._index = index;
  }
}

class KnotHolderEntityAttachBegin extends KnotHolderEntityAttach {
  valid_index(index: number): boolean {
    return this._effect.attach_start._vector.length > index;
  }
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    if (!this.valid_index(this._index) || this._effect.start_attach_point.length <= this._index) return;
    const s = this.snap_knot_position(p, state);
    if (!(this._effect.sp_lpe_item instanceof SPShape)) {
      console.warn('LPEItem is not a path!');
      return;
    }
    if (!this._effect.sp_lpe_item.curve()) return;
    const pathv = this._effect.pathvector_before_effect;
    const p_in = return_at_first_cusp(pathv[this._index] as Path);
    this._effect.attach_start._vector[this._index] = pathNearestTime(p_in, s);
    this._effect.attach_start.write_to_SVG();
  }
  override knot_click(state: KnotState): void {
    if (!state.shiftKey) return;
    if (!this.valid_index(this._index) || this._effect.start_attach_point.length <= this._index) return;
    const v = this._effect.start_shape._vector;
    v[this._index] = TaperShapeTypeConverter.get_key(
      (TaperShapeTypeConverter.get_id_from_key(v[this._index] as string) + 1) % TaperShape.LAST_SHAPE,
    );
    this._effect.start_shape.write_to_SVG();
  }
  knot_get(): Point {
    if (!this.valid_index(this._index)) return new Point(0, 0);
    return this._effect.start_attach_point[this._index] ?? new Point(0, 0);
  }
}

class KnotHolderEntityAttachEnd extends KnotHolderEntityAttach {
  valid_index(index: number): boolean {
    return this._effect.attach_end._vector.length > index;
  }
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    if (!this.valid_index(this._index) || this._effect.end_attach_point.length <= this._index) return;
    const s = this.snap_knot_position(p, state);
    if (!(this._effect.sp_lpe_item instanceof SPShape)) {
      console.warn('LPEItem is not a path!');
      return;
    }
    if (!this._effect.sp_lpe_item.curve()) return;
    const pathv = this._effect.pathvector_before_effect;
    const p_in = return_at_first_cusp((pathv[this._index] as Path).reversed());
    this._effect.attach_end._vector[this._index] = pathNearestTime(p_in, s);
    this._effect.attach_end.write_to_SVG();
  }
  override knot_click(state: KnotState): void {
    if (!state.shiftKey) return;
    if (!this.valid_index(this._index) || this._effect.end_attach_point.length <= this._index) return;
    const v = this._effect.end_shape._vector;
    v[this._index] = TaperShapeTypeConverter.get_key(
      (TaperShapeTypeConverter.get_id_from_key(v[this._index] as string) + 1) % TaperShape.LAST_SHAPE,
    );
    this._effect.end_shape.write_to_SVG();
  }
  knot_get(): Point {
    if (!this.valid_index(this._index)) return new Point(0, 0);
    return this._effect.end_attach_point[this._index] ?? new Point(0, 0);
  }
}
