// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-knot.cpp, src/live_effects/lpe-knot.h
/**
 * @file
 * LPE knot effect implementation.
 */
/* Authors:
 *   Jean-Francois Barraud <jf.barraud@gmail.com>
 *   Abhishek Sharma
 *   Johan Engelen
 *
 * Copyright (C) 2007-2012 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Affine, distance, type PathVector, Point, write_svg_path } from '@inkscape-web/geom';
import { pathv_to_linear_and_cubic_beziers } from '../helper/geom.ts';
import { _, C_ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import { SPGroup } from '../object/sp-item-group.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { SPShape } from '../object/sp-shape.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../svg/svg-path.ts';
import {
  type KnotHolder,
  type KnotState,
  knot_state_ctrl,
  LPEKnotHolderEntity,
} from '../ui/knot/knot-holder-entity.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { ScalarArrayParamBase } from './parameter/array.ts';
import { BoolParam } from './parameter/bool.ts';
import { HiddenParam } from './parameter/hidden.ts';
import { ScalarParam } from './parameter/parameter.ts';

/**
 * An intersection point of the path components (upstream LPEKnotNS::CrossingPoint): the
 * components i and j meet in pt; it is the ni-th crossing along i and the nj-th along j, at the
 * times ti and tj. sign: +/-1 = positive or negative crossing, 0 = flat.
 */
export interface CrossingPoint {
  pt: Point;
  sign: number;
  i: number;
  j: number;
  ni: number;
  nj: number;
  ti: number;
  tj: number;
}

/** The crossings from their storage as 9 numbers each (upstream CrossingPoints(std::vector<double>)). */
export function crossingPointsFromVector(input: readonly number[]): CrossingPoint[] {
  const result: CrossingPoint[] = [];
  if (input.length > 0 && input.length % 9 === 0) {
    for (let n = 0; n < input.length; n += 9) {
      const v = input.slice(n, n + 9) as number[];
      result.push({
        pt: new Point(v[0] as number, v[1] as number),
        i: v[2] as number,
        j: v[3] as number,
        ni: v[4] as number,
        nj: v[5] as number,
        ti: v[6] as number,
        tj: v[7] as number,
        sign: v[8] as number,
      });
    }
  }
  return result;
}

/** Upstream CrossingPoints::to_vector(). */
export function crossingPointsToVector(cpts: readonly CrossingPoint[]): number[] {
  return cpts.flatMap((cp) => [cp.pt.x, cp.pt.y, cp.i, cp.j, cp.ni, cp.nj, cp.ti, cp.tj, cp.sign]);
}

function idx_of_nearest(cpts: readonly CrossingPoint[], p: Point): number {
  let dist = -1;
  let result = cpts.length;
  for (let k = 0; k < cpts.length; k++) {
    const dist_k = distance(p, (cpts[k] as CrossingPoint).pt);
    if (dist < 0 || dist > dist_k) {
      result = k;
      dist = dist_k;
    }
  }
  return result;
}

//TODO: Find a way to warn the user when the topology changes.
//TODO: be smarter at guessing the signs when the topology changed?
/** Take the signs of the crossings from other (upstream CrossingPoints::inherit_signs). */
function inherit_signs(cpts: CrossingPoint[], other: readonly CrossingPoint[], default_value = 1): void {
  let topo_changed = false;
  for (let n = 0; n < cpts.length; n++) {
    const c = cpts[n] as CrossingPoint;
    const o = other[n];
    if (o && o.i === c.i && o.j === c.j && o.ni === c.ni && o.nj === c.nj) {
      c.sign = o.sign;
    } else {
      topo_changed = true;
      break;
    }
  }
  if (topo_changed) {
    for (const c of cpts) {
      const idx = idx_of_nearest(other, c.pt);
      c.sign = idx < other.length ? (other[idx] as CrossingPoint).sign : default_value;
    }
  }
}

/** recursively collect gpaths and stroke widths (stolen from "sp-lpe_item.cpp"). */
function collectPathsAndWidths(lpeitem: SPLPEItem, paths: PathVector, stroke_widths: number[]): void {
  if (lpeitem instanceof SPGroup) {
    for (const subitem of lpeitem.item_list()) {
      if ('path_effect_list' in subitem) collectPathsAndWidths(subitem as SPLPEItem, paths, stroke_widths);
    }
  } else if (lpeitem instanceof SPShape) {
    const c = lpeitem.curve();
    if (c) {
      for (const subpath of pathv_to_linear_and_cubic_beziers(c)) {
        paths.push(subpath);
        //FIXME: do we have to be more careful when trying to access stroke width?
        stroke_widths.push(lpeitem.style?.stroke_width.computed ?? 1);
      }
    }
  }
}

