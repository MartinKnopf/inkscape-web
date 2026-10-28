// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path/path-boolop.cpp, src/path/path-boolop.h, src/livarot/LivarotDefs.h
/*
 * Boolean operations.
 *
 * Authors:
 * see git history
 *  Created by fred on Fri Dec 05 2003.
 *  tweaked endlessly by bulia byak <buliabyak@users.sf.net>
 *
 * Copyright (C) 2018 Authors
 */

/** Upstream: src/livarot/LivarotDefs.h enum BooleanOp. Same values as @inkscape-web/wasm. */
export enum BooleanOp {
  bool_op_union = 0, // A OR B
  bool_op_inters = 1, // A AND B
  bool_op_diff = 2, // A \ B
  bool_op_symdiff = 3, // A XOR B
  bool_op_cut = 4, // coupure (pleines)
  bool_op_slice = 5, // coupure (contour)
}

/** Upstream: src/livarot/LivarotDefs.h enum FillRule. Same values as @inkscape-web/wasm. */
export enum FillRule {
  fill_oddEven = 0,
  fill_nonZero = 1,
  fill_positive = 2,
  fill_justDont = 3,
}

/**
 * The path operations that the core runs in upstream C++ (livarot), with
 * geometry as SVG path data. `Geom` of @inkscape-web/wasm implements it.
 * Operations and fill rules are BooleanOp and FillRule values (typed as
 * number, so that the enums of the WASM package fit).
 *
 * The core has no dependency on the WASM module: the app (or a test) loads
 * it and passes it to setPathBoolopBackend() once at startup. Then all
 * calls are synchronous.
 */
export interface PathBoolopBackend {
  /** sp_pathvector_boolop(a, b, op, fillA, fillB). Difference gives b minus a. */
  boolop(a: string, b: string, op: number, fillA: number, fillB: number): string;
  /** pathvector_cut(pathv, lines): the pieces of pathv, each with its holes. */
  cutPath(pathv: string, lines: string): string[];
  /** split_non_intersecting_paths(paths, fill_rule) of helper/geom-pathstroke.cpp. */
  splitNonIntersectingPaths(d: string, fillRule: number): string[];
}

let backend: PathBoolopBackend | null = null;

/** Set the implementation of the path operations (see PathBoolopBackend). */
export function setPathBoolopBackend(b: PathBoolopBackend | null): void {
  backend = b;
}

/** The implementation of the path operations. Throws if none was set. */
export function pathBoolopBackend(): PathBoolopBackend {
  if (!backend) throw new Error('No path boolop backend: call setPathBoolopBackend() at startup');
  return backend;
}
