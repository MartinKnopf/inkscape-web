// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/svg-path-writer.h, src/3rdparty/2geom/src/2geom/svg-path-writer.cpp
/*
 * Path sink which writes an SVG-compatible command string
 *
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2014 Authors
 */
import { are_near, type Coord, format_coord_shortest } from './coord.ts';
import { PathSink } from './path-sink.ts';
import type { PathVector } from './pathvector.ts';
import { Point } from './point.ts';
import { deg_from_rad } from './transforms.ts';

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

/**
 * Format like C++ `std::ostream << double` with `setprecision(precision)` and the default float
 * format, which is printf("%.*g"). The value is rounded half to even on its exact binary value.
 */
function formatG(x: number, precision: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  const p = Math.max(precision, 1);
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const sign = x < 0 ? '-' : '';

  let { digits, exp10 } = exactDecimal(Math.abs(x));
  if (digits.length > p) {
    const head = BigInt(digits.slice(0, p));
    const rest = digits.slice(p);
    const first = rest.charCodeAt(0) - 48;
    const roundUp = first > 5 || (first === 5 && (/[1-9]/.test(rest.slice(1)) || (head & 1n) === 1n));
    const rounded = (roundUp ? head + 1n : head).toString();
    if (rounded.length > p) exp10 += 1; // carry: 99.9 -> 100
    digits = rounded.slice(0, p);
  }
  // Trailing zeros are removed (no showpoint).
  digits = digits.replace(/0+$/, '') || '0';

  if (exp10 < -4 || exp10 >= p) {
    const frac = digits.length > 1 ? `.${digits.slice(1)}` : '';
    const e = Math.abs(exp10).toString().padStart(2, '0');
    return `${sign}${digits[0]}${frac}e${exp10 < 0 ? '-' : '+'}${e}`;
  }
  if (exp10 < 0) return `${sign}0.${'0'.repeat(-exp10 - 1)}${digits}`;
  if (digits.length <= exp10 + 1) return sign + digits + '0'.repeat(exp10 + 1 - digits.length);
  return `${sign}${digits.slice(0, exp10 + 1)}.${digits.slice(exp10 + 1)}`;
}

/** Exact decimal digits of a positive finite double and the decimal exponent of the first digit. */
function exactDecimal(x: number): { digits: string; exp10: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  let mantissa = bits & 0xfffffffffffffn;
  let e2: number;
  if (biased === 0) {
    e2 = -1074;
  } else {
    mantissa |= 1n << 52n;
    e2 = biased - 1075;
  }
  // x = mantissa * 2^e2. For e2 < 0: x = mantissa * 5^-e2 * 10^e2.
  let n: bigint;
  let e10: number;
  if (e2 >= 0) {
    n = mantissa << BigInt(e2);
    e10 = 0;
  } else {
    n = mantissa * 5n ** BigInt(-e2);
    e10 = e2;
  }
  const digits = n.toString();
  return { digits, exp10: digits.length - 1 + e10 };
}

/**
 * PathSink that writes SVG path data. Use write_svg_path() for a one-call version.
 *
 * The output uses absolute commands. With shorthands on it uses H, V, S and T where possible.
 */
export class SVGPathWriter extends PathSink {
  #s = '';
  #currentPars: Coord[] = [];
  #subpathStart = new Point(0, 0);
  #current = new Point(0, 0);
  #quadTangent = new Point(0, 0);
  #cubicTangent = new Point(0, 0);
  #epsilon = 0;
  #precision = -1;
  #optimize = false;
  #useShorthands = true;
  #command = '';

  /**
   * Set the output precision (significant digits). A negative value writes every number
   * exactly (the shortest string that reads back as the same number).
   */
  setPrecision(prec: number): void {
    this.#precision = prec;
    this.#epsilon = prec < 0 ? 0 : Number(`1e-${prec}`);
  }

  /**
   * With optimize the data is as short as possible: no spaces where they are not needed, and
   * the command letter is not repeated for consecutive moves or lines. Otherwise the data is
   * easier to read: commands and numbers are separated by spaces.
   */
  setOptimize(opt: boolean): void {
    this.#optimize = opt;
  }

  /** Allow H, V, T and S where possible. On by default. */
  setUseShorthands(use: boolean): void {
    this.#useShorthands = use;
  }

  /** The path data written so far. */
  str(): string {
    return this.#s;
  }

  /** Forget the data written so far. */
  clear(): void {
    this.#s = '';
    this.#command = '';
    this.#currentPars = [];
    this.#current = new Point(0, 0);
    this.#subpathStart = new Point(0, 0);
  }