/** sp_svg_write_path with 4 significant digits (upstream sets /options/svgoutput/numericprecision). */
const write4 = (p: PathVector[number]) => sp_svg_write_path(p, { pathString: { precision: 4 } });

/**
 * Knot (upstream LPEKnot): gaps in the path where it passes under itself or another component.
 * The crossings and the gaps are computed in WASM.
 */
export class LPEKnot extends GroupBBoxEffect {
  readonly interruption_width: ScalarParam;
  readonly prop_to_stroke_width: BoolParam;
  readonly both: BoolParam;
  readonly inverse_width: BoolParam;
  readonly add_stroke_width: HiddenParam;
  readonly add_other_stroke_width: HiddenParam;
  readonly switcher_size: ScalarParam;
  readonly crossing_points_vector: ScalarArrayParamBase; //svg storage of crossing_points
  crossing_points: CrossingPoint[] = [];
  gpaths: PathVector = []; // the collection of all the paths in the object or group.
  gstroke_widths: number[] = []; // the collection of all the stroke widths in the object or group.
  selectedCrossing = 0;
  switcher = new Point(0, 0);

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    // initialise your parameters here:
    this.interruption_width = new ScalarParam(
      _('_Gap length:'),
      _('Size of hidden region of lower string'),
      'interruption_width',
      this,
      3,
    );
    this.prop_to_stroke_width = new BoolParam(
      _('_In units of stroke width'),
      _('Gap width is given in multiples of stroke width. When unchecked, document units are used.'),
      'prop_to_stroke_width',
      this,
      true,
    );
    this.both = new BoolParam(
      _('_Gaps in both'),
      _('At path intersections, both parts will have a gap'),
      'both',
      this,
      false,
    );
    this.inverse_width = new BoolParam(
      _('_Groups: Inverse'),
      _('Use other stroke width, useful in groups with different stroke widths'),
      'inverse_width',
      this,
      false,
    );
    this.add_stroke_width = new HiddenParam(
      'St_roke width',
      'Add the stroke width to the gap size',
      'add_stroke_width',
      this,
      'inkscape_1.0_and_up',
      true,
    );
    this.add_other_stroke_width = new HiddenParam(
      '_Crossing path stroke width',
      'Add crossed stroke width to the gap size',
      'add_other_stroke_width',
      this,
      'inkscape_1.0_and_up',
      true,
    );
    this.switcher_size = new ScalarParam(
      _('S_witcher size:'),
      _('Orientation indicator/switcher size'),
      'switcher_size',
      this,
      15,
    );
    this.crossing_points_vector = new ScalarArrayParamBase(
      _('Crossing Signs'),
      _('Crossing signs'),
      'crossing_points_vector',
      this,
    );
    // register all your parameters here, so Inkscape knows which parameters this effect has:
    this.registerParameter(this.switcher_size);
    this.registerParameter(this.interruption_width);
    this.registerParameter(this.prop_to_stroke_width);
    this.registerParameter(this.add_stroke_width);
    this.registerParameter(this.both);
    this.registerParameter(this.inverse_width);
    this.registerParameter(this.add_other_stroke_width);
    this.registerParameter(this.crossing_points_vector);
    this._provides_knotholder_entities = true;
  }

  updateSwitcher(): void {
    const cp = this.crossing_points[this.selectedCrossing];
    if (cp) {
      this.switcher = cp.pt;
    } else if (this.crossing_points.length > 0) {
      this.selectedCrossing = 0;
      this.switcher = (this.crossing_points[0] as CrossingPoint).pt;
    } else {
      this.switcher = new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    }
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const path_out: PathVector = [];
    if (this.gpaths.length === 0) return path_in;
    const gpaths_d = write_svg_path(this.gpaths);
    const gpaths4 = this.gpaths.map(write4);
    const crossings = crossingPointsToVector(this.crossing_points);
    const params = {
      interruption_width: this.interruption_width.get_value(),
      prop_to_stroke_width: this.prop_to_stroke_width.get_value(),
      both: this.both.get_value(),
      inverse_width: this.inverse_width.get_value(),
      add_stroke_width: this.add_stroke_width.param_getSVGValue() === 'true',
      add_other_stroke_width: this.add_other_stroke_width.param_getSVGValue() === 'true',
    };
    for (const comp of pathv_to_linear_and_cubic_beziers(path_in)) {
      //find the relevant path component in gpaths (required to allow groups!)
      //Q: do we always receive the group members in the same order? can we rest on that?
      const i0 = gpaths4.indexOf(write4(comp));
      if (i0 < 0) throw new Error('lpe-knot error: group member not recognized'); // this should not happen...
      const d = pathBoolopBackend().knotComponent(gpaths_d, i0, crossings, this.gstroke_widths, params);
      path_out.push(...sp_svg_read_pathv(d));
    }
    return path_out;
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem);
    this.gpaths = [];
    this.gstroke_widths = [];
    collectPathsAndWidths(lpeitem, this.gpaths, this.gstroke_widths);
    const old_crdata = crossingPointsFromVector(this.crossing_points_vector.data());
    this.crossing_points = crossingPointsFromVector(
      pathBoolopBackend().knotCrossings(write_svg_path(this.gpaths)),
    );
    inherit_signs(this.crossing_points, old_crdata);
    // Don't write to XML here, only store it in the param itself. Will be written to SVG later
    this.crossing_points_vector.param_setValue(crossingPointsToVector(this.crossing_points));
    this.updateSwitcher();
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    const r = this.switcher_size.get_value() * 0.1;
    let svgd: string;
    //TODO: use a nice path!
    const selected = this.crossing_points[this.selectedCrossing];
    if (!selected || selected.sign > 0) {
      svgd =
        'm -7.07,7.07 c 3.9,3.91 10.24,3.91 14.14,0 3.91,-3.9 3.91,-10.24 0,-14.14 -3.9,-3.91 -10.24,-3.91 -14.14,0 l 2.83,-4.24 0.7,2.12';
    } else if (selected.sign < 0) {
      svgd =
        'm 7.07,7.07 c -3.9,3.91 -10.24,3.91 -14.14,0 -3.91,-3.9 -3.91,-10.24 0,-14.14 3.9,-3.91 10.24,-3.91 14.14,0 l -2.83,-4.24 -0.7,2.12';
    } else {
      svgd =
        'M 10,0 C 10,5.52 5.52,10 0,10 -5.52,10 -10,5.52 -10,0 c 0,-5.52 4.48,-10 10,-10 5.52,0 10,4.48 10,10 z';
    }
    const m = new Affine(r, 0, 0, r, this.switcher.x, this.switcher.y);
    hp_vec.push(sp_svg_read_pathv(svgd).map((p) => p.transformed(m)));
  }

  protected override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    const e = new KnotHolderEntityCrossingSwitcher(this);
    e.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:CrossingSwitcher',
      _(
        'Drag to select a crossing, click to flip it, Shift + click to change all crossings, Ctrl + click to reset and change all crossings',
      ),
    );
    knotholder.add(e);
  }
}

