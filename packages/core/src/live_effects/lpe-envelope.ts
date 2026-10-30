// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-envelope.cpp, src/live_effects/lpe-envelope.h
/*
 * Copyright (C) Steren Giannini 2008 <steren.giannini@gmail.com>
 */
import { type Affine, LineSegment, Path, type PathVector, Point, write_svg_path } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { PathParam } from './parameter/path.ts';

/**
 * Envelope Deformation (upstream LPEEnvelope): deforms the item with four paths on its sides.
 * The 2geom part (doEffect_pwd2) runs in WASM.
 */
export class LPEEnvelope extends GroupBBoxEffect {
  readonly bend_path1: PathParam;
  readonly bend_path2: PathParam;
  readonly bend_path3: PathParam;
  readonly bend_path4: PathParam;
  readonly xx: BoolParam;
  readonly yy: BoolParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.bend_path1 = new PathParam(
      _('Top bend path:'),
      _('Top path along which to bend the original path'),
      'bendpath1',
      this,
      'M0,0 L1,0',
    );
    this.bend_path2 = new PathParam(
      _('Right bend path:'),
      _('Right path along which to bend the original path'),
      'bendpath2',
      this,
      'M0,0 L1,0',
    );
    this.bend_path3 = new PathParam(
      _('Bottom bend path:'),
      _('Bottom path along which to bend the original path'),
      'bendpath3',
      this,
      'M0,0 L1,0',
    );
    this.bend_path4 = new PathParam(
      _('Left bend path:'),
      _('Left path along which to bend the original path'),
      'bendpath4',
      this,
      'M0,0 L1,0',
    );
    this.xx = new BoolParam(
      _('_Enable left &amp; right paths'),
      _('Enable the left and right deformation paths'),
      'xx',
      this,
      true,
    );
    this.yy = new BoolParam(
      _('_Enable top &amp; bottom paths'),
      _('Enable the top and bottom deformation paths'),
      'yy',
      this,
      true,
    );
    this.registerParameter(this.yy);
    this.registerParameter(this.xx);
    this.registerParameter(this.bend_path1);
    this.registerParameter(this.bend_path2);
    this.registerParameter(this.bend_path3);
    this.registerParameter(this.bend_path4);
    this.concatenate_before_pwd2 = true;
    this.apply_to_clippath_and_mask = true;
  }

  #paths(): PathParam[] {
    return [this.bend_path1, this.bend_path2, this.bend_path3, this.bend_path4];
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    for (const p of this.#paths()) p.reload();
    return false;
  }

  protected override transform_multiply(postmul: Affine, _set: boolean): void {
    if (this.sp_lpe_item?.pathEffectsEnabled() && this.sp_lpe_item.optimizeTransforms()) {
      for (const p of this.#paths()) p.param_transform_multiply(postmul, false);
    }
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem, false, true);
    if (this.is_load) for (const p of this.#paths()) p.reload();
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    if (!this.xx.get_value() && !this.yy.get_value()) return path_in;
    if (this.#paths().some((p) => p.get_pathvector().length === 0)) return path_in;
    const bends = this.#paths().map((p) => {
      const affine = p.get_relative_affine();
      return write_svg_path(p.get_pathvector().map((path) => path.transformed(affine)));
    }) as [string, string, string, string];
    const d = pathBoolopBackend().envelopePath(
      write_svg_path(path_in),
      bends,
      [
        this.boundingbox_X.min(),
        this.boundingbox_X.max(),
        this.boundingbox_Y.min(),
        this.boundingbox_Y.max(),
      ],
      this.xx.get_value(),
      this.yy.get_value(),
    );
    return sp_svg_read_pathv(d);
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    this.original_bbox(item as SPLPEItem, false, true);
    const X = this.boundingbox_X;
    const Y = this.boundingbox_Y;
    const Up_Left = new Point(X.min(), Y.min());
    const Up_Right = new Point(X.max(), Y.min());
    const Down_Left = new Point(X.min(), Y.max());
    const Down_Right = new Point(X.max(), Y.max());
    const line = (a: Point, b: Point) => {
      const p = new Path(a);
      p.appendCurve(new LineSegment(a, b));
      return [p];
    };
    this.bend_path1.set_new_value(line(Up_Left, Up_Right), true);
    this.bend_path2.set_new_value(line(Up_Right, Down_Right), true);
    this.bend_path3.set_new_value(line(Down_Left, Down_Right), true);
    this.bend_path4.set_new_value(line(Up_Left, Down_Left), true);
  }
}
