// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-curvestitch.cpp, src/live_effects/lpe-curvestitch.h
/** \file
 * LPE <curvestitching> implementation
 */
/*
 * Authors:
 *   Johan Engelen
 *
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  Affine,
  are_near,
  L2,
  type Path,
  type PathVector,
  Point,
  PathVector as PV,
  rot90,
  Translate,
  unit_vector,
} from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { SPPath } from '../object/sp-path.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { PathParam } from './parameter/path.ts';
import { RandomParam } from './parameter/random.ts';
import { arcLengthSamples, pathFromLine, pwd2Transformed } from './pwd2.ts';

/** The random numbers of one stitch: upstream reads the RandomParams in this order. */
interface StitchRandom {
  startEdge: number | null;
  endEdge: number | null;
  svA: number;
  svB: number;
}

/**
 * Stitch sub-paths (upstream LPECurveStitch): perpendicular lines between the first two subpaths
 * of a path (all pairs of subpaths), made from a stitch path that is scaled to the distance of the
 * two points. The arc length parametrization of the subpaths runs in WASM.
 */
export class LPECurveStitch extends Effect {
  readonly strokepath: PathParam;
  readonly nrofpaths: ScalarParam;
  readonly startpoint_edge_variation: RandomParam;
  readonly startpoint_spacing_variation: RandomParam;
  readonly endpoint_edge_variation: RandomParam;
  readonly endpoint_spacing_variation: RandomParam;
  readonly prop_scale: ScalarParam;
  readonly scale_y_rel: BoolParam;
  transformed = false;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.strokepath = new PathParam(
      _('Stitch path:'),
      _('The path that will be used as stitch.'),
      'strokepath',
      this,
      'M0,0 L1,0',
    );
    this.nrofpaths = new ScalarParam(
      _('N_umber of paths:'),
      _('The number of paths that will be generated.'),
      'count',
      this,
      5,
    );
    this.startpoint_edge_variation = new RandomParam(
      _('Sta_rt edge variance:'),
      _(
        'The amount of random jitter to move the start points of the stitches inside & outside the guide path',
      ),
      'startpoint_edge_variation',
      this,
      0,
    );
    this.startpoint_spacing_variation = new RandomParam(
      _('Sta_rt spacing variance:'),
      _(
        'The amount of random shifting to move the start points of the stitches back & forth along the guide path',
      ),
      'startpoint_spacing_variation',
      this,
      0,
    );
    this.endpoint_edge_variation = new RandomParam(
      _('End ed_ge variance:'),
      _('The amount of randomness that moves the end points of the stitches inside & outside the guide path'),
      'endpoint_edge_variation',
      this,
      0,
    );
    this.endpoint_spacing_variation = new RandomParam(
      _('End spa_cing variance:'),
      _(
        'The amount of random shifting to move the end points of the stitches back & forth along the guide path',
      ),
      'endpoint_spacing_variation',
      this,
      0,
    );
    this.prop_scale = new ScalarParam(
      _('Scale _width:'),
      _('Scale the width of the stitch path'),
      'prop_scale',
      this,
      1,
    );
    this.scale_y_rel = new BoolParam(
      _('Scale _width relative to length'),
      _('Scale the width of the stitch path relative to its length'),
      'scale_y_rel',
      this,
      false,
    );
    this.registerParameter(this.nrofpaths);
    this.registerParameter(this.startpoint_edge_variation);
    this.registerParameter(this.startpoint_spacing_variation);
    this.registerParameter(this.endpoint_edge_variation);
    this.registerParameter(this.endpoint_spacing_variation);
    this.registerParameter(this.strokepath);
    this.registerParameter(this.prop_scale);
    this.registerParameter(this.scale_y_rel);

    this.nrofpaths.param_make_integer();
    this.nrofpaths.param_set_range(2, Number.POSITIVE_INFINITY);

    this.prop_scale.param_set_digits(3);
    this.prop_scale.param_set_increments(0.01, 0.1);
    this.transformed = false;
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    this.strokepath.reload();
    return false;
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    if (this.is_load) this.strokepath.reload();

    if (path_in.length < 2) return path_in;
    this.startpoint_edge_variation.resetRandomizer();
    this.endpoint_edge_variation.resetRandomizer();
    this.startpoint_spacing_variation.resetRandomizer();
    this.endpoint_spacing_variation.resetRandomizer();
    const affine = this.strokepath.get_relative_affine().withoutTranslation();

    const stroke_bounds = PV.boundsExact(this.strokepath.get_pathvector().map((p) => p.transformed(affine)));
    if (!stroke_bounds) return path_in;
    const scaling = stroke_bounds.width();
    const stroke_origin = new Point(stroke_bounds.left(), (stroke_bounds.top() + stroke_bounds.bottom()) / 2);

