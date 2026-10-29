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
  /**
   * Upstream pathvector_cut(): the pieces of `pathv` cut by `lines`, each
   * piece with its holes (Path > Division).
   */
  cutPath(pathv: string, lines: string): string[];
  /**
   * Upstream split_non_intersecting_paths(): the parts of the path that do
   * not touch each other when filled with the fill rule (Path > Break Apart).
   */
  splitNonIntersectingPaths(d: string, fillRule: FillRule): string[];
  /** Upstream flatten() of path/path-boolop.cpp: remove self-intersections with the fill rule. */
  flattenPath(d: string, fillRule: FillRule): string;
  /** Geom::crossings() of the first path of `a` and of `b`: flat list [ta, tb, ta, tb, ...]. */
  pathCrossings(a: string, b: string): number[];
  /** The livarot part of LPESimplify::doEffect(); `threshold` is already scaled by the item size. */
  simplifyPath(d: string, threshold: number, steps: number, justCoalesce: boolean): string;
  /** The livarot outline of the stroke of `d` (path-outline.cpp item_find_paths, bbox only). */
  strokeOutline(d: string, width: number, join: number, butt: number, miter: number): string;
  /** Upstream do_offset() of helper/geom-pathstroke.cpp (Offset LPE). `join` is a LineJoinType. */
  offsetPath(
    d: string,
    toOffset: number,
    tolerance: number,
    miterLimit: number,
    fillRule: FillRule,
    join: number,
    point: readonly [number, number],
  ): { d: string; helper: string; mix: string };
  /**
   * The 2geom part of LPEBendPath::doEffect_pwd2() (Bend LPE): `d` bent along `bend`. bbox is
   * [x0, x1, y0, y1] of the original bounding box.
   */
  bendPath(
    d: string,
    bend: string,
    bbox: readonly [number, number, number, number],
    propScale: number,
    scaleYRel: boolean,
    vertical: boolean,
    version15: boolean,
  ): string;
  /** Upstream pathvs_have_nonempty_overlap(): whether the two paths intersect or overlap. */
  pathsOverlap(a: string, b: string): boolean;
  /**
   * The livarot part of the path modes of the tweak tool (upstream
   * sp_tweak_dilate_recursive(): Shape::MakeTweak() and the simplification after it).
   * See TweakPathParams. `changed` is false if MakeTweak() did not change the shape;
   * `d` is '' if the result has no path.
   */
  tweakPath(d: string, params: TweakPathParams): { changed: boolean; d: string };
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

/** Upstream: src/livarot/Shape.h, the tweak modes of Shape::MakeTweak(). */
export enum TweakMode {
  Grow = 0,
  Push = 1,
  Repel = 2,
  Roughen = 3,
}

/** Arguments of Geom.tweakPath(). */
export interface TweakPathParams {
  mode: TweakMode;
  /** The `dec` argument of MakeTweak(). */
  power: number;
  fillRule: FillRule;
  /** Brush center, document coordinates. */
  center: readonly [number, number];
  /** Push vector, document coordinates. */
  vector: readonly [number, number];
  radius: number;
  /** Item to document transform; `d` is in item coordinates. */
  i2doc: AffineMatrix;
  /** 0..1 */
  fidelity: number;
  /** Tool force, for the simplification threshold. */
  force: number;
  /** Desktop zoom, for the simplification threshold. */
  zoom: number;
}

/** Affine matrix coefficients (a, b, c, d, e, f) like Geom::Affine. */
export type AffineMatrix = readonly [number, number, number, number, number, number];

let module: Promise<MainModule> | undefined;

/**
 * Load the module (once). Tests in a DOM environment (happy-dom) pass the
 * file path of dist/geom-module.wasm in locateFile: there the module gets an
 * http URL from import.meta.url.
 */
export async function loadGeom(options?: { locateFile: (path: string) => string }): Promise<Geom> {
  module ??= createModule(options);
  const m = await module;
  return {
    boolop: (a, b, op, fillA, fillB) => m.boolop(a, b, op, fillA, fillB),
    cutPath: (pathv, lines) => m.cutPath(pathv, lines) as string[],
    splitNonIntersectingPaths: (d, fillRule) => m.splitNonIntersectingPaths(d, fillRule) as string[],
    pathsOverlap: (a, b) => m.pathsOverlap(a, b),
    tweakPath: (d, p) => {
      const [a, b, c, dd, e, f] = p.i2doc;
      return m.tweakPath(
        d,
        p.mode,
        p.power,
        p.fillRule,
        p.center[0],
        p.center[1],
        p.vector[0],
        p.vector[1],
        p.radius,
        a,
        b,
        c,
        dd,
        e,
        f,
        p.fidelity,
        p.force,
        p.zoom,
      ) as { changed: boolean; d: string };
    },
    normalizePath: (d, precision) => m.normalizePath(d, precision),
    flattenPath: (d, fillRule) => m.flattenPath(d, fillRule),
    pathCrossings: (a, b) => m.pathCrossings(a, b) as number[],
    strokeOutline: (d, width, join, butt, miter) => m.strokeOutline(d, width, join, butt, miter),
    simplifyPath: (d, threshold, steps, justCoalesce) => m.simplifyPath(d, threshold, steps, justCoalesce),
    offsetPath: (d, toOffset, tolerance, miterLimit, fillRule, join, [px, py]) =>
      m.offsetPath(d, toOffset, tolerance, miterLimit, fillRule, join, px, py) as {
        d: string;
        helper: string;
        mix: string;
      },
    bendPath: (d, bend, [x0, x1, y0, y1], propScale, scaleYRel, vertical, version15) =>
      m.bendPath(d, bend, x0, x1, y0, y1, propScale, scaleYRel, vertical, version15),
    pathBounds: (d, exact, [a, b, c, dd, e, f]) => m.pathBounds(d, exact, a, b, c, dd, e, f),
    transformPath: (d, [a, b, c, dd, e, f]) => m.transformPath(d, a, b, c, dd, e, f),
    reversePath: (d) => m.reversePath(d),
    writePath: (d, precision, optimize, shorthands) => m.writePath(d, precision, optimize, shorthands),
    readPath: (d, zSnapThreshold) => m.readPath(d, zSnapThreshold) as { ok: boolean; d: string },
  };
}
