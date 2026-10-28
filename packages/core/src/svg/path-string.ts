// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/path-string.cpp, src/svg/path-string.h
/** @file
 * Inkscape::SVG::PathString - builder for SVG path strings
 */ /*
 * Authors: see git history
 *
 * Copyright 2007 MenTaLguY <mental@rydia.net>
 * Copyright 2008 Jasper van de Gronde <th.v.d.gronde@hccnet.nl>
 * Copyright 2013 Tavmjong Bah <tavmjong@free.fr>
 * Copyright (C) 2018 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Point } from '@inkscape-web/geom';
import { Preferences } from '../preferences.ts';
import { DEFAULT_MINIMUM_EXPONENT, DEFAULT_NUMERIC_PRECISION } from './stringstream.ts';
import { spSvgNumberReadD, spSvgNumberWriteDe } from './svg-length.ts';

/** Relative vs. absolute coordinates. Values of the preference /options/svgoutput/pathstring_format. */
export enum PATHSTRING_FORMAT {
  /** Use only absolute coordinates */
  PATHSTRING_ABSOLUTE,
  /** Use only relative coordinates */
  PATHSTRING_RELATIVE,
  /** Optimize for path string length */
  PATHSTRING_OPTIMIZE,
}

/**
 * Settings of a PathString. The defaults are those of the preferences skeleton
 * (/options/svgoutput/...).
 */
export interface PathStringOptions {
  /** pathstring_format, default PATHSTRING_OPTIMIZE */
  format?: PATHSTRING_FORMAT;
  /** numericprecision (significant digits, 1 to 16), default 10 */
  precision?: number;
  /** minimumexponent, default -8 */
  minexp?: number;
  /** forcerepeatcommands, default false */
  forceRepeatCommands?: boolean;
}

/** The two representations that PathString builds in parallel. Upstream: PathString::State */
class State {
  str = '';
  switches = 0;
  prevop = '';
  currentX = 0;
  currentY = 0;
  initialX = 0;
  initialY = 0;

  constructor(
    readonly precision: number,
    readonly minexp: number,
  ) {}

  clone(): State {
    const s = new State(this.precision, this.minexp);
    s.str = this.str;
    s.switches = this.switches;
    s.prevop = this.prevop;
    s.currentX = this.currentX;
    s.currentY = this.currentY;
    s.initialX = this.initialX;
    s.initialY = this.initialY;
    return s;
  }

  appendOp(op: string): void {
    if (this.prevop !== '') this.str += ' ';
    this.str += op;
    this.prevop = op === 'M' ? 'L' : op === 'm' ? 'l' : op;
  }

  appendFlag(flag: boolean): void {
    this.str += flag ? ' 1' : ' 0';
  }

  /** Append a value that is written as is (radii, rotation). */
  appendValue(v: number): void {
    this.str += ` ${this.#number(v, this.precision, this.minexp)}`;
  }

  appendPointValue(p: Point): void {
    this.str += ` ${this.#number(p.x, this.precision, this.minexp)},${this.#number(p.y, this.precision, this.minexp)}`;
  }

  /** Append an absolute coordinate; returns the rounded value that was written. */
  appendCoord(v: number, dim: 'x' | 'y', setCurrent: boolean): number {
    this.str += ' ';
    const rv = this.#roundTrip(v, this.precision, this.minexp);
    if (setCurrent) {
      if (dim === 'x') this.currentX = rv;
      else this.currentY = rv;
    }
    return rv;
  }

  /** Append an absolute point; returns the rounded values that were written. */
  appendPoint(p: Point, setCurrent: boolean): Point {
    this.str += ' ';
    const rx = this.#roundTrip(p.x, this.precision, this.minexp);
    this.str += ',';
    const ry = this.#roundTrip(p.y, this.precision, this.minexp);
    if (setCurrent) {
      this.currentX = rx;
      this.currentY = ry;
    }
    return new Point(rx, ry);
  }

  appendRelative(v: number, dim: 'x' | 'y', setCurrent: boolean): void {
    this.str += ' ';
    this.#appendRelativeCoord(v, dim, setCurrent);
  }

  appendRelativePoint(p: Point, setCurrent: boolean): void {
    this.str += ' ';
    this.#appendRelativeCoord(p.x, 'x', setCurrent);
    this.str += ',';
    this.#appendRelativeCoord(p.y, 'y', setCurrent);
  }

  closePath(): void {
    this.currentX = this.initialX;
    this.currentY = this.initialY;
  }

  setInitialPoint(): void {
    this.initialX = this.currentX;
    this.initialY = this.currentY;
  }

