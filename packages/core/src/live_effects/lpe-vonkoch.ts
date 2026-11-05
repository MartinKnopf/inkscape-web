// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-vonkoch.cpp, src/live_effects/lpe-vonkoch.h
/*
 * Copyright (C) JF Barraud 2007 <jf.barraud@gmail.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Affine, LineSegment, Path, type PathVector, Point } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { PathParam } from './parameter/path.ts';

const INT_MAX = 2147483647;

/** The generating path of Von Koch (upstream VonKochPathParam). */
export class VonKochPathParam extends PathParam {}

/**
 * The reference segment of Von Koch (upstream VonKochRefPathParam): only a path of one segment
 * is accepted.
 * FIXME: a path is used here instead of 2 points to work around path/point param incompatibility bug.
 */
export class VonKochRefPathParam extends PathParam {
  override param_readSVGValue(strvalue: string): boolean {
    const old = this._pathvector;
    const res = super.param_readSVGValue(strvalue);
    if (res && this._pathvector.length === 1 && (this._pathvector[0] as Path).size() === 1) return true;
    this._pathvector = old;
    return false;
  }
}

/**
 * Von Koch (upstream LPEVonKoch): the path is copied with the transforms that map the reference
 * segment to the segments of the generating path, recursively.
 */
export class LPEVonKoch extends GroupBBoxEffect {
  readonly nbgenerations: ScalarParam;
  readonly generator: VonKochPathParam;
  readonly similar_only: BoolParam;
  readonly drawall: BoolParam;
  readonly ref_path: VonKochRefPathParam;
  readonly maxComplexity: ScalarParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.nbgenerations = new ScalarParam(
      _('N_r of generations:'),
      _('Depth of the recursion --- keep low!!'),
      'nbgenerations',
      this,
      1,
    );
    this.generator = new VonKochPathParam(
      _('Generating path:'),
      _('Path whose segments define the iterated transforms'),
      'generator',
      this,
      'M0,0 L30,0 M0,10 L10,10 M 20,10 L30,10',
    );
    this.similar_only = new BoolParam(
      _('_Use uniform transforms only'),
      _(
        '2 consecutive segments are used to reverse/preserve orientation only (otherwise, they define a general transform).',
      ),
      'similar_only',
      this,
      false,
    );
    this.drawall = new BoolParam(
      _('Dra_w all generations'),
      _('If unchecked, draw only the last generation'),
      'drawall',
      this,
      true,
    );
    //FIXME: a path is used here instead of 2 points to work around path/point param incompatibility bug.
    this.ref_path = new VonKochRefPathParam(
      _('Reference segment:'),
      _('The reference segment. Defaults to the horizontal midline of the bbox.'),
      'ref_path',
      this,
      'M0,0 L10,0',
    );
    this.maxComplexity = new ScalarParam(
      _('_Max complexity:'),
      _('Disable effect if the output is too complex'),
      'maxComplexity',
      this,
      1000,
    );
    this.registerParameter(this.ref_path);
    this.registerParameter(this.generator);
    this.registerParameter(this.similar_only);
    this.registerParameter(this.nbgenerations);
    this.registerParameter(this.drawall);
    this.registerParameter(this.maxComplexity);
    this.apply_to_clippath_and_mask = true;
    this.nbgenerations.param_make_integer();
    this.nbgenerations.param_set_range(0, INT_MAX);
    this.maxComplexity.param_make_integer();
    this.maxComplexity.param_set_range(0, INT_MAX);
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    this.generator.reload();
    this.ref_path.reload();
    return false;
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    let affine = this.generator.get_relative_affine();
    const generating_path = this.generator.get_pathvector().map((p) => p.transformed(affine));
    if (generating_path.every((p) => p.size() === 0)) return path_in;
    if (this.is_load) {
      this.generator.reload();
      this.ref_path.reload();
    }