  moveTo(p: Point): void {
    this.#setCommand('M');
    this.#currentPars.push(p.x, p.y);
    this.#current = this.#subpathStart = this.#quadTangent = this.#cubicTangent = p;
    if (!this.#optimize) this.flush();
  }

  lineTo(p: Point): void {
    // The weird setting of #current avoids drift with many almost-aligned segments.
    // The additional conditions ensure that the smaller dimension is rounded to zero.
    let written = false;
    if (this.#useShorthands) {
      const r = this.#current.sub(p);
      if (are_near(p.x, this.#current.x, this.#epsilon) && Math.abs(r.x) < Math.abs(r.y)) {
        this.#setCommand('V');
        this.#currentPars.push(p.y);
        this.#current = new Point(this.#current.x, p.y);
        written = true;
      } else if (are_near(p.y, this.#current.y, this.#epsilon) && Math.abs(r.y) < Math.abs(r.x)) {
        this.#setCommand('H');
        this.#currentPars.push(p.x);
        this.#current = new Point(p.x, this.#current.y);
        written = true;
      }
    }

    if (!written) {
      if (this.#command !== 'M' && this.#command !== 'L') this.#setCommand('L');
      this.#currentPars.push(p.x, p.y);
      this.#current = p;
    }

    this.#cubicTangent = this.#quadTangent = this.#current;
    if (!this.#optimize) this.flush();
  }

  quadTo(c: Point, p: Point): void {
    const shorthand = this.#useShorthands && are_near(c, this.#quadTangent, this.#epsilon);

    this.#setCommand(shorthand ? 'T' : 'Q');
    if (!shorthand) this.#currentPars.push(c.x, c.y);
    this.#currentPars.push(p.x, p.y);

    this.#current = this.#cubicTangent = p;
    this.#quadTangent = p.add(p.sub(c));
    if (!this.#optimize) this.flush();
  }

  curveTo(p1: Point, p2: Point, p3: Point): void {
    const shorthand = this.#useShorthands && are_near(p1, this.#cubicTangent, this.#epsilon);

    this.#setCommand(shorthand ? 'S' : 'C');
    if (!shorthand) this.#currentPars.push(p1.x, p1.y);
    this.#currentPars.push(p2.x, p2.y, p3.x, p3.y);

    this.#current = this.#quadTangent = p3;
    this.#cubicTangent = p3.add(p3.sub(p2));
    if (!this.#optimize) this.flush();
  }

  arcTo(rx: Coord, ry: Coord, angle: Coord, largeArc: boolean, sweep: boolean, p: Point): void {
    this.#setCommand('A');
    this.#currentPars.push(rx, ry, deg_from_rad(angle), largeArc ? 1 : 0, sweep ? 1 : 0, p.x, p.y);

    this.#current = this.#quadTangent = this.#cubicTangent = p;
    if (!this.#optimize) this.flush();
  }

  closePath(): void {
    this.flush();
    this.#s += this.#optimize ? 'z' : ' z';
    this.#current = this.#quadTangent = this.#cubicTangent = this.#subpathStart;
  }

  flush(): void {
    if (this.#command === '' || this.#currentPars.length === 0) return;

    if (this.#optimize) {
      this.#s += this.#command;
    } else {
      if (this.#s.length !== 0) this.#s += ' ';
      this.#s += this.#command;
    }

    let lastchar = this.#command;
    let containedDot = false;

    for (const par of this.#currentPars) {
      const cs = this.#formatCoord(par);

      // Separator handling logic.
      // Floating point values can end with a digit or dot
      // and start with a digit, a plus or minus sign, or a dot.
      // The following cases require a separator:
      // * digit-digit
      // * digit-dot (only if the previous number didn't contain a dot)
      // * dot-digit
      if (this.#optimize) {
        const firstchar = cs[0] as string;
        if (isDigit(lastchar)) {
          if (isDigit(firstchar)) {
            this.#s += ' ';
          } else if (firstchar === '.' && !containedDot) {
            this.#s += ' ';
          }
        } else if (lastchar === '.' && isDigit(firstchar)) {
          this.#s += ' ';
        }
        this.#s += cs;

        lastchar = cs[cs.length - 1] as string;
        containedDot = cs.includes('.');
      } else {
        this.#s += ` ${cs}`;
      }
    }
    this.#currentPars = [];
    this.#command = '';
  }

  #setCommand(cmd: string): void {
    if (this.#command !== '' && this.#command !== cmd) this.flush();
    this.#command = cmd;
  }

  #formatCoord(par: Coord): string {
    return this.#precision < 0 ? format_coord_shortest(par) : formatG(par, this.#precision);
  }
}

/**
 * SVG path data of a PathVector.
 * @param precision significant digits; negative writes exact numbers
 * @param optimize omit unneeded spaces and repeated command letters
 * @param shorthands use H, V, S and T where possible
 */
export function write_svg_path(pv: PathVector, precision = -1, optimize = false, shorthands = true): string {
  const writer = new SVGPathWriter();
  writer.setPrecision(precision);
  writer.setOptimize(optimize);
  writer.setUseShorthands(shorthands);
  writer.feedPathVector(pv);
  return writer.str();
}