  /** Upstream: State::operator<= (shorter string wins, then fewer switches) */
  lessOrEqual(s: State): boolean {
    if (this.str.length < s.str.length) return true;
    if (this.str.length > s.str.length) return false;
    return this.switches <= s.switches;
  }

  #number(v: number, precision: number, minexp: number): string {
    return spSvgNumberWriteDe(v, precision, minexp);
  }

  /** Append the number and return what a reader gets back from the written text. */
  #roundTrip(v: number, precision: number, minexp: number): number {
    const s = this.#number(v, precision, minexp);
    this.str += s;
    return spSvgNumberReadD(s) as number;
  }

  // NOTE: The following function will not be exact if the total number of digits needed
  // to represent the difference exceeds the precision of a double. This is not very likely though, and if
  // it does happen the imprecise value is not likely to be chosen (because it will probably be a lot longer
  // than the absolute value).

  // NOTE: This assumes v and r are already rounded (this includes flushing to zero if they are < 10^minexp)
  #appendRelativeCoord(v: number, dim: 'x' | 'y', setCurrent: boolean): void {
    const r = dim === 'x' ? this.currentX : this.currentY;

    const minexp = this.minexp - this.precision + 1;
    // Position just beyond the last significant digit of the smallest (in absolute sense) number
    const digitsEnd = Math.floor(Math.log10(Math.min(Math.abs(v), Math.abs(r)))) - this.precision;
    const roundeddiff = Math.floor((v - r) * 10 ** (-digitsEnd - 1) + 0.5);
    // Number of digits in roundeddiff
    const numDigits = Math.floor(Math.log10(Math.abs(roundeddiff))) + 1;

    let diff = 0;
    if (r === 0 || v === 0) {
      diff = this.#roundTrip(v - r, this.precision, minexp);
    } else if (numDigits > 0) {
      diff = this.#roundTrip(v - r, numDigits, minexp);
    } else {
      // This assumes the input numbers are already rounded to 'precision' digits
      this.str += '0';
    }
    if (setCurrent) {
      if (dim === 'x') this.currentX += diff;
      else this.currentY += diff;
    }
  }
}

/**
 * Builder for SVG path strings. Keeps an absolute and a relative version of the path and, in
 * PATHSTRING_OPTIMIZE format, writes the shorter one (switching between them where that pays off).
 */
export class PathString {
  #absState: State;
  #relState: State;
  readonly #format: PATHSTRING_FORMAT;
  readonly #forceRepeatCommands: boolean;
  // If both states have a common prefix it is stored here.
  // Separating out the common prefix prevents repeated copying between the states
  // to cause a quadratic time complexity (in the number of characters/operators)
  #commonbase = '';

  /** Options that are not given come from the preferences /options/svgoutput/... (upstream does the same). */
  constructor(options: PathStringOptions = {}) {
    const prefs = Preferences.get();
    const precision =
      options.precision ??
      Math.min(
        Math.max(prefs.getInt('/options/svgoutput/numericprecision', DEFAULT_NUMERIC_PRECISION), 1),
        16,
      );
    const minexp =
      options.minexp ?? prefs.getInt('/options/svgoutput/minimumexponent', DEFAULT_MINIMUM_EXPONENT);
    this.#format =
      options.format ??
      prefs.getInt('/options/svgoutput/pathstring_format', PATHSTRING_FORMAT.PATHSTRING_OPTIMIZE);
    this.#forceRepeatCommands =
      options.forceRepeatCommands ?? prefs.getBool('/options/svgoutput/forcerepeatcommands', false);
    this.#absState = new State(precision, minexp);
    this.#relState = new State(precision, minexp);
  }

  /** The path data written so far. */
  string(): string {
    return this.#commonbase + this.#tail();
  }

  toString(): string {
    return this.string();
  }

  moveTo(p: Point): this;
  moveTo(x: number, y: number): this;
  moveTo(x: Point | number, y?: number): this {
    this.#appendOp('M', 'm');
    this.#appendPoint(toPoint(x, y), true);
    this.#relState.setInitialPoint();
    this.#absState.setInitialPoint();
    return this;
  }

  lineTo(p: Point): this;
  lineTo(x: number, y: number): this;
  lineTo(x: Point | number, y?: number): this {
    this.#appendOp('L', 'l');
    this.#appendPoint(toPoint(x, y), true);
    return this;
  }

  horizontalLineTo(x: number): this {
    this.#appendOp('H', 'h');
    this.#appendCoord(x, 'x');
    return this;
  }

  verticalLineTo(y: number): this {
    this.#appendOp('V', 'v');
    this.#appendCoord(y, 'y');
    return this;
  }