    //Collect transform matrices.
    affine = this.ref_path.get_relative_affine();
    const ref = this.ref_path.get_pathvector()[0];
    if (!ref) return path_in;
    const refpath = ref.transformed(affine);
    const A = refpath.pointAt(0);
    const B = refpath.pointAt(refpath.size());
    const u0 = B.sub(A);
    const m0 = new Affine(u0.x, u0.y, -u0.y, u0.x, A.x, A.y).inverse();

    const transforms: Affine[] = [];
    for (const i of generating_path) {
      if (i.size() === 1) {
        const p = i.pointAt(0);
        const u = i.pointAt(1).sub(p);
        transforms.push(m0.multiply(new Affine(u.x, u.y, -u.y, u.x, p.x, p.y)));
      } else if (i.size() >= 2) {
        const p = i.pointAt(1);
        const u = i.pointAt(2).sub(p);
        let v = p.sub(i.pointAt(0));
        if (this.similar_only.get_value()) {
          const sign = u.x * v.y - u.y * v.x >= 0 ? 1 : -1;
          v = new Point(-u.y * sign, u.x * sign);
        }
        transforms.push(m0.multiply(new Affine(u.x, u.y, v.x, v.y, p.x, p.y)));
      }
    }
    if (transforms.length === 0) return path_in;

    //Do nothing if the output is too complex...
    const nbgenerations = this.nbgenerations.get_value();
    const maxComplexity = this.maxComplexity.get_value();
    let path_in_complexity = 0;
    for (const k of path_in) path_in_complexity += k.size();
    let complexity = transforms.length ** nbgenerations * path_in_complexity;
    if (this.drawall.get_value()) {
      const k = transforms.length;
      if (k > 1) complexity = ((k ** (nbgenerations + 1) - 1) / (k - 1)) * path_in_complexity;
      else complexity = nbgenerations * k * path_in_complexity;
    }
    if (complexity > maxComplexity) {
      console.warn("VonKoch lpe's output too complex. Effect bypassed.");
      return path_in;
    }

    //Generate path:
    let pathi = path_in;
    let path_out = path_in;
    for (let i = 0; i < nbgenerations; i++) {
      if (this.drawall.get_value()) {
        path_out = [...path_in];
        complexity = path_in_complexity;
      } else {
        path_out = [];
        complexity = 0;
      }
      for (const transform of transforms) {
        for (let k = 0; k < pathi.length && complexity < maxComplexity; k++) {
          const p = pathi[k] as Path;
          path_out.push(p.transformed(transform));
          complexity += p.size();
        }
      }
      pathi = path_out;
    }
    return path_out;
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem, false, true);
    const paths = this.ref_path.get_pathvector();
    let A: Point;
    let B: Point;
    const front = paths[0];
    if (!front || front.size() === 0) {
      A = new Point(this.boundingbox_X.min(), this.boundingbox_Y.middle());
      B = new Point(this.boundingbox_X.max(), this.boundingbox_Y.middle());
    } else {
      A = front.pointAt(0);
      B = front.pointAt(front.size());
    }
    if (paths.length !== 1 || front?.size() !== 1) {
      const tmp_path = new Path(A);
      tmp_path.appendCurve(new LineSegment(A, B));
      this.ref_path.set_new_value([tmp_path], true);
    }
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    this.original_bbox(item as SPLPEItem, false, true);
    const A = new Point(this.boundingbox_X.min(), this.boundingbox_Y.middle());
    const B = new Point(this.boundingbox_X.max(), this.boundingbox_Y.middle());
    const path = new Path(A);
    path.appendCurve(new LineSegment(A, B));
    this.ref_path.set_new_value([path], true);
    const h = this.boundingbox_Y.extent() / 2;
    this.generator.set_new_value(
      [
        path.transformed(new Affine(1 / 3, 0, 0, 1 / 3, (A.x * 2) / 3, (A.y * 2) / 3 + h)),
        path.transformed(new Affine(1 / 3, 0, 0, 1 / 3, (B.x * 2) / 3, (B.y * 2) / 3 + h)),
      ],
      true,
    );
  }
}
