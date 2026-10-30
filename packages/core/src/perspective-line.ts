// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/perspective-line.cpp, src/perspective-line.h
/*
 * Perspective line for 3D perspectives
 *
 * Authors:
 *   Maximilian Albert <Anhalter42@gmx.de>
 *
 * Copyright (C) 2007 authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Point } from '@inkscape-web/geom';
import type { Proj } from './axis-manip.ts';
import { Line } from './line-geometry.ts';
import type { Pt2 } from './proj_pt.ts';

/** The part of Persp3D that perspective lines need. */
interface Perspective {
  get_VP(axis: Proj.Axis): Pt2;
}

/**
 * A line starting at 'pt' and pointing in the direction of the vanishing point of 'axis'
 * (upstream Box3D::PerspectiveLine). If the VP is finite then the line runs through it;
 * otherwise it has the direction of the VP.
 */
export class PerspectiveLine extends Line {
  readonly vp_dir: Proj.Axis;
  readonly persp: Perspective;

  constructor(pt: Point, axis: Proj.Axis, persp: Perspective) {
    super(pt, persp.get_VP(axis).affine(), true);
    const vp = persp.get_VP(axis);
    if (!vp.is_finite()) this.set_direction(new Point(vp.at(0), vp.at(1)));
    this.vp_dir = axis;
    this.persp = persp;
  }
}
