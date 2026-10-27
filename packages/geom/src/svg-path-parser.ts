// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/svg-path-parser.h, src/3rdparty/2geom/src/2geom/svg-path-parser.rl
/**
 * parse SVG path specifications
 *
 * Copyright 2007 MenTaLguY <mental@rydia.net>
 * Copyright 2007 Aaron Spike <aaron@ekips.org>
 */

import { CubicBezier, LineSegment, QuadraticBezier } from './bezier-curve.ts';
import { are_near, type Coord } from './coord.ts';
import type { Curve } from './curve.ts';
import { EllipticalArc } from './elliptical-arc.ts';
import { PathBuilder, type PathSink } from './path-sink.ts';
import type { PathVector } from './pathvector.ts';
import { Point } from './point.ts';
import { rad_from_deg } from './transforms.ts';

/**
 * Thrown for malformed path data. `partial` has the paths read before the error, as upstream
 * Inkscape's `sp_svg_read_pathv()` keeps them (the curve before the error is not part of it).
 */
export class SVGPathParseError extends Error {
  /** Paths read before the error. */
  partial: PathVector = [];
  /** Position of the first character that does not fit the grammar. */
  readonly offset: number;

  constructor(offset: number) {
    super(`Malformed SVG path data at offset ${offset}`);
    this.name = 'SVGPathParseError';
    this.offset = offset;
  }
}

/** Number of arguments of each command (the command letter in upper case). */
const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 };

const isWsp = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isNumberStart = (c: string | undefined): boolean => isDigit(c) || c === '.' || c === '+' || c === '-';
const isCommand = (c: string | undefined): boolean => c !== undefined && 'MmZzLlHhVvCcSsQqTtAa'.includes(c);

/**
 * Parser for SVG path data. It calls the commands of a PathSink with absolute coordinates.
 * Behaves like the upstream parser, including its grammar (flags of arcs need no separators)
 * and its error handling: it stops at the first error and throws SVGPathParseError. Only
 * curves that are complete and followed by more input are passed to the sink.
 */
export class SVGPathParser {
  readonly #sink: PathSink;
  #zSnapThreshold = 0;

  #absolute = false;
  #movetoWasAbsolute = false;
  #current = new Point(0, 0);
  #initial = new Point(0, 0);
  #cubicTangent = new Point(0, 0);
  #quadTangent = new Point(0, 0);
  /** The last curve; held back so that a following `z` can still adjust it. */
  #curve: Curve | null = null;

  #s = '';
  #i = 0;

  constructor(sink: PathSink) {
    this.#sink = sink;
  }

  /**
   * When `z` closes a subpath whose current point is closer to the initial point than this
   * threshold and was reached by a relative command, the last segment is adjusted to end exactly
   * at the initial point. Default 0.
   */
  setZSnapThreshold(threshold: Coord): void {
    this.#zSnapThreshold = threshold;
  }

  zSnapThreshold(): Coord {
    return this.#zSnapThreshold;
  }

  /**
   * Parse a complete path data string. The sink is flushed at the end.
   * @throws SVGPathParseError (the sink is not flushed then)
   */
  parse(str: string): void {
    this.#reset();
    this.#s = str;
    this.#run();
    this.#pushCurve(null);
    this.#sink.flush();
    this.#reset();
  }