  quadTo(c: Point, p: Point): this;
  quadTo(cx: number, cy: number, x: number, y: number): this;
  quadTo(a: Point | number, b: Point | number, x?: number, y?: number): this {
    const [c, p] =
      typeof a === 'number' ? [toPoint(a, b as number), toPoint(x as number, y as number)] : [a, b as Point];
    this.#appendOp('Q', 'q');
    this.#appendPoint(c, false);
    this.#appendPoint(p, true);
    return this;
  }

  curveTo(c0: Point, c1: Point, p: Point): this;
  curveTo(x0: number, y0: number, x1: number, y1: number, x: number, y: number): this;
  curveTo(...args: [Point, Point, Point] | [number, number, number, number, number, number]): this {
    const [c0, c1, p] =
      typeof args[0] === 'number'
        ? [
            toPoint(args[0], args[1] as number),
            toPoint(args[2] as number, args[3] as number),
            toPoint(args[4] as number, args[5] as number),
          ]
        : (args as [Point, Point, Point]);
    this.#appendOp('C', 'c');
    this.#appendPoint(c0, false);
    this.#appendPoint(c1, false);
    this.#appendPoint(p, true);
    return this;
  }

  /** @param rot the angle in degrees */
  arcTo(rx: number, ry: number, rot: number, largeArc: boolean, sweep: boolean, p: Point): this {
    this.#appendOp('A', 'a');
    this.#absState.appendPointValue(new Point(rx, ry));
    this.#relState.appendPointValue(new Point(rx, ry));
    this.#absState.appendValue(rot);
    this.#relState.appendValue(rot);
    for (const flag of [largeArc, sweep]) {
      this.#absState.appendFlag(flag);
      this.#relState.appendFlag(flag);
    }
    this.#appendPoint(p, true);
    return this;
  }

  closePath(): this {
    this.#absState.appendOp('Z');
    this.#relState.appendOp('z');
    this.#absState.closePath();
    this.#relState.closePath();
    return this;
  }

  #tail(): string {
    return this.#format === PATHSTRING_FORMAT.PATHSTRING_ABSOLUTE ||
      (this.#format === PATHSTRING_FORMAT.PATHSTRING_OPTIMIZE && this.#absState.lessOrEqual(this.#relState))
      ? this.#absState.str
      : this.#relState.str;
  }

  // For absolute and relative paths... the entire path is kept in the "tail".
  // For optimized path, at a switch between absolute and relative, add tail to commonbase.
  #appendOp(absOp: string, relOp: string): void {
    let absOpRepeated = this.#absState.prevop === absOp && !this.#forceRepeatCommands;
    let relOpRepeated = this.#relState.prevop === relOp && !this.#forceRepeatCommands;

    switch (this.#format) {
      case PATHSTRING_FORMAT.PATHSTRING_ABSOLUTE:
        if (!absOpRepeated) this.#absState.appendOp(absOp);
        break;
      case PATHSTRING_FORMAT.PATHSTRING_RELATIVE:
        if (!relOpRepeated) this.#relState.appendOp(relOp);
        break;
      case PATHSTRING_FORMAT.PATHSTRING_OPTIMIZE: {
        const absAddedSize = absOpRepeated ? 0 : 2;
        const relAddedSize = relOpRepeated ? 0 : 2;
        if (this.#relState.str.length + 2 < this.#absState.str.length + absAddedSize) {
          // Store common prefix
          this.#commonbase += this.#relState.str;
          this.#relState.str = '';
          // Copy rel to abs
          this.#absState = this.#relState.clone();
          this.#absState.switches++;
          absOpRepeated = false;
          // We do not have to copy abs to rel (see upstream comment)
        } else if (this.#absState.str.length + 2 < this.#relState.str.length + relAddedSize) {
          // Store common prefix
          this.#commonbase += this.#absState.str;
          this.#absState.str = '';
          // Copy abs to rel
          this.#relState = this.#absState.clone();
          this.#absState.switches++;
          relOpRepeated = false;
        }
        if (!absOpRepeated) this.#absState.appendOp(absOp);
        if (!relOpRepeated) this.#relState.appendOp(relOp);
        break;
      }
    }
  }

  #appendCoord(v: number, dim: 'x' | 'y'): void {
    const rv = this.#absState.appendCoord(v, dim, true);
    this.#relState.appendRelative(rv, dim, true);
  }

  #appendPoint(p: Point, setCurrent: boolean): void {
    const rp = this.#absState.appendPoint(p, setCurrent);
    this.#relState.appendRelativePoint(rp, setCurrent);
  }
}

function toPoint(x: Point | number, y?: number): Point {
  return typeof x === 'number' ? new Point(x, y as number) : x;
}
