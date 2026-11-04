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
  /** helper/geom-nodesatellite.cpp timeAtArcLength() on the first curve of d. */
  nodesatTimeAtArcLength(d: string, a: number): number;
  /** helper/geom-nodesatellite.cpp arcLengthAt() on the first curve of d. */
  nodesatArcLengthAt(d: string, a: number): number;
  /** NodeSatellite::radToLen() (curves as path data with one curve). */
  nodesatRadToLen(a: number, curveIn: string, curveOut: string): number;
  /** NodeSatellite::lenToRad() (curves as path data with one curve). */
  nodesatLenToRad(a: number, curveIn: string, curveOut: string): number;
  /** The 2geom part of the Taper stroke LPE: stretch_along() of d with pattern, as one path. */
  taperStretchAlong(d: string, pattern: string, width: number): string;
  /** live_effects/spiro.cpp spiro_run(): xy is [x0, y0, x1, y1, ...], ty one spiro_cp type per point. */
  spiroRun(xy: readonly number[], ty: string): string;
  /** lpe-jointype.cpp and lpe-dashed-stroke.cpp doEffect_path. */
  joinTypePath(
    d: string,
    width: number,
    miterLimit: number,
    forceJoin: boolean,
    join: number,
    cap: number,
  ): string;
  dashedStrokePath(
    d: string,
    numberdashes: number,
    holefactor: number,
    splitsegments: boolean,
    halfextreme: boolean,
    unifysegment: boolean,
  ): string;
  /** lpe-interpolate.cpp doEffect_path; trajectory is already in the item's coordinates. */
  interpolatePath(d: string, trajectory: string, steps: number, equidistant: boolean): string;
  /**
   * lpe-sketch.cpp doEffect_pwd2 on all paths of d. rnd(k) is the next random number of the k-th
   * RandomParam, values[k] its value. Returns '!' when the upstream code throws.
   */
  sketchPath(
    d: string,
    rnd: (k: number) => number,
    values: readonly number[],
    nbiter_approxstrokes: number,
    strokelength: number,
    strokeoverlap: number,
    tremble_frequency: number,
    nbtangents: number,
    tgtscale: number,
    tgtlength: number,
  ): string;
  /**
   * The Power stroke outline of the first path of d (lpe-powerstroke.cpp doEffect_path loop body).
   * ts is [x0, y0, ...]: the width points of the subpath, x relative to its start, y scaled.
   */
  powerstrokePath(
    d: string,
    ts: readonly number[],
    legacy: boolean,
    sortPoints: boolean,
    interpolator: number,
    beta: number,
    startCap: number,
    endCap: number,
    join: number,
    miterLimit: number,
  ): string;
  /** helper/geom-pathstroke.cpp half_outline() of the first path of d. join is a LineJoinType. */
  halfOutline(d: string, width: number, miter: number, join: number): string;
  /**
   * The 2geom part of the Envelope Deformation LPE (lpe-envelope.cpp doEffect_pwd2). bends are the
   * top, right, bottom and left paths; bbox is [x0, x1, y0, y1].
   */
  envelopePath(
    d: string,
    bends: readonly [string, string, string, string],
    bbox: readonly [number, number, number, number],
    xx: boolean,
    yy: boolean,
  ): string;
  /** The 2geom part of the Pattern Along Path LPE (lpe-patternalongpath.cpp doEffect_pwd2). */
  patternAlongPath(
    d: string,
    pattern: string,
    params: {
      copytype: number;
      spacing: number;
      normal_offset: number;
      tang_offset: number;
      prop_units: boolean;
      vertical_pattern: boolean;
      prop_scale: number;
      scale_y_rel: boolean;
      fuse_tolerance: number;
    },
  ): string;
  /**
   * The livarot outline of the stroke of `d` as an intersection free path (path-outline.cpp
   * item_find_paths without bbox_only). `join` and `butt` are livarot JoinType and ButtType; the
   * miter is multiplied by the width already; dashes are the computed dash array (empty: none).
   */
  strokeToPath(
    d: string,
    width: number,
    join: number,
    butt: number,
    miter: number,
    dashes: readonly number[],
    dashOffset: number,
    scale: number,
  ): string;
  /**
   * Inset (negative width) or outset (positive) the filled path with livarot's MakeOffset
   * (path-offset.cpp sp_selected_path_do_offset); fillRule is a FillRule. Empty if nothing is left.
   */
  /**
   * The contour of the filled path without self-intersections (the original of an offset object,
   * path-offset.cpp sp_selected_path_create_offset_object); fillRule is a FillRule. Empty if nothing is left.
   */
  normalizeShape(d: string, fillRule: number): string;
  offsetShape(d: string, width: number, join: number, miter: number, fillRule: number): string;
  /**
   * The offset of the original path of an offset object by `rad` with round joins (sp-offset.cpp
   * SPOffset::set_shape); size is the diagonal of its bounding box divided by the scale (0: none).
   */
  offsetOriginal(d: string, rad: number, size: number): string;
  /**
   * Move boxes [minx, maxx, miny, maxy, ...] as little as possible so that they do not overlap
   * (libvpsc removeoverlaps); returns the centre [x, y, ...] of each box.
   */
  removeOverlaps(boxes: readonly number[]): number[];
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
  /** A new libavoid router (upstream libavoid in src/3rdparty/adaptagrams). */
  newAvoidRouter(): AvoidRouter;
}