  #reset(): void {
    this.#absolute = false;
    this.#current = this.#initial = new Point(0, 0);
    this.#quadTangent = this.#cubicTangent = new Point(0, 0);
    this.#curve = null;
    this.#s = '';
    this.#i = 0;
  }

  // --- Grammar. Actions run when the grammar rule they belong to is complete and the next
  // --- character may follow it, like Ragel's leaving actions.

  #fail(): never {
    throw new SVGPathParseError(this.#i);
  }

  #peek(): string | undefined {
    return this.#s[this.#i];
  }

  #skipWsp(): void {
    while (isWsp(this.#peek())) this.#i++;
  }

  /** comma_wsp: white space and at most one comma. With `required` at least one of them. */
  #skipCommaWsp(required: boolean): void {
    const start = this.#i;
    this.#skipWsp();
    if (this.#peek() === ',') {
      this.#i++;
      this.#skipWsp();
    }
    if (required && this.#i === start) this.#fail();
  }

  /** Scan [sign] digits [. digits] [exponent]. */
  #number(): number {
    const s = this.#s;
    const start = this.#i;
    if (s[this.#i] === '+' || s[this.#i] === '-') this.#i++;
    const intStart = this.#i;
    while (isDigit(s[this.#i])) this.#i++;
    const intDigits = this.#i - intStart;
    let fracDigits = 0;
    if (s[this.#i] === '.') {
      this.#i++;
      const fracStart = this.#i;
      while (isDigit(s[this.#i])) this.#i++;
      fracDigits = this.#i - fracStart;
    }
    if (intDigits === 0 && fracDigits === 0) this.#fail();
    if (s[this.#i] === 'e' || s[this.#i] === 'E') {
      this.#i++;
      if (s[this.#i] === '+' || s[this.#i] === '-') this.#i++;
      if (!isDigit(s[this.#i])) this.#fail();
      while (isDigit(s[this.#i])) this.#i++;
    }
    return Number(s.slice(start, this.#i));
  }

  #flag(): number {
    const c = this.#peek();
    if (c !== '0' && c !== '1') this.#fail();
    this.#i++;
    return c === '1' ? 1 : 0;
  }

  /** The arguments of one command repetition. */
  #args(arity: number, isArc: boolean): number[] {
    const v: number[] = [];
    if (isArc) {
      // rx ry rotation, then two flags (no separator needed), then x y. The flags must be
      // separated from the rotation.
      v.push(this.#number());
      this.#skipCommaWsp(false);
      v.push(this.#number());
      this.#skipCommaWsp(false);
      v.push(this.#number());
      this.#skipCommaWsp(true);
      v.push(this.#flag());
      this.#skipCommaWsp(false);
      v.push(this.#flag());
      this.#skipCommaWsp(false);
      v.push(this.#number());
      this.#skipCommaWsp(false);
      v.push(this.#number());
      return v;
    }
    for (let k = 0; k < arity; k++) {
      if (k > 0) this.#skipCommaWsp(false);
      v.push(this.#number());
    }
    return v;
  }

  /** The next character must be able to follow a complete argument group. */
  #checkAfterArgs(): void {
    const c = this.#peek();
    if (c !== undefined && !isWsp(c) && c !== ',' && !isNumberStart(c) && !isCommand(c)) this.#fail();
  }

  #run(): void {
    this.#skipWsp();
    let first = true;
    while (this.#i < this.#s.length) {
      const cmd = this.#s[this.#i] as string;
      if (!isCommand(cmd) || (first && cmd !== 'M' && cmd !== 'm')) this.#fail();
      first = false;
      this.#i++;
      this.#absolute = cmd === cmd.toUpperCase();
      const up = cmd.toUpperCase();

      if (up === 'Z') {
        const c = this.#peek();
        if (c !== undefined && !isWsp(c) && !isCommand(c)) this.#fail();
        this.#closePath();
      } else {
        this.#skipWsp();
        let isFirstGroup = true;
        for (;;) {
          const args = this.#args(ARITY[up] as number, up === 'A');
          this.#checkAfterArgs();
          // After a moveto, further coordinate pairs are linetos.
          this.#command(isFirstGroup ? up : up === 'M' ? 'L' : up, args);
          isFirstGroup = false;

          this.#skipWsp();
          if (this.#peek() === ',') {
            this.#i++;
            this.#skipWsp();
            if (!isNumberStart(this.#peek())) this.#fail();
          } else if (!isNumberStart(this.#peek())) {
            break;
          }
        }
      }
      this.#skipWsp();
    }
  }

  #pt(x: number, y: number): Point {
    return this.#absolute ? new Point(x, y) : new Point(x + this.#current.x, y + this.#current.y);
  }

  #command(cmd: string, a: number[]): void {
    const n = (i: number) => a[i] as number;
    switch (cmd) {
      case 'M':
        this.#movetoWasAbsolute = this.#absolute;
        this.#moveTo(this.#pt(n(0), n(1)));
        break;
      case 'L':
        this.#lineTo(this.#pt(n(0), n(1)));
        break;
      case 'H':
        this.#lineTo(new Point(this.#absolute ? n(0) : n(0) + this.#current.x, this.#current.y));
        break;
      case 'V':
        this.#lineTo(new Point(this.#current.x, this.#absolute ? n(0) : n(0) + this.#current.y));
        break;
      case 'C':
        this.#curveTo(this.#pt(n(0), n(1)), this.#pt(n(2), n(3)), this.#pt(n(4), n(5)));
        break;
      case 'S':
        this.#curveTo(this.#cubicTangent, this.#pt(n(0), n(1)), this.#pt(n(2), n(3)));
        break;
      case 'Q':
        this.#quadTo(this.#pt(n(0), n(1)), this.#pt(n(2), n(3)));
        break;
      case 'T':
        this.#quadTo(this.#quadTangent, this.#pt(n(0), n(1)));
        break;
      case 'A':
        this.#arcTo(n(0), n(1), rad_from_deg(n(2)), n(3) !== 0, n(4) !== 0, this.#pt(n(5), n(6)));
        break;
    }
  }

  // --- Actions

  #moveTo(p: Point): void {
    this.#pushCurve(null); // flush
    this.#sink.moveTo(p);
    this.#quadTangent = this.#cubicTangent = this.#current = this.#initial = p;
  }

  #lineTo(p: Point): void {
    this.#pushCurve(new LineSegment(this.#current, p));
    this.#quadTangent = this.#cubicTangent = this.#current = p;
  }

  #curveTo(c0: Point, c1: Point, p: Point): void {
    this.#pushCurve(new CubicBezier(this.#current, c0, c1, p));
    this.#quadTangent = this.#current = p;
    this.#cubicTangent = p.add(p.sub(c1));
  }

  #quadTo(c: Point, p: Point): void {
    this.#pushCurve(new QuadraticBezier(this.#current, c, p));
    this.#cubicTangent = this.#current = p;
    this.#quadTangent = p.add(p.sub(c));
  }

  #arcTo(rx: Coord, ry: Coord, angle: Coord, largeArc: boolean, sweep: boolean, p: Point): void {
    // Ignore invalid (ambiguous) arc segments where start and end point are the same (per SVG spec).
    if (this.#current.equals(p)) return;
    this.#pushCurve(new EllipticalArc(this.#current, Math.abs(rx), Math.abs(ry), angle, largeArc, sweep, p));
    this.#quadTangent = this.#cubicTangent = this.#current = p;
  }

  #closePath(): void {
    if (
      this.#curve &&
      (!this.#absolute || !this.#movetoWasAbsolute) &&
      are_near(this.#initial, this.#current, this.#zSnapThreshold)
    ) {
      this.#curve = this.#curve.withFinal(this.#initial);
    }
    this.#pushCurve(null); // flush
    this.#sink.closePath();
    this.#quadTangent = this.#cubicTangent = this.#current = this.#initial;
  }

  #pushCurve(c: Curve | null): void {
    if (this.#curve) this.#sink.feedCurve(this.#curve, false);
    this.#curve = c;
  }
}

/**
 * Parse SVG path data into a PathVector.
 * @throws SVGPathParseError for malformed data; its `partial` has the paths read before the error
 */
export function parse_svg_path(str: string, options: { zSnapThreshold?: number } = {}): PathVector {
  const pv: PathVector = [];
  const builder = new PathBuilder(pv);
  const parser = new SVGPathParser(builder);
  parser.setZSnapThreshold(options.zSnapThreshold ?? 0);
  try {
    parser.parse(str);
  } catch (e) {
    if (e instanceof SVGPathParseError) {
      builder.flush();
      e.partial = pv;
    }
    throw e;
  }
  return pv;
}
