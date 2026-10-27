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
}

let module: Promise<MainModule> | undefined;

export async function loadGeom(): Promise<Geom> {
  module ??= createModule();
  const m = await module;
  return {
    boolop: (a, b, op, fillA, fillB) => m.boolop(a, b, op, fillA, fillB),
    normalizePath: (d, precision) => m.normalizePath(d, precision),
  };
}