/**
 * One libavoid router (upstream Avoid::Router of SPDocument) with its shapes and connectors,
 * named by integer ids. Call free() when the document closes.
 */
export interface AvoidRouter {
  /** Upstream new Avoid::ShapeRef(router, poly, id): an obstacle polygon [x, y, x, y, ...]. */
  addShape(id: number, polygon: readonly number[]): void;
  moveShape(id: number, polygon: readonly number[]): void;
  deleteShape(id: number): void;
  /** Upstream new Avoid::ConnRef(router, id) with setRoutingType() and the reroute callback. */
  addConnector(id: number, orthogonal: boolean): void;
  setRoutingType(id: number, orthogonal: boolean): void;
  setEndpoints(id: number, x0: number, y0: number, x1: number, y1: number): void;
  makePathInvalid(id: number): void;
  isInitialised(id: number): boolean;
  deleteConnector(id: number): void;
  processTransaction(): boolean;
  /** The connectors whose route changed in the transactions since the last call. */
  takeChanged(): number[];
  /**
   * displayRoute(), with curvedPolyline(curvature) if curvature > 0: the points and one
   * path command per point ('M', 'L' or 'C', where 'C' takes the point and the next two).
   */
  route(id: number, curvature: number): { points: number[]; types: string };
  free(): void;
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
/**
 * A node of the potrace path tree (upstream potrace_path_t): the segment tags
 * (POTRACE_CURVETO = 1, POTRACE_CORNER = 2), 6 numbers per segment (the 3 points
 * of potrace_curve_t.c), and the child paths (holes).
 */
export interface PotracePath {
  tags: number[];
  c: number[];
  children: PotracePath[];
}

/** The potrace parameters (upstream potrace_param_t, without progress). */
export interface PotraceParams {
  turdsize: number;
  alphamax: number;
  opticurve: boolean;
  opttolerance: number;
}

/** A color quantized image (upstream IndexedMap): color index per pixel and the colors (r, g, b, ...). */
export interface IndexedMapData {
  pixels: Uint32Array;
  clut: number[];
  nrColors: number;
}

/**
 * Upstream potrace and the filters of src/trace/. RGB images have 3 bytes per pixel, gray maps
 * one number per pixel in 0..765 (upstream GrayMap), both row by row.
 */
export interface Trace {
  /** potrace_trace() of a bitmap with one byte per pixel (non-zero: black); null on failure. */
  potraceTrace(bits: Uint8Array, width: number, height: number, params: PotraceParams): PotracePath[] | null;
  /** Upstream rgbMapQuantize(). */
  rgbMapQuantize(rgb: Uint8Array, width: number, height: number, nrColors: number): IndexedMapData;
  /** Upstream rgbMapGaussian(). */
  rgbMapGaussian(rgb: Uint8Array, width: number, height: number): Uint8Array;
  /** Upstream grayMapGaussian(). */
  grayMapGaussian(gray: Uint32Array, width: number, height: number): Uint32Array;
  /** Upstream grayMapCanny(). */
  grayMapCanny(gray: Uint32Array, width: number, height: number, low: number, high: number): Uint32Array;
  /** Upstream quantizeBand(). */
  quantizeBand(rgb: Uint8Array, width: number, height: number, nrColors: number): Uint32Array;
  /**
   * The livarot part of the paint bucket (upstream flood-tool.cpp do_trace()): the path data
   * as livarot writes it, inset or outset by offset when not 0; '' if nothing is left.
   */
  floodPathData(d: string, offset: number): string;
}

/** An affine matrix as Geom::Affine stores it (the geom package's Affine has these fields). */
export interface AffineLike {
  readonly c0: number;
  readonly c1: number;
  readonly c2: number;
  readonly c3: number;
  readonly c4: number;
  readonly c5: number;
}

/** A livarot Shape: a wrap shape of flowed text. delete() frees it. */
export interface TextShapeHandle {
  hasEdges(): boolean;
  /** [left, top, right, bottom] */
  bbox(): number[];
  delete(): void;
}

/** The upstream ShapeScanlineMaker on a TextShapeHandle. delete() frees it. */
export interface TextScanlineMakerHandle {
  makeScanline(ascent: number, descent: number): number[];
  completeLine(): void;
  yCoordinate(): number;
  setNewYCoordinate(y: number): void;
  canExtendCurrentScanline(ascent: number, descent: number): boolean;
  setLineHeight(ascent: number, descent: number): void;
  delete(): void;
}

/** The livarot Path of a textPath. delete() frees it. */
export interface TextPathHandle {
  empty(): boolean;
  closed(): boolean;
  length(): number;
  position(offset: number): number[];
  lastPiece(): number;
  pointAndTangentAt(piece: number, t: number): number[];
  pointAt(piece: number, t: number): number[];
  onSameSubpath(start_piece: number, end_piece: number): boolean;
  nearestLength(x: number, y: number): number;
  delete(): void;
}

/**
 * The livarot part of text layout (bindings/text-layout.cpp): wrap shapes,
 * the scanline maker and the textPath path. Structurally the core TextLayoutBackend.
 */
export interface TextLayout {
  inclusionShape(d: string, transform: AffineLike, padding: number): TextShapeHandle;
  exclusionShape(d: string, transform: AffineLike, margin: number): TextShapeHandle;
  regionShape(d: string, transform: AffineLike, evenodd: boolean): TextShapeHandle;
  rectShape(x0: number, y0: number, x1: number, y1: number): TextShapeHandle;
  booleen(a: TextShapeHandle, b: TextShapeHandle, op: number): TextShapeHandle;
  copyShape(a: TextShapeHandle): TextShapeHandle;
  scanlineMaker(shape: TextShapeHandle, block_progression: number): TextScanlineMakerHandle;
  textPath(d: string, transform: AffineLike): TextPathHandle;
}

const affineArray = (a: AffineLike) => [a.c0, a.c1, a.c2, a.c3, a.c4, a.c5];

export async function loadGeom(options?: {
  locateFile: (path: string) => string;
}): Promise<Geom & Trace & TextLayout> {
  module ??= createModule(options);
  const m = await module;
  return {
    inclusionShape: (d, t, padding) => m.TextShape.inclusion(d, affineArray(t), padding)!,
    exclusionShape: (d, t, margin) => m.TextShape.exclusion(d, affineArray(t), margin)!,
    regionShape: (d, t, evenodd) => m.TextShape.region(d, affineArray(t), evenodd)!,
    rectShape: (x0, y0, x1, y1) => m.TextShape.rect(x0, y0, x1, y1)!,
    booleen: (a, b, op) =>
      m.TextShape.booleen(
        a as Parameters<typeof m.TextShape.booleen>[0],
        b as Parameters<typeof m.TextShape.booleen>[1],
        op,
      )!,
    copyShape: (a) => m.TextShape.copy(a as Parameters<typeof m.TextShape.copy>[0])!,
    scanlineMaker: (shape, block_progression) =>
      new m.TextScanlineMaker(
        shape as Parameters<typeof m.TextShape.booleen>[0],
        block_progression,
      ) as TextScanlineMakerHandle,
    textPath: (d, t) => new m.TextPathPath(d, affineArray(t)) as TextPathHandle,
    potraceTrace: (bits, width, height, p) =>
      m.potraceTrace(bits, width, height, p.turdsize, p.alphamax, p.opticurve ? 1 : 0, p.opttolerance) as
        | PotracePath[]
        | null,
    rgbMapQuantize: (rgb, width, height, n) => m.rgbMapQuantize(rgb, width, height, n) as IndexedMapData,
    rgbMapGaussian: (rgb, width, height) => m.rgbMapGaussian(rgb, width, height) as Uint8Array,
    grayMapGaussian: (gray, width, height) => m.grayMapGaussian(gray, width, height) as Uint32Array,
    grayMapCanny: (gray, width, height, low, high) =>
      m.grayMapCanny(gray, width, height, low, high) as Uint32Array,
    quantizeBand: (rgb, width, height, n) => m.quantizeBand(rgb, width, height, n) as Uint32Array,
    floodPathData: (d, offset) => m.floodPathData(d, offset),
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
    nodesatTimeAtArcLength: (d, a) => m.nodesatTimeAtArcLength(d, a),
    nodesatArcLengthAt: (d, a) => m.nodesatArcLengthAt(d, a),
    nodesatRadToLen: (a, ci, co) => m.nodesatRadToLen(a, ci, co),
    nodesatLenToRad: (a, ci, co) => m.nodesatLenToRad(a, ci, co),
    taperStretchAlong: (d, pattern, width) => m.taperStretchAlong(d, pattern, width),
    spiroRun: (xy, ty) => m.spiroRun(xy, ty),
    joinTypePath: (d, width, miterLimit, forceJoin, join, cap) =>
      m.joinTypePath(d, width, miterLimit, forceJoin, join, cap),
    dashedStrokePath: (d, numberdashes, holefactor, splitsegments, halfextreme, unifysegment) =>
      m.dashedStrokePath(d, numberdashes, holefactor, splitsegments, halfextreme, unifysegment),
    interpolatePath: (d, trajectory, steps, equidistant) =>
      m.interpolatePath(d, trajectory, steps, equidistant),
    sketchPath: (
      d,
      rnd,
      values,
      nbiter,
      strokelength,
      strokeoverlap,
      tremble_frequency,
      nbtangents,
      tgtscale,
      tgtlength,
    ) =>
      m.sketchPath(
        d,
        rnd,
        values,
        nbiter,
        strokelength,
        strokeoverlap,
        tremble_frequency,
        nbtangents,
        tgtscale,
        tgtlength,
      ),
    powerstrokePath: (d, ts, legacy, sortPoints, interpolator, beta, startCap, endCap, join, miterLimit) =>
      m.powerstrokePath(d, ts, legacy, sortPoints, interpolator, beta, startCap, endCap, join, miterLimit),
    halfOutline: (d, width, miter, join) => m.halfOutline(d, width, miter, join),
    envelopePath: (d, [b1, b2, b3, b4], [x0, x1, y0, y1], xx, yy) =>
      m.envelopePath(d, b1, b2, b3, b4, x0, x1, y0, y1, xx, yy),
    patternAlongPath: (d, pattern, p) =>
      m.patternAlongPath(
        d,
        pattern,
        p.copytype,
        p.spacing,
        p.normal_offset,
        p.tang_offset,
        p.prop_units,
        p.vertical_pattern,
        p.prop_scale,
        p.scale_y_rel,
        p.fuse_tolerance,
      ),
    strokeOutline: (d, width, join, butt, miter) => m.strokeOutline(d, width, join, butt, miter),
    strokeToPath: (d, width, join, butt, miter, dashes, dashOffset, scale) =>
      m.strokeToPath(d, width, join, butt, miter, [...dashes], dashOffset, scale),
    normalizeShape: (d, fillRule) => m.normalizeShape(d, fillRule),
    offsetShape: (d, width, join, miter, fillRule) => m.offsetShape(d, width, join, miter, fillRule),
    offsetOriginal: (d, rad, size) => m.offsetOriginal(d, rad, size),
    removeOverlaps: (boxes) => m.removeOverlaps([...boxes]) as number[],
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
    newAvoidRouter: () => {
      const r = new m.AvoidRouter();
      return {
        addShape: (id, polygon) => r.addShape(id, polygon),
        moveShape: (id, polygon) => r.moveShape(id, polygon),
        deleteShape: (id) => r.deleteShape(id),
        addConnector: (id, orthogonal) => r.addConnector(id, orthogonal),
        setRoutingType: (id, orthogonal) => r.setRoutingType(id, orthogonal),
        setEndpoints: (id, x0, y0, x1, y1) => r.setEndpoints(id, x0, y0, x1, y1),
        makePathInvalid: (id) => r.makePathInvalid(id),
        isInitialised: (id) => r.isInitialised(id),
        deleteConnector: (id) => r.deleteConnector(id),
        processTransaction: () => r.processTransaction(),
        takeChanged: () => r.takeChanged() as number[],
        route: (id, curvature) => r.route(id, curvature) as { points: number[]; types: string },
        free: () => r.delete(),
      };
    },
  };
}

export * from './text.ts';