class KnotHolderEntityCrossingSwitcher extends LPEKnotHolderEntity<LPEKnot> {
  knot_set(p: Point, _origin: Point, _state: KnotState): void {
    this._effect.selectedCrossing = idx_of_nearest(this._effect.crossing_points, p);
    this._effect.updateSwitcher();
    // FIXME: this should not directly ask for updating the item. It should write to SVG, which triggers updating.
    if (this.item && 'path_effect_list' in this.item) {
      sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, true);
    }
  }

  knot_get(): Point {
    return this._effect.switcher;
  }

  override knot_click(state: KnotState): void {
    const lpe = this._effect;
    const s = lpe.selectedCrossing;
    const selected = lpe.crossing_points[s];
    if (!selected) return;
    const next = (sign: number) => ((sign + 2) % 3) - 1;
    if (state.shiftKey) {
      for (const crossing_point of lpe.crossing_points) crossing_point.sign = next(crossing_point.sign);
    } else if (knot_state_ctrl(state)) {
      const sign = selected.sign;
      for (const crossing_point of lpe.crossing_points) crossing_point.sign = next(sign);
    } else {
      selected.sign = next(selected.sign);
    }
    lpe.crossing_points_vector.param_set_and_write_new_value(crossingPointsToVector(lpe.crossing_points));
    lpe.makeUndoDone(C_('Undo', 'Change knot crossing'));
  }
}
