// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/effect.cpp, src/live_effects/parameter/text.cpp, src/live_effects/lpe-tangent_to_curve.cpp
/*
 * Copyright (C) Johan Engelen 2007-2012 <j.b.c.engelen@alumnus.utwente.nl>
 */
import { are_near, LineSegment, Path, type PathVector, Point, write_svg_path } from '@inkscape-web/geom';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { LPE_CONVERSION_TOLERANCE } from './effect.ts';

/**
 * The path of path_from_piecewise(Piecewise(D2<SBasis>(SBasis(a[X], b[X]), SBasis(a[Y], b[Y]))),
 * LPE_CONVERSION_TOLERANCE): a line from a to b, closed when a and b are near.
 */
export function pathFromLine(a: Point, b: Point): Path {
  const path = new Path(a);
  path.appendCurve(new LineSegment(a, b));
  if (are_near(a, b, LPE_CONVERSION_TOLERANCE)) path.close();
  return path;
}

/** A value of a piecewise path with the unit vector of its derivative. */
export interface Pwd2Sample {
  point: Point;
  /** unit_vector(derivative(pwd2).valueAt(t)) */
  unit: Point;
}

function readSamples(flat: readonly number[]): { end: number; samples: Pwd2Sample[] } | null {
  if (flat.length === 0) return null;
  const samples: Pwd2Sample[] = [];
  for (let i = 1; i + 3 < flat.length; i += 4) {
    samples.push({
      point: new Point(flat[i] as number, flat[i + 1] as number),
      unit: new Point(flat[i + 2] as number, flat[i + 3] as number),
    });
  }
  return { end: flat[0] as number, samples };
}

/**
 * Path::toPwSb() of path sampled at the times ts of the piecewise domain (one unit per curve, the
 * closing segment included). `end` is the end of the domain (upstream pwd2.cuts.back()). Null for
 * an empty path.
 */
export function pwd2Samples(
  path: Path,
  ts: readonly number[],
): { end: number; samples: Pwd2Sample[] } | null {
  return readSamples(pathBoolopBackend().pwd2Samples(write_svg_path([path]), ts));
}

/**
 * arc_length_parametrization(path.toPwSb(), 2, 0.1) sampled at the arc lengths ss. `end` is the
 * end of the domain, the length of the path. Null for an empty path.
 */
export function arcLengthSamples(
  path: Path,
  ss: readonly number[],
): { end: number; samples: Pwd2Sample[] } | null {
  return readSamples(pathBoolopBackend().arcLengthSamples(write_svg_path([path]), ss));
}

/**
 * The result of Effect::doEffect_path when doEffect_pwd2 returns pwd2_in * m for each subpath
 * (m = [a, b, c, d, e, f]; the identity when the effect returns pwd2_in): every subpath as
 * piecewise SBasis, transformed, and back to a path.
 */
export function pwd2Transformed(path_in: PathVector, m: readonly number[]): PathVector {
  return sp_svg_read_pathv(pathBoolopBackend().pwd2Transformed(write_svg_path(path_in), m));
}
