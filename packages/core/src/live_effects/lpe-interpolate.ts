// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-interpolate.cpp, src/live_effects/lpe-interpolate.h
/*
 * Copyright (C) Johan Engelen 2007-2008 <j.b.c.engelen@utwente.nl>
 */
import { type Affine, LineSegment, Path, type PathVector, write_svg_path } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { SPPath } from '../object/sp-path.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { PathParam } from './parameter/path.ts';

/**
 * Interpolate Sub-Paths (upstream LPEInterpolate): steps between the first and the second subpath,
 * placed along a trajectory path. The 2geom part runs in WASM.
 */
export class LPEInterpolate extends Effect {
  readonly trajectory_path: PathParam;
  readonly number_of_steps: ScalarParam;
  readonly equidistant_spacing: BoolParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.trajectory_path = new PathParam(
      _('Trajectory:'),
      _('Path along which intermediate steps are created.'),
      'trajectory',
      this,
      'M0,0 L0,0',
    );
    this.number_of_steps = new ScalarParam(
      _('Steps_:'),
      _('Determines the number of steps from start to end path.'),
      'steps',
      this,
      5,
    );
    this.equidistant_spacing = new BoolParam(
      _('E_quidistant spacing'),
      _(
        'If true, the spacing between intermediates is constant along the length of the path. If false, the distance depends on the location of the nodes of the trajectory path.',
      ),
      'equidistant_spacing',
      this,
      true,
    );
    this.show_orig_path = true;
    this.registerParameter(this.trajectory_path);
    this.registerParameter(this.equidistant_spacing);
    this.registerParameter(this.number_of_steps);
    this.number_of_steps.param_make_integer();
    this.number_of_steps.param_set_range(2, 2147483647);
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    this.trajectory_path.reload();
    return false;
  }

  protected override transform_multiply(postmul: Affine, _set: boolean): void {
    if (this.sp_lpe_item?.pathEffectsEnabled() && this.sp_lpe_item.optimizeTransforms()) {
      this.trajectory_path.param_transform_multiply(postmul, false);
    }
  }

  /** interpolate path_in[0] to path_in[1] */
  protected override doEffect_path(path_in: PathVector): PathVector {
    if (path_in.length < 2 || this.number_of_steps.get_value() < 2) return path_in;
    // Don't allow empty path parameter:
    const trajectory = this.trajectory_path.get_pathvector();
    if (trajectory.length === 0) return path_in;
    if (this.is_load) this.trajectory_path.reload();
    const affine = this.trajectory_path.get_relative_affine();
    const d = pathBoolopBackend().interpolatePath(
      write_svg_path(path_in),
      write_svg_path(trajectory.slice(0, 1).map((p) => p.transformed(affine))),
      this.number_of_steps.get_value(),
      this.equidistant_spacing.get_value(),
    );
    return sp_svg_read_pathv(d);
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    if (!(item instanceof SPPath)) return;
    const pathv = item.curveForEdit() ?? [];
    if (pathv.length < 2) return;
    const bounds_A = (pathv[0] as Path).boundsExact();
    const bounds_B = (pathv[1] as Path).boundsExact();
    if (bounds_A && bounds_B) {
      const traj = new Path(bounds_A.midpoint());
      traj.appendCurve(new LineSegment(bounds_A.midpoint(), bounds_B.midpoint()));
      this.trajectory_path.set_new_value([traj], true);
    } else {
      this.trajectory_path.param_set_and_write_default();
    }
  }
}
