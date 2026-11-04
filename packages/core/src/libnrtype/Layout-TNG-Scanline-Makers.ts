// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/Layout-TNG-Scanline-Makers.cpp, src/libnrtype/Layout-TNG-Scanline-Maker.h
/*
 * Inkscape::Text::Layout::ScanlineMaker - text layout engine shape measurers
 *
 * Authors:
 *   Richard Hughes <cyreve@users.sf.net>
 *
 * Copyright (C) 2005 Richard Hughes
 */
import type { Affine } from '@inkscape-web/geom';
import { Direction, type FontMetrics } from './Layout-TNG.ts';

/** A livarot Shape of the WASM module: a wrap shape of flowed text. */
export interface WrapShape {
  hasEdges(): boolean;
  /** [left, top, right, bottom]. */
  bbox(): number[];
  /** Free the WASM object. */
  delete(): void;
}

/** The upstream ShapeScanlineMaker of the WASM module, on a WrapShape. */
export interface ShapeScanlineMakerBackend {
  /** [y, x_start, x_end, ...] of the scan runs. */
  makeScanline(ascent: number, descent: number): number[];
  completeLine(): void;
  yCoordinate(): number;
  setNewYCoordinate(y: number): void;
  canExtendCurrentScanline(ascent: number, descent: number): boolean;
  setLineHeight(ascent: number, descent: number): void;
  delete(): void;
}

/** The livarot Path of a textPath (upstream SPTextPath::originalPath). */
export interface TextPathBackend {
  empty(): boolean;
  closed(): boolean;
  length(): number;
  /** [piece, t] of a curvilinear position, [] if it is not on the path. */
  position(offset: number): number[];
  lastPiece(): number;
  /** [x, y, tangent x, tangent y]. */
  pointAndTangentAt(piece: number, t: number): number[];
  /** [x, y]. */
  pointAt(piece: number, t: number): number[];
  /** Whether no subpath starts between the pieces. */
  onSameSubpath(start_piece: number, end_piece: number): boolean;
  /** The curvilinear position nearest to a point. */
  nearestLength(x: number, y: number): number;
  delete(): void;
}

/**
 * The livarot operations of text layout, from the geom module of
 * @inkscape-web/wasm: wrap shapes for shape-inside, shape-subtract and
 * flowRegion, the scanline maker on them, and the path of a textPath.
 * Path data is in the coordinates of the item, transform maps it to the text.
 */
export interface TextLayoutBackend {
  /** Upstream SPText::makeInclusionShape(); padding < 0: none. */
  inclusionShape(d: string, transform: Affine, padding: number): WrapShape;
  /** One shape of upstream SPText::getExclusionShape(); margin < 0: none. */
  exclusionShape(d: string, transform: Affine, margin: number): WrapShape;
  /** Upstream extract_shape() of sp-flowregion.cpp. */
  regionShape(d: string, transform: Affine, evenodd: boolean): WrapShape;
  /** The rectangle of 'inline-size'. */
  rectShape(x0: number, y0: number, x1: number, y1: number): WrapShape;
  /** Shape::Booleen (0 union, 1 intersection, 2 difference) as a new shape. */
  booleen(a: WrapShape, b: WrapShape, op: number): WrapShape;
  /** Shape::Copy as a new shape. */
  copyShape(a: WrapShape): WrapShape;
  scanlineMaker(shape: WrapShape, block_progression: Direction): ShapeScanlineMakerBackend;
  textPath(d: string, transform: Affine): TextPathBackend;
}

let backend: TextLayoutBackend | null = null;

/** Set the livarot operations of text layout (flowed text and text on path need them). */
export function setTextLayoutBackend(b: TextLayoutBackend | null): void {
  backend = b;
}

export function getTextLayoutBackend(): TextLayoutBackend | null {
  return backend;
}

/** A region where a line of text can be put (upstream ScanlineMaker::ScanRun). */
export interface ScanRun {
  /** That's the top of the scan run, not the baseline. */
  y: number;
  /** These are not flipped according to the text direction. */
  x_start: number;
  x_end: number;
}

export function scanRunWidth(run: ScanRun): number {
  return Math.abs(run.x_start - run.x_end);
}

