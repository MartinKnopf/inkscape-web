// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-roughen.cpp, src/live_effects/lpe-roughen.h
/**
 * @file
 * Roughen LPE implementation. Creates roughen paths.
 */
/* Authors:
 *   Jabier Arraiza Cenoz <jabier.arraiza@marker.es>
 *
 * Thanks to all people involved specially to Josh Andler for the idea and to the
 * original extensions authors.
 *
 * Copyright (C) 2014 Authors
 */
import {
  are_near,
  BezierCurve,
  CubicBezier,
  type Curve,
  distance,
  LineSegment,
  nearest_time,
  Path,
  type PathVector,
  Point,
} from '@inkscape-web/geom';
import { pathv_to_linear_and_cubic_beziers } from '../helper/geom.ts';
import { _, N_ } from '../i18n.ts';
import { BBoxType } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import {
  backspace,
  closepath_current,
  get_first_segment,
  get_last_segment,
  move_endpoints,
  pathvector_append,
  pathvector_append_continuous,
} from '../path/path-curve.ts';
import { Preferences } from '../preferences.ts';
import { svgNumber } from '../svg/stringstream.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import { LPETypeConverter } from './effect-enum.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { RandomParam } from './parameter/random.ts';

export enum DivisionMethod {
  DM_SEGMENTS,
  DM_SIZE,
  DM_END,
}

export enum HandlesMethod {
  HM_ALONG_NODES,
  HM_RAND,
  HM_RETRACT,
  HM_SMOOTH,
  HM_END,
}

const DMConverter = new EnumDataConverter<DivisionMethod>(
  [
    { id: DivisionMethod.DM_SEGMENTS, label: N_('Number of segments'), key: 'segments' },
    { id: DivisionMethod.DM_SIZE, label: N_('Segment size'), key: 'size' },
  ],
  DivisionMethod.DM_END,
);

const HMConverter = new EnumDataConverter<HandlesMethod>(
  [
    { id: HandlesMethod.HM_ALONG_NODES, label: N_('Along nodes'), key: 'along' },
    { id: HandlesMethod.HM_RAND, label: N_('Random'), key: 'rand' },
    { id: HandlesMethod.HM_RETRACT, label: N_('Retract'), key: 'retract' },
    { id: HandlesMethod.HM_SMOOTH, label: N_('Smooth'), key: 'smooth' },
  ],
  HandlesMethod.HM_END,
);

/** The angle of the ray from a to b (upstream Geom::Ray(a, b).angle()). */
const rayAngle = (a: Point, b: Point): number => Math.atan2(b.y - a.y, b.x - a.x);
/** The control points of a cubic, or null for another curve. */
const cubicPoints = (c: Curve | null): readonly Point[] | null =>
  c instanceof CubicBezier ? c.controlPoints() : null;
const cubic = (p1: Point, p2: Point, p3: Point, from: Point) => new CubicBezier(from, p1, p2, p3);

