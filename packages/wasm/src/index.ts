// SPDX-License-Identifier: GPL-2.0-or-later
// Typed API for geom-module.wasm (upstream lib2geom + livarot, see build.sh).
// Load once with loadGeom(); after that, all calls are synchronous.
import createModule, { type MainModule } from '../dist/geom-module.mjs';

/** Upstream: src/livarot/LivarotDefs.h enum BooleanOp */
export enum BooleanOp {
  Union = 0,
  Intersection = 1,
  Difference = 2,
  Exclusion = 3,
  Cut = 4,
  Slice = 5,
}

/** Upstream: src/livarot/LivarotDefs.h enum FillRule */
export enum FillRule {
  EvenOdd = 0,
  NonZero = 1,
  Positive = 2,
  JustDont = 3,
}

export interface Geom {
  /**
   * Upstream sp_pathvector_boolop(). Arguments are SVG path data.
   * Note the upstream operand order: Difference gives `b` minus `a`, so for
   * "bottom minus top" (Path > Difference) pass (top, bottom), as upstream does.
   */
  boolop(a: string, b: string, op: BooleanOp, fillA: FillRule, fillB: FillRule): string;
  /** Rewrite path data with absolute commands, no shorthands and the given precision. */
  normalizePath(d: string, precision: number): string;
  /** Bounds [left, top, right, bottom] of the path transformed by (a b c d e f); [] if the path is empty. */
  pathBounds(d: string, exact: boolean, m: AffineMatrix): number[];
  /** Parse, transform by the matrix and write with default writer settings. */
  transformPath(d: string, m: AffineMatrix): string;
  /** Parse, reverse (PathVector::reversed) and write with default writer settings. */
  reversePath(d: string): string;
  /** Geom::write_svg_path() of the parsed path. Precision -1 writes the shortest exact numbers. */
  writePath(d: string, precision: number, optimize: boolean, shorthands: boolean): string;
  /**
   * Like Inkscape's sp_svg_read_pathv(): a parse error keeps the paths read so far.
   * `ok` is false on an error. `zSnapThreshold` is SVGPathParser::setZSnapThreshold().
   */
  readPath(d: string, zSnapThreshold: number): { ok: boolean; d: string };
}

/** Affine matrix coefficients (a, b, c, d, e, f) like Geom::Affine. */
export type AffineMatrix = readonly [number, number, number, number, number, number];

let module: Promise<MainModule> | undefined;

export async function loadGeom(): Promise<Geom> {
  module ??= createModule();
  const m = await module;
  return {
    boolop: (a, b, op, fillA, fillB) => m.boolop(a, b, op, fillA, fillB),
    normalizePath: (d, precision) => m.normalizePath(d, precision),
    pathBounds: (d, exact, [a, b, c, dd, e, f]) => m.pathBounds(d, exact, a, b, c, dd, e, f),
    transformPath: (d, [a, b, c, dd, e, f]) => m.transformPath(d, a, b, c, dd, e, f),
    reversePath: (d) => m.reversePath(d),
    writePath: (d, precision, optimize, shorthands) => m.writePath(d, precision, optimize, shorthands),
    readPath: (d, zSnapThreshold) => m.readPath(d, zSnapThreshold) as { ok: boolean; d: string },
  };
}
