// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/transf_mat_3x4.cpp, src/transf_mat_3x4.h
/*
 * 3x4 transformation matrix to map points from projective 3-space into the projective plane
 *
 * Authors:
 *   Maximilian Albert <Anhalter42@gmx.de>
 *
 * Copyright (C) 2007  Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type Affine, L2, Point } from '@inkscape-web/geom';
import { Proj } from './axis-manip.ts';
import { Pt2, Pt3 } from './proj_pt.ts';
import { svgNumber } from './svg/stringstream.ts';
import { gaussjord_solve, SolutionKind } from './syseq.ts';

/**
 * The perspective of a 3D box (upstream Proj::TransfMat3x4): the columns are the images of
 * the vanishing points of the x, y and z axes and of the origin.
 */
export class TransfMat3x4 {
  readonly tmat: number[][];

  constructor(vp_x?: Pt2 | TransfMat3x4, vp_y?: Pt2, vp_z?: Pt2, origin?: Pt2) {
    if (vp_x instanceof TransfMat3x4) {
      this.tmat = vp_x.tmat.map((row) => [...row]);
    } else if (vp_x && vp_y && vp_z && origin) {
      this.tmat = [0, 1, 2].map((i) => [vp_x.at(i), vp_y.at(i), vp_z.at(i), origin.at(i)]);
    } else {
      // or should we initialize all values with 0? does it matter at all?
      this.tmat = [0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
    }
  }

  column(axis: Proj.Axis): Pt2 {
    return new Pt2(this.tmat[0]![axis]!, this.tmat[1]![axis]!, this.tmat[2]![axis]!);
  }

  image(point: Pt3): Pt2 {
    const [x, y, w] = this.tmat.map((row) => row.reduce((s, m, j) => s + m * point.at(j), 0));
    return new Pt2(x, y, w);
  }

  preimage(pt: Point, coord = 0, axis: Proj.Axis = Proj.Axis.Z): Pt3 {
    const x = [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
    const v = [pt.x, pt.y, 1.0];
    const sol = gaussjord_solve(this.tmat, x, v, axis, coord, true);
    if (sol !== SolutionKind.unique) {
      if (sol === SolutionKind.no_solution) console.warn('No solution. Please investigate.');
      else console.warn('Infinitely many solutions. Please investigate.');
    }
    return new Pt3(x[0], x[1], x[2], x[3]);
  }

  set_image_pt(axis: Proj.Axis, pt: Pt2): void {
    // FIXME: Do we need to adapt the coordinates in any way or can we just use them as they are?
    for (let i = 0; i < 3; ++i) this.tmat[i]![axis] = pt.at(i);
  }

  toggle_finite(axis: Proj.Axis): void {
    if (axis === Proj.Axis.W) return;
    if (this.has_finite_image(axis)) {
      const dir = this.column(axis).affine().sub(this.column(Proj.Axis.W).affine());
      this.#set_column(axis, new Pt2(dir.x, dir.y, 0));
    } else {
      const dir = this.column(axis).add(new Pt2(this.column(Proj.Axis.W).affine()));
      dir.pt[2] = 1.0;
      this.#set_column(axis, dir);
    }
  }

  /** The direction of an infinite vanishing point in degrees; infinity for a finite one. */
  get_infinite_angle(axis: Proj.Axis): number {
    if (this.has_finite_image(axis)) return Number.POSITIVE_INFINITY;
    const vp = this.column(axis);
    return (Math.atan2(vp.at(1), vp.at(0)) * 180.0) / Math.PI;
  }

  /** Set the direction of an infinite vanishing point; angle is in degrees. */
  set_infinite_direction(axis: Proj.Axis, angle: number): void {
    if (this.tmat[2]![axis] !== 0) return; // don't set directions for finite VPs
    const a = (angle * Math.PI) / 180;
    const rad = L2(new Point(this.tmat[0]![axis]!, this.tmat[1]![axis]!));
    this.set_image_pt(axis, new Pt2(Math.cos(a) * rad, Math.sin(a) * rad, 0.0));
  }

  has_finite_image(axis: Proj.Axis): boolean {
    return this.tmat[2]![axis] !== 0.0;
  }

  pt_to_str(axis: Proj.Axis): string {
    return [0, 1, 2].map((i) => svgNumber(this.tmat[i]![axis]!)).join(' : ');
  }

  /* Check for equality (with a small tolerance epsilon) */
  equals(rhs: TransfMat3x4): boolean {
    // Should we allow a certain tolerance or "normalize" the matrices first?
    return [Proj.Axis.X, Proj.Axis.Y, Proj.Axis.Z].every((a) => this.column(a).equals(rhs.column(a)));
  }

  /* Multiply a projective matrix by an affine matrix (by only multiplying the 'affine part' of the
   * projective matrix) */
  multiply(A: Affine): TransfMat3x4 {
    const ret = new TransfMat3x4();
    const t = this.tmat;
    for (let j = 0; j < 4; ++j) {
      ret.tmat[0]![j] = A.c0 * t[0]![j]! + A.c2 * t[1]![j]! + A.c4 * t[2]![j]!;
      ret.tmat[1]![j] = A.c1 * t[0]![j]! + A.c3 * t[1]![j]! + A.c5 * t[2]![j]!;
      ret.tmat[2]![j] = t[2]![j]!;
    }
    return ret;
  }

  #set_column(axis: Proj.Axis, pt: Pt2): void {
    for (let i = 0; i < 3; ++i) this.tmat[i]![axis] = pt.at(i);
  }
}