/** A small LCG for the C rand() of documents older than version 1.1 (upstream calls srand(1)). */
class LegacyRand {
  #state = 1;
  srand(seed: number): void {
    this.#state = seed;
  }
  rand(): number {
    this.#state = (this.#state * 1103515245 + 12345) % 2147483648;
    return Math.floor(this.#state / 65536) % 32768;
  }
}

/** Roughen (upstream LPERoughen): adds nodes to the path and moves them randomly. */
export class LPERoughen extends Effect {
  readonly method: EnumParam<DivisionMethod>;
  readonly max_segment_size: ScalarParam;
  readonly segments: ScalarParam;
  readonly displace_x: RandomParam;
  readonly displace_y: RandomParam;
  readonly global_randomize: RandomParam;
  readonly handles: EnumParam<HandlesMethod>;
  readonly shift_nodes: BoolParam;
  readonly fixed_displacement: BoolParam;
  readonly spray_tool_friendly: BoolParam;
  seed = 0;
  readonly #legacy = new LegacyRand();

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.method = new EnumParam(
      _('Method'),
      _(
        '<b>Segment size:</b> add nodes to path evenly; <b>Number of segments:</b> add nodes between existing nodes',
      ),
      'method',
      DMConverter,
      this,
      DivisionMethod.DM_SIZE,
    );
    this.max_segment_size = new ScalarParam(
      _('Segment size'),
      _(
        'Add nodes to path evenly. Choose <b>Segment size</b> method from the dropdown to use this subdivision method.',
      ),
      'max_segment_size',
      this,
      10,
    );
    this.segments = new ScalarParam(
      _('Number of segments'),
      _(
        'Add nodes between existing nodes. Choose <b>Number of segments</b> method from the dropdown to use this subdivision method.',
      ),
      'segments',
      this,
      2,
    );
    this.displace_x = new RandomParam(
      _('Displace ←→'),
      _('Maximal displacement in x direction'),
      'displace_x',
      this,
      10,
    );
    this.displace_y = new RandomParam(
      _('Displace ↑↓'),
      _('Maximal displacement in y direction'),
      'displace_y',
      this,
      10,
    );
    this.global_randomize = new RandomParam(
      _('Global randomize'),
      _('Global displacement in all directions'),
      'global_randomize',
      this,
      1,
    );
    this.handles = new EnumParam(
      _('Direction'),
      _('Options for handle direction'),
      'handles',
      HMConverter,
      this,
      HandlesMethod.HM_ALONG_NODES,
    );
    this.shift_nodes = new BoolParam(
      _('Apply displacement'),
      _(
        'Uncheck to use this LPE for just adding nodes, without roughening; useful for further interactive processing.',
      ),
      'shift_nodes',
      this,
      true,
    );
    this.fixed_displacement = new BoolParam(
      _('Fixed displacement'),
      _('Fixed displacement, 1/3 of segment length'),
      'fixed_displacement',
      this,
      false,
    );
    this.spray_tool_friendly = new BoolParam(
      _('Spray Tool friendly'),
      _('For use with Spray Tool in copy mode'),
      'spray_tool_friendly',
      this,
      false,
    );
    this.registerParameter(this.global_randomize);
    this.registerParameter(this.displace_x);
    this.registerParameter(this.displace_y);
    this.registerParameter(this.method);
    this.registerParameter(this.max_segment_size);
    this.registerParameter(this.segments);
    this.registerParameter(this.handles);
    this.registerParameter(this.shift_nodes);
    this.registerParameter(this.fixed_displacement);
    this.registerParameter(this.spray_tool_friendly);
    this.displace_x.param_set_range(0, Number.MAX_VALUE);
    this.displace_y.param_set_range(0, Number.MAX_VALUE);
    this.global_randomize.param_set_range(0, Number.MAX_VALUE);
    this.max_segment_size.param_set_range(0, Number.MAX_VALUE);
    this.max_segment_size.param_set_increments(1, 1);
    this.max_segment_size.param_set_digits(3);
    this.segments.param_make_integer();
    this.segments.param_set_range(1, 9999);
    this.segments.param_set_increments(1, 1);
    this.apply_to_clippath_and_mask = true;
  }