/**
 * Finds where the lines of text go (upstream Layout::ScanlineMaker).
 * Coordinates are rotated by the block progression.
 */
export interface ScanlineMaker {
  /**
   * The regions where a line of the given height fits (more than one if the
   * shape has holes). Empty when there is no space left in the shape.
   */
  makeScanline(line_height: FontMetrics): ScanRun[];
  /** The line is finished: the next call to makeScanline() returns the next line. */
  completeLine(): void;
  /** The y coordinate of the top of the scanline that will be returned next. */
  yCoordinate(): number;
  setNewYCoordinate(new_y: number): void;
  /** Whether a larger line height fits into the space of the previous makeScanline(). */
  canExtendCurrentScanline(line_height: FontMetrics): boolean;
  /** Set the actually used line height. */
  setLineHeight(line_height: FontMetrics): void;
  /** Free the WASM objects. */
  dispose(): void;
}

/**
 * A 'fake' scanline maker which will always return infinite results,
 * effectively turning off wrapping (upstream InfiniteScanlineMaker).
 */
export class InfiniteScanlineMaker implements ScanlineMaker {
  #x: number;
  #y: number;
  #current_line_height_em = 0;
  readonly #negative_block_progression: boolean;

  constructor(initial_x: number, initial_y: number, block_progression: Direction) {
    switch (block_progression) {
      case Direction.LEFT_TO_RIGHT:
      case Direction.RIGHT_TO_LEFT:
        this.#x = initial_y;
        this.#y = initial_x;
        break;
      default:
        this.#x = initial_x;
        this.#y = initial_y;
        break;
    }
    this.#negative_block_progression =
      block_progression === Direction.RIGHT_TO_LEFT || block_progression === Direction.BOTTOM_TO_TOP;
  }

  makeScanline(line_height: FontMetrics): ScanRun[] {
    this.#current_line_height_em = line_height.emSize();
    // we could use DBL_MAX, but this just seems safer
    return [{ x_start: this.#x, x_end: 3.4028234663852886e38, y: this.#y }];
  }

  completeLine(): void {
    if (this.#negative_block_progression) this.#y -= this.#current_line_height_em;
    else this.#y += this.#current_line_height_em;
    this.#current_line_height_em = 0;
  }

  yCoordinate(): number {
    return this.#y;
  }

  setNewYCoordinate(new_y: number): void {
    this.#y = new_y;
  }

  canExtendCurrentScanline(line_height: FontMetrics): boolean {
    this.#current_line_height_em = line_height.emSize();
    return true;
  }

  setLineHeight(line_height: FontMetrics): void {
    this.#current_line_height_em = line_height.emSize();
  }

  dispose(): void {}
}

/**
 * The exact implementation of a ScanlineMaker for any shape (upstream
 * ShapeScanlineMaker): the livarot rasterizer of the WASM module.
 */
export class ShapeScanlineMaker implements ScanlineMaker {
  readonly #maker: ShapeScanlineMakerBackend;

  constructor(shape: WrapShape, block_progression: Direction) {
    if (!backend) throw new Error('ShapeScanlineMaker: no text layout backend');
    this.#maker = backend.scanlineMaker(shape, block_progression);
  }

  makeScanline(line_height: FontMetrics): ScanRun[] {
    const runs = this.#maker.makeScanline(line_height.ascent, line_height.descent);
    const result: ScanRun[] = [];
    for (let i = 0; i + 2 < runs.length; i += 3) {
      result.push({ y: runs[i]!, x_start: runs[i + 1]!, x_end: runs[i + 2]! });
    }
    return result;
  }

  completeLine(): void {
    this.#maker.completeLine();
  }

  yCoordinate(): number {
    return this.#maker.yCoordinate();
  }

  setNewYCoordinate(new_y: number): void {
    this.#maker.setNewYCoordinate(new_y);
  }

  canExtendCurrentScanline(line_height: FontMetrics): boolean {
    return this.#maker.canExtendCurrentScanline(line_height.ascent, line_height.descent);
  }

  setLineHeight(line_height: FontMetrics): void {
    this.#maker.setLineHeight(line_height.ascent, line_height.descent);
  }

  dispose(): void {
    this.#maker.delete();
  }
}
