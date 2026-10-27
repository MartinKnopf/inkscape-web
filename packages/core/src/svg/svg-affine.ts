// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/svg-affine.cpp, src/svg/svg-affine-parser.rl
/*
 * SVG data parser
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Raph Levien <raph@acm.org>
 *   Marc Jeanmougin <marc.jeanmougin@telecom-paris.fr>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 1999 Raph Levien
 * Copyright (C) 2019 Marc Jeanmougin (.rl parser, CSS-transform spec)
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Affine, are_near, Rotate, Scale, Translate } from '@inkscape-web/geom';
import { DEFAULT_MINIMUM_EXPONENT, DEFAULT_NUMERIC_PRECISION } from './stringstream.ts';
import { spSvgNumberWriteDe } from './svg-length.ts';

// Number of the grammar: sign? (digits | digits? "." digits | digits ".") exponent?
const NUMBER_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

const isWsp = (c: string | undefined): boolean => c === ' ' || c === '\n' || c === '\r' || c === '\t';

/** Argument counts that the grammar accepts for each transform. */
const ARG_COUNTS: Readonly<Record<string, readonly number[]>> = {
  matrix: [6],
  translate: [1, 2],
  scale: [1, 2],
  rotate: [1, 3],
  skewX: [1],
  skewY: [1],
};

/** Reads the transform list of the CSS transforms grammar (hand-written version of the Ragel machine). */
class TransformReader {
  #pos = 0;
  constructor(private readonly str: string) {}

  #skipWsp(): void {
    while (isWsp(this.str[this.#pos])) this.#pos++;
  }

  #number(): number | null {
    NUMBER_RE.lastIndex = this.#pos;
    const m = NUMBER_RE.exec(this.str);
    if (!m) return null;
    this.#pos += m[0].length;
    return Number(m[0]);
  }

  /** `name wsp* "(" wsp* number (commawsp? number)* wsp* ")"`, null on error. */
  #transform(): Affine | null {
    const name = Object.keys(ARG_COUNTS).find((n) => this.str.startsWith(n, this.#pos));
    if (!name) return null;
    this.#pos += name.length;
    this.#skipWsp();
    if (this.str[this.#pos++] !== '(') return null;
    this.#skipWsp();

    const params: number[] = [];
    const first = this.#number();
    if (first === null) return null;
    params.push(first);
    for (;;) {
      this.#skipWsp();
      if (this.str[this.#pos] === ')') break;
      if (this.str[this.#pos] === ',') {
        this.#pos++;
        this.#skipWsp();
      }
      const n = this.#number();
      if (n === null) return null;
      params.push(n);
    }
    this.#pos++; // ")"
    if (!ARG_COUNTS[name]?.includes(params.length)) return null;

    const [p0, p1, p2] = params as [number, number, number];
    switch (name) {
      case 'translate':
        return Translate(p0, params.length === 1 ? 0 : p1);
      case 'scale':
        return Scale(p0, params.length === 1 ? p0 : p1);
      case 'rotate':
        if (params.length === 1) return Rotate.from_degrees(p0);
        return Translate(-p1, -p2).multiply(Rotate.from_degrees(p0)).multiply(Translate(p1, p2));
      case 'skewX':
        return new Affine(1, 0, Math.tan((p0 * Math.PI) / 180.0), 1, 0, 0);
      case 'skewY':
        return new Affine(1, Math.tan((p0 * Math.PI) / 180.0), 0, 1, 0, 0);
      default: // matrix
        return new Affine(p0, p1, p2, params[3] as number, params[4] as number, params[5] as number);
    }
  }

  /** `wsp* (transform (commawsp? transform)*)? wsp*` over the whole string, null on error. */
  read(): Affine | null {
    let result = new Affine();
    this.#skipWsp();
    if (this.#pos === this.str.length) return result;
    for (;;) {
      const t = this.#transform();
      if (!t) return null;
      result = t.multiply(result);
      this.#skipWsp();
      if (this.#pos === this.str.length) return result;
      if (this.str[this.#pos] === ',') {
        this.#pos++;
        this.#skipWsp();
      }
    }
  }
}

/**
 * Read a transform attribute (https://www.w3.org/TR/css-transforms-1/#svg-syntax).
 * An empty string gives the identity; null is returned (with a warning) on a parse error.
 * Upstream: sp_svg_transform_read
 */
export function sp_svg_transform_read(str: string): Affine | null {
  const result = new TransformReader(str).read();
  if (!result) console.warn('could not parse transform attribute');
  return result;
}

/**
 * Write a transform attribute in the shortest form: scale, translate, rotate, rotate about a point,
 * skewX, skewY or matrix. The identity gives an empty string.
 * Upstream: sp_svg_transform_write
 */
export function sp_svg_transform_write(
  transform: Affine,
  precision: number = DEFAULT_NUMERIC_PRECISION,
  minimumExponent: number = DEFAULT_MINIMUM_EXPONENT,
): string {
  // this must be a bit grater than EPSILON
  const e = 1e-5 * transform.descrim();
  const w = (v: number): string => spSvgNumberWriteDe(v, precision, minimumExponent);
  const m = transform;

  // Special case: when all fields of the affine are zero,
  // the optimized transformation is scale(0)
  if (m.c0 === 0 && m.c1 === 0 && m.c2 === 0 && m.c3 === 0 && m.c4 === 0 && m.c5 === 0) {
    return 'scale(0)';
  }

  if (m.isIdentity()) {
    // We are more or less identity, so no transform attribute needed:
    return '';
  }
  if (m.isScale()) {
    // We are more or less a uniform scale
    return are_near(m.c0, m.c3, e) ? `scale(${w(m.c0)})` : `scale(${w(m.c0)},${w(m.c3)})`;
  }
  if (m.isTranslation()) {
    // We are more or less a pure translation
    return are_near(m.c5, 0.0, e) ? `translate(${w(m.c4)})` : `translate(${w(m.c4)},${w(m.c5)})`;
  }
  if (m.isRotation()) {
    // We are more or less a pure rotation
    return `rotate(${w(Math.atan2(m.c1, m.c0) * (180 / Math.PI))})`;
  }
  if (m.withoutTranslation().isRotation()) {
    // We are a rotation about a special axis (solution found by Johan Engelen)
    const angle = Math.atan2(m.c1, m.c0) * (180 / Math.PI);
    const tx = (m.c2 * m.c5 + m.c4 - m.c4 * m.c3) / (1 - m.c3 - m.c0 + m.c0 * m.c3 - m.c2 * m.c1);
    const ty = (m.c1 * tx + m.c5) / (1 - m.c3);
    return `rotate(${w(angle)},${w(tx)},${w(ty)})`;
  }
  if (m.isHShear()) {
    // We are more or less a pure skewX
    return `skewX(${w(Math.atan(m.c2) * (180 / Math.PI))})`;
  }
  if (m.isVShear()) {
    // We are more or less a pure skewY
    return `skewY(${w(Math.atan(m.c1) * (180 / Math.PI))})`;
  }
  return `matrix(${w(m.c0)},${w(m.c1)},${w(m.c2)},${w(m.c3)},${w(m.c4)},${w(m.c5)})`;
}