    const nrofpaths = Math.trunc(this.nrofpaths.get_value());
    const path_out: PathVector = [];

    // do this for all permutations (ii,jj) if there are more than 2 paths? realllly cool!
    for (let ii = 0; ii < path_in.length - 1; ii++) {
      for (let jj = ii + 1; jj < path_in.length; jj++) {
        const pathA = path_in[ii] as Path;
        const pathB = path_in[jj] as Path;
        // The domains of the arc length parametrizations (starting at 0).
        const maxA = arcLengthSamples(pathA, [])?.end;
        const maxB = arcLengthSamples(pathB, [])?.end;
        if (maxA === undefined || maxB === undefined) continue;
        const incrementA = maxA / (nrofpaths - 1);
        const incrementB = maxB / (nrofpaths - 1);
        let tA = 0;
        let tB = 0;
        let tAclean = tA; // the tA without spacing_variation
        let tBclean = tB; // the tB without spacing_variation

        // The random numbers do not depend on the geometry: get the arc lengths of all stitches first.
        const tAs: number[] = [];
        const tBs: number[] = [];
        const randoms: StitchRandom[] = [];
        for (let i = 0; i < nrofpaths; i++) {
          tAs.push(tA);
          tBs.push(tB);
          const startEdge =
            this.startpoint_edge_variation.get_value() !== 0 ? this.#variation('startEdge') : null;
          const endEdge = this.endpoint_edge_variation.get_value() !== 0 ? this.#variation('endEdge') : null;
          const svA = this.#variation('svA');
          const svB = this.#variation('svB');
          randoms.push({ startEdge, endEdge, svA, svB });
          tAclean += incrementA;
          tBclean += incrementB;
          tA = tAclean + incrementA * svA;
          tB = tBclean + incrementB * svB;
          if (tA > maxA) tA = maxA;
          if (tB > maxB) tB = maxB;
        }
        const samplesA = arcLengthSamples(pathA, tAs)?.samples ?? [];
        const samplesB = arcLengthSamples(pathB, tBs)?.samples ?? [];

        for (let i = 0; i < nrofpaths; i++) {
          let start = (samplesA[i] as { point: Point }).point;
          let end = (samplesB[i] as { point: Point }).point;
          const r = randoms[i] as StitchRandom;
          if (r.startEdge !== null) start = start.add(end.sub(start).mul(r.startEdge));
          if (r.endEdge !== null) end = end.add(end.sub(start).mul(r.endEdge));

          if (!are_near(start, end)) {
            let scaling_y: number;
            if (this.scale_y_rel.get_value() || this.transformed) {
              scaling_y = (L2(end.sub(start)) / scaling) * this.prop_scale.get_value();
              this.transformed = false;
            } else {
              scaling_y = this.prop_scale.get_value();
            }

            const transform = Affine.fromBasis(
              end.sub(start).div(scaling),
              rot90(unit_vector(end.sub(start))).mul(scaling_y),
              start,
            );
            // (strokepath.get_pwd2() - stroke_origin) * transform
            const m = Translate(stroke_origin.neg()).multiply(transform);
            const result = pwd2Transformed(this.strokepath.get_pathvector(), [
              m.c0,
              m.c1,
              m.c2,
              m.c3,
              m.c4,
              m.c5,
            ]);
            if (result[0]) path_out.push(result[0]);
          }
        }
      }
    }
    return path_out;
  }

  /** The next random number of a variation, minus half of its value (as the upstream expressions). */
  #variation(which: 'startEdge' | 'endEdge' | 'svA' | 'svB'): number {
    const param = {
      startEdge: this.startpoint_edge_variation,
      endEdge: this.endpoint_edge_variation,
      svA: this.startpoint_spacing_variation,
      svB: this.endpoint_spacing_variation,
    }[which];
    return param.next() - param.get_value() / 2;
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);

    if (!(item instanceof SPPath)) return;

    // set the stroke path to run horizontally in the middle of the bounding box of the original path

    // calculate bounding box:
    const temppath = sp_svg_read_pathv(item.getRepr().attribute('inkscape:original-d') ?? '');
    const bounds = PV.boundsExact(temppath);
    if (bounds) {
      const start = new Point(bounds.left(), (bounds.top() + bounds.bottom()) / 2);
      const end = new Point(bounds.right(), (bounds.top() + bounds.bottom()) / 2);
      if (!are_near(start, end)) {
        this.strokepath.set_new_value([pathFromLine(start, end)], true);
      } else {
        // bounding box is too small to make decent path. set to default default. :-)
        this.strokepath.param_set_and_write_default();
      }
    } else {
      // bounding box is non-existent. set to default default. :-)
      this.strokepath.param_set_and_write_default();
    }
  }
}
