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

import { type PathVector, parse_svg_path, write_svg_path } from '@inkscape-web/geom';

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
  /** flatten(pathv, fill_rule): the path without self-intersections. */
  flattenPath(d: string, fillRule: number): string;
  /** Geom::crossings(a, b) of the first paths of a and b: [ta, tb, ta, tb, ...]. */
  pathCrossings(a: string, b: string): number[];
  /** The livarot part of the Simplify LPE (lpe-simplify.cpp doEffect); threshold is scaled already. */
  simplifyPath(d: string, threshold: number, steps: number, justCoalesce: boolean): string;
  /** The livarot outline of the stroke of d (path-outline.cpp item_find_paths with bbox_only). */
  strokeOutline(d: string, width: number, join: number, butt: number, miter: number): string;
  /** do_offset() of helper/geom-pathstroke.cpp (Offset LPE). join is an Inkscape::LineJoinType. */
  offsetPath(
    d: string,
    toOffset: number,
    tolerance: number,
    miterLimit: number,
    fillRule: number,
    join: number,
    point: readonly [number, number],
  ): { d: string; helper: string; mix: string };
  /** The 2geom part of the Bend LPE (lpe-bendpath.cpp doEffect_pwd2); bbox is [x0, x1, y0, y1]. */
  bendPath(
    d: string,
    bend: string,
    bbox: readonly [number, number, number, number],
    propScale: number,
    scaleYRel: boolean,
    vertical: boolean,
    version15: boolean,
  ): string;
  /** pathvs_have_nonempty_overlap(a, b) of helper/geom.cpp (SPItem::collidesWith). */
  pathsOverlap(a: string, b: string): boolean;
  /**
   * The livarot part of the path modes of the tweak tool (Shape::MakeTweak and
   * the simplification after it); see TweakPathParams of @inkscape-web/wasm.
   */
  tweakPath(
    d: string,
    params: {
      mode: number;
      power: number;
      fillRule: number;
      center: readonly [number, number];
      vector: readonly [number, number];
      radius: number;
      i2doc: readonly [number, number, number, number, number, number];
      fidelity: number;
      force: number;
      zoom: number;
    },
  ): { changed: boolean; d: string };
}

let backend: PathBoolopBackend | null = null;

/** Set the implementation of the path operations (see PathBoolopBackend). */
export function setPathBoolopBackend(b: PathBoolopBackend | null): void {
  backend = b;
}

/** Upstream sp_pathvector_boolop(). Note the operand order: bool_op_diff gives b minus a. */
export function sp_pathvector_boolop(
  pathva: PathVector,
  pathvb: PathVector,
  bop: BooleanOp,
  fra: FillRule,
  frb: FillRule,
): PathVector {
  return parse_svg_path(
    pathBoolopBackend().boolop(write_svg_path(pathva), write_svg_path(pathvb), bop, fra, frb),
  );
}

/** Upstream flatten(): remove the self-intersections of pathv with the fill rule. */
export function flatten(pathv: PathVector, fill_rule: FillRule): PathVector {
  return parse_svg_path(pathBoolopBackend().flattenPath(write_svg_path(pathv), fill_rule));
}

/** Whether the path operations are available (they are not in tests that do not load WASM). */
export function hasPathBoolopBackend(): boolean {
  return backend !== null;
}

/** The implementation of the path operations. Throws if none was set. */
export function pathBoolopBackend(): PathBoolopBackend {
  if (!backend) throw new Error('No path boolop backend: call setPathBoolopBackend() at startup');
  return backend;
}
