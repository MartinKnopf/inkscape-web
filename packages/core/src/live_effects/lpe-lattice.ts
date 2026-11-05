// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-lattice.cpp, src/live_effects/lpe-lattice.h
/** \file
 * LPE <lattice> implementation
 */
/*
 * Authors:
 *   Johan Engelen <j.b.c.engelen@utwente.nl>
 *   Steren Giannini
 *   Noé Falzon
 *   Victor Navez
 *
 * Copyright (C) 2007-2008 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type PathVector, Point, write_svg_path } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { PointParam } from './parameter/point.ts';

/**
 * Lattice Deformation Legacy (upstream LPELattice): warps the path with a 4x4 grid of control
 * points. The SBasis2d math runs in WASM.
 */
export class LPELattice extends GroupBBoxEffect {
  /** grid_point0 ... grid_point15 */
  readonly grid_points: PointParam[] = [];

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    // initialise your parameters here:
    for (let i = 0; i < 16; i++) {
      this.grid_points.push(
        new PointParam(_(`Control handle ${i}:`), _(`Control handle ${i}`), `gridpoint${i}`, this),
      );
    }
    // register all your parameters here, so Inkscape knows which parameters this effect has:
    for (const p of this.grid_points) this.registerParameter(p);
    this.apply_to_clippath_and_mask = true;
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const handles = this.grid_points.flatMap((p) => [p.x, p.y]);
    const d = pathBoolopBackend().latticePath(write_svg_path(path_in), handles, [
      this.boundingbox_X.min(),
      this.boundingbox_X.max(),
      this.boundingbox_Y.min(),
      this.boundingbox_Y.max(),
    ]);
    return sp_svg_read_pathv(d);
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem, false, true);
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    this.original_bbox(item as SPLPEItem, false, true);
    const X = this.boundingbox_X;
    const Y = this.boundingbox_Y;
    const x13 = (1.0 / 3) * X.max() + (2.0 / 3) * X.min();
    const x23 = (2.0 / 3) * X.max() + (1.0 / 3) * X.min();
    const y13 = (1.0 / 3) * Y.max() + (2.0 / 3) * Y.min();
    const y23 = (2.0 / 3) * Y.max() + (1.0 / 3) * Y.min();
    // place the 16 control points
    const points = [
      [X.min(), Y.min()],
      [X.max(), Y.min()],
      [X.min(), Y.max()],
      [X.max(), Y.max()],
      [x13, Y.min()],
      [x23, Y.min()],
      [x13, Y.max()],
      [x23, Y.max()],
      [X.min(), y13],
      [X.max(), y13],
      [X.min(), y23],
      [X.max(), y23],
      [x13, y13],
      [x23, y13],
      [x13, y23],
      [x23, y23],
    ];
    points.forEach(([x, y], i) => {
      const p = this.grid_points[i] as PointParam;
      p.param_setValue(new Point(x as number, y as number));
      // (upstream updates the defaults of the points 1 to 15)
      if (i > 0) p.param_update_default(p.value);
    });
  }
}
