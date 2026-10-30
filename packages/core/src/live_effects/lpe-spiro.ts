// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-spiro.cpp, src/live_effects/lpe-spiro.h
/*
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import type { PathVector } from '@inkscape-web/geom';
import { is_straight_curve } from '../helper/geom.ts';
import { GeomNodeType, get_nodetype } from '../object/sp-shape.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';

/** Spiro spline (upstream LPESpiro): the nodes of the path are the control points of a Spiro spline. */
export class LPESpiro extends Effect {
  // biome-ignore lint/complexity/noUselessConstructor: Effect's constructor is protected
  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
  }

  override doEffect(curve: PathVector): PathVector {
    return sp_spiro_do_effect(curve);
  }
}

/**
 * Runs each subpath through Spiro (upstream sp_spiro_do_effect). The spline math (spiro.cpp) runs
 * in WASM. As upstream, the result holds only the spline of the last non-empty subpath.
 */
export function sp_spiro_do_effect(original_pathv: PathVector): PathVector {
  let curve: PathVector = [];
  for (const path_it of original_pathv) {
    if (path_it.empty()) continue;
    // the spiro_cp points: x and y in xy, the types in ty
    const xy: number[] = [];
    const ty: string[] = [];
    const p0 = path_it.initialPoint();
    xy.push(p0.x, p0.y);
    ty.push('{'); // for closed paths, this is overwritten

    // Loop to end_default (so without last segment), loop ends when curve_it2 hits the end
    // and then curve_it1 points to end or closing segment.
    const curves = path_it.curves();
    let i1 = 0; // incoming curve
    for (let i2 = 1; i2 < curves.length; i1++, i2++) {
      // This deals with the node between curve_it1 and curve_it2.
      const c1 = curves[i1]!;
      const c2 = curves[i2]!;
      const p = c1.finalPoint();
      xy.push(p.x, p.y);
      const this_is_line = is_straight_curve(c1);
      const next_is_line = is_straight_curve(c2);
      const nodetype = get_nodetype(c1, c2);
      if (nodetype === GeomNodeType.NODE_SMOOTH) {
        if (this_is_line && !next_is_line) ty.push(']');
        else if (next_is_line && !this_is_line) ty.push('[');
        else ty.push('c');
      } else {
        ty.push('v');
      }
    }

    // Now we're at the end of the path: curve_it1 is the last curve.
    const last = curves[i1]!;
    const p = last.finalPoint();
    if (path_it.closed()) {
      // curve_it1 points to the (visible) closing segment.
      switch (get_nodetype(last, path_it.at(0))) {
        case GeomNodeType.NODE_NONE: // can't happen! but if it does, it means the path isn't closed :-)
          xy.push(p.x, p.y);
          ty.push('}');
          break;
        case GeomNodeType.NODE_CUSP:
          ty[0] = 'v';
          break;
        case GeomNodeType.NODE_SMOOTH:
          ty[0] = 'c';
          break;
      }
    } else {
      // set type to path closer
      xy.push(p.x, p.y);
      ty.push('}');
    }

    // run subpath through spiro
    curve = sp_svg_read_pathv(pathBoolopBackend().spiroRun(xy, ty.join('')));
  }
  return curve;
}