  protected override doOnApply(lpeitem: SPLPEItem): void {
    const bbox = lpeitem.bounds(BBoxType.GEOMETRIC_BBOX);
    if (bbox) {
      const prefs = Preferences.get();
      for (const param of this.param_vector) {
        const pref_path = `/live_effects/${LPETypeConverter.get_key(this.effectType())}/${param.param_key}`;
        if (prefs.isSet(pref_path)) continue;
        if (param.param_key === 'max_segment_size') {
          const minor = Math.min(bbox.width(), bbox.height());
          param.param_readSVGValue(svgNumber(minor / 50.0));
        } else if (param.param_key === 'displace_x') {
          param.param_readSVGValue(svgNumber(bbox.width() / 150.0));
        } else if (param.param_key === 'displace_y') {
          param.param_readSVGValue(svgNumber(bbox.height() / 150.0));
        }
      }
      this.writeParamsToSVG();
    }
    this.lpeversion.param_setValue('1.2', true);
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    const id = lpeitem.getId();
    if (this.spray_tool_friendly.get_value() && this.seed === 0 && id) {
      // upstream: boost::hash_value of the id
      let seed = 0;
      for (const ch of id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
      this.global_randomize.param_set_value(this.global_randomize.get_value(), seed);
    }
    this.displace_x.resetRandomizer();
    this.displace_y.resetRandomizer();
    this.global_randomize.resetRandomizer();
    if (this.lpeversion.param_getSVGValue() < '1.1') {
      this.#legacy.srand(1);
    } else {
      this.displace_x.param_set_randomsign(true);
      this.displace_y.param_set_randomsign(true);
    }
  }

  sign(random_number: number): number {
    if (this.lpeversion.param_getSVGValue() < '1.1') {
      if (this.#legacy.rand() % 100 < 49) random_number *= -1;
    }
    return random_number;
  }

  randomize(max_length: number, is_node = false): Point {
    let factor = 1.0 / 3.0;
    if (is_node) factor = 1.0;
    const displace_x_parsed = this.displace_x.next() * this.global_randomize.next() * factor;
    const displace_y_parsed = this.displace_y.next() * this.global_randomize.next() * factor;
    let output = new Point(this.sign(displace_x_parsed), this.sign(displace_y_parsed));
    if (this.fixed_displacement.get_value()) {
      output = Point.polar(rayAngle(new Point(0, 0), output), max_length);
    }
    return output;
  }

  override doEffect(input: PathVector): PathVector {
    const original_pathv = pathv_to_linear_and_cubic_beziers(input);
    const curve: PathVector = [];
    const handles = this.handles.get_value();
    for (const path_it of original_pathv) {
      if (path_it.empty()) continue;
      let curves = path_it.curves();
      let nCurve: PathVector = [];
      const prev = { p: new Point(0, 0) };
      const last_move = { p: new Point(0, 0) };
      nCurve.push(new Path(curves[0]?.initialPoint()));
      if (path_it.closed()) {
        const closingline = path_it.closingSegment();
        if (are_near(closingline.initialPoint(), closingline.finalPoint())) curves = path_it.openCurves();
      }
      for (const curve_it1 of curves) {
        const back = nCurve[nCurve.length - 1] as Path;
        const cp = cubicPoints(curve_it1);
        if (cp) {
          back.appendCurve(
            cubic(
              (cp[1] as Point).add(last_move.p),
              cp[2] as Point,
              curve_it1.finalPoint(),
              back.finalPoint(),
            ),
          );
        } else {
          back.appendCurve(new LineSegment(back.finalPoint(), curve_it1.finalPoint()));
        }
        last_move.p = new Point(0, 0);
        const length = curve_it1 instanceof BezierCurve ? curve_it1.length(0.01) : 0;
        let splits: number;
        if (this.method.get_value() === DivisionMethod.DM_SEGMENTS) splits = this.segments.get_value();
        else splits = Math.ceil(length / this.max_segment_size.get_value());
        // A segment size of 0 (e.g. the default for a horizontal line) would give endless splits;
        // upstream converts the infinity to size_t. Here the segment is left as it is.
        if (!Number.isFinite(splits)) splits = 1;
        const original = get_last_segment(nCurve) as Curve;
        for (let t = 1; t <= splits; t++) {
          if (t === splits && splits !== 1) continue;
          let tmp: PathVector;
          const lastSeg = get_last_segment(nCurve) as BezierCurve;
          if (splits === 1) {
            tmp = [this.jitter(lastSeg, prev, last_move)];
          } else {
            const last = t === splits - 1;
            const time = nearest_time(original.pointAt((1 / splits) * t), lastSeg);
            tmp = [this.addNodesAndJitter(lastSeg, prev, last_move, time, last)];
          }
          if (nCurve.reduce((n, p) => n + p.size(), 0) > 1) {
            backspace(nCurve);
            pathvector_append_continuous(nCurve, tmp, 0.001);
          } else {
            nCurve = tmp;
          }
        }
      }
      if (path_it.closed()) {
        if (handles === HandlesMethod.HM_SMOOTH) {
          nCurve = reversed(nCurve);
          const cubic_start = cubicPoints(get_first_segment(nCurve));
          const cubic_last = cubicPoints(get_last_segment(nCurve));
          let oposite = (get_first_segment(nCurve) as Curve).pointAt(1.0 / 3.0);
          if (cubic_start) {
            const s0 = cubic_start[0] as Point;
            const s1 = cubic_start[1] as Point;
            oposite = Point.polar(rayAngle(s1, s0), distance(s1, s0)).add(s0);
          }
          const out = new Path();
          if (cubic_last) {
            out.start(cubic_last[0] as Point);
            out.appendCurve(
              cubic(cubic_last[1] as Point, oposite, cubic_last[3] as Point, cubic_last[0] as Point),
            );
          } else {
            const lastSeg = get_last_segment(nCurve) as Curve;
            const lastPath = nCurve[nCurve.length - 1] as Path;
            out.start(lastSeg.initialPoint());
            out.appendCurve(
              cubic(lastSeg.initialPoint(), oposite, lastPath.finalPoint(), lastSeg.initialPoint()),
            );
          }
          backspace(nCurve);
          pathvector_append_continuous(nCurve, [out], 0.001);
          nCurve = reversed(nCurve);
        }
        if (handles === HandlesMethod.HM_ALONG_NODES) {
          nCurve = reversed(nCurve);
          const c = cubicPoints(get_last_segment(nCurve));
          if (c) {
            const out = new Path(c[0] as Point);
            const first = (get_first_segment(nCurve) as Curve).initialPoint();
            out.appendCurve(
              cubic(
                c[1] as Point,
                (c[2] as Point).sub((c[3] as Point).sub(first)),
                c[3] as Point,
                c[0] as Point,
              ),
            );
            backspace(nCurve);
            pathvector_append_continuous(nCurve, [out], 0.001);
          }
          nCurve = reversed(nCurve);
        }
        const lastSeg = get_last_segment(nCurve) as Curve;
        move_endpoints(nCurve, lastSeg.finalPoint(), lastSeg.finalPoint());
        closepath_current(nCurve[nCurve.length - 1] as Path);
      }
      pathvector_append(curve, nCurve);
    }
    return curve;
  }

  addNodesAndJitter(
    A: BezierCurve,
    prev: { p: Point },
    last_move: { p: Point },
    t: number,
    last: boolean,
  ): Path {
    const out = new Path();
    const cp = cubicPoints(A);
    const max_length = distance(A.initialPoint(), A.pointAt(t)) / 3.0;
    const zero = new Point(0, 0);
    let point_a1 = zero;
    let point_a2 = zero;
    let point_a3 = zero;
    let point_b1 = zero;
    let point_b2 = zero;
    let point_b3 = zero;
    const handles = this.handles.get_value();
    const fixed_displacement = this.fixed_displacement.get_value();
    if (this.shift_nodes.get_value()) {
      point_a3 = this.randomize(max_length, true);
      if (last) point_b3 = this.randomize(max_length, true);
    }
    if (handles === HandlesMethod.HM_RAND || handles === HandlesMethod.HM_SMOOTH) {
      point_a1 = this.randomize(max_length);
      point_a2 = this.randomize(max_length);
      point_b1 = this.randomize(max_length);
      if (last) point_b2 = this.randomize(max_length);
    } else {
      point_a2 = point_a3;
      point_b1 = point_a3;
      if (last) point_b2 = point_b3;
    }
    const append = (p1: Point, p2: Point, p3: Point) => out.appendCurve(cubic(p1, p2, p3, out.finalPoint()));
    const line = (p: Point) => out.appendCurve(new LineSegment(out.finalPoint(), p));
    if (handles === HandlesMethod.HM_SMOOTH) {
      if (cp) {
        const [d1, d2] = A.subdivide(t);
        const seg1 = d1.controlPoints();
        const seg2 = d2.controlPoints();
        const s13 = (seg1[3] as Point).add(point_a3);
        let angle = rayAngle(s13, (seg2[1] as Point).add(point_a3));
        let length = max_length;
        if (!fixed_displacement) length = distance(s13, (seg2[1] as Point).add(point_a3));
        point_b1 = s13.add(Point.polar(angle, length));
        point_b2 = seg2[2] as Point;
        point_b3 = (seg2[3] as Point).add(point_b3);
        point_a3 = s13;
        angle = rayAngle(prev.p, A.initialPoint());
        point_a1 = A.initialPoint().add(Point.polar(angle, max_length));
        if (last) {
          const b2 = new Path(point_b3);
          b2.appendCurve(new LineSegment(point_b3, point_a3));
          length = max_length;
          angle = rayAngle(point_b3, point_b2);
          if (!fixed_displacement) length = distance(b2.pointAt(1.0 / 3.0), point_b3);
          point_b2 = point_b3.add(Point.polar(angle, length));
        }
        angle = rayAngle(point_b1, point_a3);
        point_a2 = point_a3.add(Point.polar(angle, max_length));
        prev.p = last ? point_b2 : point_a2;
        out.start(seg1[0] as Point);
        append(point_a1, point_a2, point_a3);
        append(point_b1, point_b2, point_b3);
      } else {
        const at = A.pointAt(t).add(point_a3);
        let angle = rayAngle(at, A.pointAt(t + t / 3));
        let length = max_length;
        if (!fixed_displacement) length = distance(at, A.pointAt(t + t / 3));
        point_b1 = at.add(Point.polar(angle, length));
        point_b2 = A.pointAt(t + (t / 3) * 2);
        point_b3 = A.finalPoint().add(point_b3);
        point_a3 = at;
        angle = rayAngle(prev.p, A.initialPoint());
        point_a1 = A.initialPoint().add(Point.polar(angle, max_length));
        if (prev.p.equals(zero)) point_a1 = this.randomize(max_length);
        if (last) {
          const b2 = new Path(point_b3);
          b2.appendCurve(new LineSegment(point_b3, point_a3));
          length = max_length;
          angle = rayAngle(point_b3, point_b2);
          if (!fixed_displacement) length = distance(b2.pointAt(1.0 / 3.0), point_b3);
          point_b2 = point_b3.add(Point.polar(angle, length));
        }
        angle = rayAngle(point_b1, point_a3);
        point_a2 = point_a3.add(Point.polar(angle, max_length));
        prev.p = last ? point_b2 : point_a2;
        out.start(A.initialPoint());
        append(point_a1, point_a2, point_a3);
        append(point_b1, point_b2, point_b3);
      }
    } else if (handles === HandlesMethod.HM_RETRACT) {
      out.start(A.initialPoint());
      line(A.pointAt(t).add(point_a3));
      if (cp && !last) {
        const seg2 = A.subdivide(t)[1].controlPoints();
        append(seg2[1] as Point, seg2[2] as Point, seg2[3] as Point);
      } else {
        line(A.finalPoint().add(point_b3));
      }
    } else if (handles === HandlesMethod.HM_ALONG_NODES) {
      if (cp) {
        const [d1, d2] = A.subdivide(t);
        const seg1 = d1.controlPoints();
        const seg2 = d2.controlPoints();
        out.start(seg1[0] as Point);
        append(
          (seg1[1] as Point).add(last_move.p),
          (seg1[2] as Point).add(point_a3),
          (seg1[3] as Point).add(point_a3),
        );
        last_move.p = point_a3;
        if (last) last_move.p = point_b3;
        append(
          (seg2[1] as Point).add(point_a3),
          (seg2[2] as Point).add(point_b3),
          (seg2[3] as Point).add(point_b3),
        );
      } else {
        out.start(A.initialPoint());
        line(A.pointAt(t).add(point_a3));
        line(A.finalPoint().add(point_b3));
      }
    } else if (handles === HandlesMethod.HM_RAND) {
      if (cp) {
        const [d1, d2] = A.subdivide(t);
        const seg1 = d1.controlPoints();
        const seg2 = d2.controlPoints();
        out.start(seg1[0] as Point);
        append(
          (seg1[1] as Point).add(point_a1),
          (seg1[2] as Point).add(point_a2).add(point_a3),
          (seg1[3] as Point).add(point_a3),
        );
        append(
          (seg2[1] as Point).add(point_a3).add(point_b1),
          (seg2[2] as Point).add(point_b2).add(point_b3),
          (seg2[3] as Point).add(point_b3),
        );
      } else {
        out.start(A.initialPoint());
        line(A.pointAt(t).add(point_a3));
        line(A.finalPoint().add(point_b3));
      }
    }
    return out;
  }

  jitter(A: BezierCurve, prev: { p: Point }, last_move: { p: Point }): Path {
    const out = new Path();
    const cp = cubicPoints(A);
    const max_length = distance(A.initialPoint(), A.finalPoint()) / 3.0;
    const zero = new Point(0, 0);
    let point_a1 = zero;
    let point_a2 = zero;
    let point_a3 = zero;
    const handles = this.handles.get_value();
    const legacy = this.lpeversion.param_getSVGValue() < '1.1';
    if (this.shift_nodes.get_value()) point_a3 = this.randomize(max_length, true);
    if (handles === HandlesMethod.HM_RAND || handles === HandlesMethod.HM_SMOOTH) {
      point_a1 = this.randomize(max_length);
      point_a2 = this.randomize(max_length);
    }
    const append = (p1: Point, p2: Point, p3: Point) => out.appendCurve(cubic(p1, p2, p3, out.finalPoint()));
    if (handles === HandlesMethod.HM_SMOOTH) {
      if (cp) {
        point_a1 = Point.polar(rayAngle(prev.p, A.initialPoint()), max_length);
        if (prev.p.equals(zero)) point_a1 = A.pointAt(1.0 / 3.0).add(this.randomize(max_length));
        const angle = rayAngle((cp[3] as Point).add(point_a3), (cp[2] as Point).add(point_a3));
        // (upstream before 1.1 passes the angle as is_node)
        point_a2 = legacy ? this.randomize(max_length, angle !== 0) : this.randomize(max_length, false);
        prev.p = (cp[2] as Point).add(point_a2);
        out.start(cp[0] as Point);
        append(
          (cp[0] as Point).add(point_a1),
          (cp[2] as Point).add(point_a2).add(point_a3),
          (cp[3] as Point).add(point_a3),
        );
      } else {
        point_a1 = Point.polar(rayAngle(prev.p, A.initialPoint()), max_length);
        if (prev.p.equals(zero)) point_a1 = A.pointAt(1.0 / 3.0).add(this.randomize(max_length));
        const angle = rayAngle(A.finalPoint().add(point_a3), A.pointAt((1.0 / 3.0) * 2).add(point_a3));
        point_a2 = legacy ? this.randomize(max_length, angle !== 0) : this.randomize(max_length, false);
        prev.p = A.pointAt((1.0 / 3.0) * 2)
          .add(point_a2)
          .add(point_a3);
        out.start(A.initialPoint());
        append(
          A.initialPoint().add(point_a1),
          A.pointAt((1.0 / 3.0) * 2)
            .add(point_a2)
            .add(point_a3),
          A.finalPoint().add(point_a3),
        );
      }
    } else if (handles === HandlesMethod.HM_RETRACT) {
      out.start(A.initialPoint());
      out.appendCurve(new LineSegment(A.initialPoint(), A.finalPoint().add(point_a3)));
    } else if (handles === HandlesMethod.HM_ALONG_NODES) {
      if (cp) {
        out.start(cp[0] as Point);
        append(
          (cp[1] as Point).add(last_move.p),
          (cp[2] as Point).add(point_a3),
          (cp[3] as Point).add(point_a3),
        );
        last_move.p = point_a3;
      } else {
        out.start(A.initialPoint());
        out.appendCurve(new LineSegment(A.initialPoint(), A.finalPoint().add(point_a3)));
      }
    } else if (handles === HandlesMethod.HM_RAND) {
      out.start(A.initialPoint());
      append(
        A.pointAt(0.3333).add(point_a1),
        A.pointAt(0.6666).add(point_a2).add(point_a3),
        A.finalPoint().add(point_a3),
      );
    }
    return out;
  }
}

/** Upstream PathVector::reverse(): every path reversed, and the order of the paths. */
function reversed(pv: PathVector): PathVector {
  return pv.map((p) => p.reversed()).reverse();
}
