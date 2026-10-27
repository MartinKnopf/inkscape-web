// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/affine.h, src/3rdparty/2geom/src/2geom/affine.cpp
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com> (Original NRAffine definition and related macros)
 *   Nathan Hurst <njh@mail.csse.monash.edu.au> (Geom::Affine class version of the above)
 *   Michael G. Sloan <mgsloan@gmail.com> (reorganization and additions)
 *   Krzysztof Kosiński <tweenk.pl@gmail.com> (removal of boilerplate, docs)
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2006-2009 Authors
 */
import { are_near, type Coord, EPSILON, rel_error_bound } from './coord.ts';
import { Point } from './point.ts';

/**
 * 2D affine transformation (immutable), the matrix
 *
 *     | c0 c1 0 |
 *     | c2 c3 0 |
 *     | c4 c5 1 |
 *
 * Points are row vectors: (x, y, 1) * M. Like upstream, `a.multiply(b)` is `a * b`:
 * apply a first, then b.
 */
export class Affine {
  readonly c0: Coord;
  readonly c1: Coord;
  readonly c2: Coord;
  readonly c3: Coord;
  readonly c4: Coord;
  readonly c5: Coord;

  /** The identity when called without arguments. */
  constructor(c0 = 1, c1 = 0, c2 = 0, c3 = 1, c4 = 0, c5 = 0) {
    this.c0 = c0;
    this.c1 = c1;
    this.c2 = c2;
    this.c3 = c3;
    this.c4 = c4;
    this.c5 = c5;
  }

  static identity(): Affine {
    return new Affine();
  }

  /** Matrix with the given axes and translation (upstream `from_basis`). */
  static fromBasis(xBasis: Point, yBasis: Point, offset: Point = new Point(0, 0)): Affine {
    return new Affine(xBasis.x, xBasis.y, yBasis.x, yBasis.y, offset.x, offset.y);
  }

  /** Coefficient by index 0..5 (upstream `m[i]`). */
  at(i: number): Coord {
    return [this.c0, this.c1, this.c2, this.c3, this.c4, this.c5][i] as Coord;
  }

  /** this * o: apply this, then o. */
  multiply(o: Affine): Affine {
    return new Affine(
      this.c0 * o.c0 + this.c1 * o.c2,
      this.c0 * o.c1 + this.c1 * o.c3,
      this.c2 * o.c0 + this.c3 * o.c2,
      this.c2 * o.c1 + this.c3 * o.c3,
      this.c4 * o.c0 + this.c5 * o.c2 + o.c4,
      this.c4 * o.c1 + this.c5 * o.c3 + o.c5,
    );
  }

  xAxis(): Point {
    return new Point(this.c0, this.c1);
  }

  yAxis(): Point {
    return new Point(this.c2, this.c3);
  }

  translation(): Point {
    return new Point(this.c4, this.c5);
  }

  expansionX(): Coord {
    return Math.sqrt(this.c0 * this.c0 + this.c1 * this.c1);
  }

  expansionY(): Coord {
    return Math.sqrt(this.c2 * this.c2 + this.c3 * this.c3);
  }

  expansion(): Point {
    return new Point(this.expansionX(), this.expansionY());
  }

  withXAxis(v: Point): Affine {
    return new Affine(v.x, v.y, this.c2, this.c3, this.c4, this.c5);
  }

  withYAxis(v: Point): Affine {
    return new Affine(this.c0, this.c1, v.x, v.y, this.c4, this.c5);
  }

  withTranslation(p: Point): Affine {
    return new Affine(this.c0, this.c1, this.c2, this.c3, p.x, p.y);
  }

  withoutTranslation(): Affine {
    return this.withTranslation(new Point(0, 0));
  }

  /** Scale the X axis vector to the given length (unchanged when it has length 0). */
  withExpansionX(val: Coord): Affine {
    const exp = this.expansionX();
    if (exp === 0) return this;
    const coef = val / exp;
    return new Affine(this.c0 * coef, this.c1 * coef, this.c2, this.c3, this.c4, this.c5);
  }

  /** Scale the Y axis vector to the given length (unchanged when it has length 0). */
  withExpansionY(val: Coord): Affine {
    const exp = this.expansionY();
    if (exp === 0) return this;
    const coef = val / exp;
    return new Affine(this.c0, this.c1, this.c2 * coef, this.c3 * coef, this.c4, this.c5);
  }

  isIdentity(eps: number = EPSILON): boolean {
    return (
      are_near(this.c0, 1, eps) &&
      are_near(this.c1, 0, eps) &&
      are_near(this.c2, 0, eps) &&
      are_near(this.c3, 1, eps) &&
      are_near(this.c4, 0, eps) &&
      are_near(this.c5, 0, eps)
    );
  }

  isTranslation(eps: number = EPSILON): boolean {
    return (
      are_near(this.c0, 1, eps) &&
      are_near(this.c1, 0, eps) &&
      are_near(this.c2, 0, eps) &&
      are_near(this.c3, 1, eps)
    );
  }

  isNonzeroTranslation(eps: number = EPSILON): boolean {
    return this.isTranslation(eps) && (!are_near(this.c4, 0, eps) || !are_near(this.c5, 0, eps));
  }

  isScale(eps: number = EPSILON): boolean {
    if (this.isSingular(eps)) return false;
    return (
      are_near(this.c1, 0, eps) &&
      are_near(this.c2, 0, eps) &&
      are_near(this.c4, 0, eps) &&
      are_near(this.c5, 0, eps)
    );
  }

  isNonzeroScale(eps: number = EPSILON): boolean {
    if (this.isSingular(eps)) return false;
    return (
      (!are_near(this.c0, 1, eps) || !are_near(this.c3, 1, eps)) &&
      are_near(this.c1, 0, eps) &&
      are_near(this.c2, 0, eps) &&
      are_near(this.c4, 0, eps) &&
      are_near(this.c5, 0, eps)
    );
  }

  /** Scale with |sx| == |sy|; flips count as uniform. */
  isUniformScale(eps: number = EPSILON): boolean {
    if (this.isSingular(eps)) return false;
    return (
      are_near(Math.abs(this.c0), Math.abs(this.c3), eps) &&
      are_near(this.c1, 0, eps) &&
      are_near(this.c2, 0, eps) &&
      are_near(this.c4, 0, eps) &&
      are_near(this.c5, 0, eps)
    );
  }

  isNonzeroUniformScale(eps: number = EPSILON): boolean {
    if (this.isSingular(eps)) return false;
    return (
      !(are_near(this.c0, 1, eps) && are_near(this.c3, 1, eps)) &&
      are_near(Math.abs(this.c0), Math.abs(this.c3), eps) &&
      are_near(this.c1, 0, eps) &&
      are_near(this.c2, 0, eps) &&
      are_near(this.c4, 0, eps) &&
      are_near(this.c5, 0, eps)
    );
  }

  isRotation(eps: number = EPSILON): boolean {
    return (
      are_near(this.c0, this.c3, eps) &&
      are_near(this.c1, -this.c2, eps) &&
      are_near(this.c4, 0, eps) &&
      are_near(this.c5, 0, eps) &&
      are_near(this.c0 * this.c0 + this.c1 * this.c1, 1, eps)
    );
  }

  isNonzeroRotation(eps: number = EPSILON): boolean {
    return !are_near(this.c0, 1, eps) && this.isRotation(eps);
  }

  isNonzeroNonpureRotation(eps: number = EPSILON): boolean {
    return (
      !are_near(this.c0, 1, eps) &&
      are_near(this.c0, this.c3, eps) &&
      are_near(this.c1, -this.c2, eps) &&
      are_near(this.c0 * this.c0 + this.c1 * this.c1, 1, eps)
    );
  }

  rotationCenter(): Point {
    const x =
      (this.c2 * this.c5 + this.c4 - this.c4 * this.c3) /
      (1 - this.c3 - this.c0 + this.c0 * this.c3 - this.c2 * this.c1);
    const y = (this.c1 * x + this.c5) / (1 - this.c3);
    return new Point(x, y);
  }

  isHShear(eps: number = EPSILON): boolean {
    return (
      are_near(this.c0, 1, eps) &&
      are_near(this.c1, 0, eps) &&
      are_near(this.c3, 1, eps) &&
      are_near(this.c4, 0, eps) &&
      are_near(this.c5, 0, eps)
    );
  }

  isNonzeroHShear(eps: number = EPSILON): boolean {
    return this.isHShear(eps) && !are_near(this.c2, 0, eps);
  }

  isVShear(eps: number = EPSILON): boolean {
    return (
      are_near(this.c0, 1, eps) &&
      are_near(this.c2, 0, eps) &&
      are_near(this.c3, 1, eps) &&
      are_near(this.c4, 0, eps) &&
      are_near(this.c5, 0, eps)
    );
  }

  isNonzeroVShear(eps: number = EPSILON): boolean {
    return this.isVShear(eps) && !are_near(this.c1, 0, eps);
  }

  isZoom(eps: number = EPSILON): boolean {
    if (this.isSingular(eps)) return false;
    return are_near(this.c0, this.c3, eps) && are_near(this.c1, 0, eps) && are_near(this.c2, 0, eps);
  }

  preservesArea(eps: number = EPSILON): boolean {
    return are_near(this.descrim2(), 1, eps);
  }

  preservesAngles(eps: number = EPSILON): boolean {
    if (this.isSingular(eps)) return false;
    return (
      (are_near(this.c0, this.c3, eps) && are_near(this.c1, -this.c2, eps)) ||
      (are_near(this.c0, -this.c3, eps) && are_near(this.c1, this.c2, eps))
    );
  }

  preservesDistances(eps: number = EPSILON): boolean {
    return (
      ((are_near(this.c0, this.c3, eps) && are_near(this.c1, -this.c2, eps)) ||
        (are_near(this.c0, -this.c3, eps) && are_near(this.c1, this.c2, eps))) &&
      are_near(this.c0 * this.c0 + this.c1 * this.c1, 1, eps)
    );
  }

  /** True when the transform mirrors (negative determinant). */
  flips(): boolean {
    return this.det() < 0;
  }

  isSingular(eps: number = EPSILON): boolean {
    return are_near(this.det(), 0, eps);
  }

  /** Inverse matrix; the identity when this matrix is (nearly) singular, like upstream. */
  inverse(): Affine {
    const mx = Math.max(Math.abs(this.c0) + Math.abs(this.c1), Math.abs(this.c2) + Math.abs(this.c3));
    if (mx > 0) {
      const determ = this.det();
      if (!rel_error_bound(Math.sqrt(Math.abs(determ)), mx)) {
        const ideterm = 1 / determ;
        const d0 = this.c3 * ideterm;
        const d1 = -this.c1 * ideterm;
        const d2 = -this.c2 * ideterm;
        const d3 = this.c0 * ideterm;
        return new Affine(d0, d1, d2, d3, -this.c4 * d0 - this.c5 * d2, -this.c4 * d1 - this.c5 * d3);
      }
    }
    return new Affine();
  }

  det(): Coord {
    return this.c0 * this.c3 - this.c1 * this.c2;
  }

  /** |det|. */
  descrim2(): Coord {
    return Math.abs(this.det());
  }

  /** sqrt(|det|): the uniform scale with the same area change. */
  descrim(): Coord {
    return Math.sqrt(this.descrim2());
  }

  /** Exact equality of all coefficients. */
  equals(o: Affine): boolean {
    return (
      this.c0 === o.c0 &&
      this.c1 === o.c1 &&
      this.c2 === o.c2 &&
      this.c3 === o.c3 &&
      this.c4 === o.c4 &&
      this.c5 === o.c5
    );
  }

  /** Every coefficient differs by at most eps. */
  isNear(o: Affine, eps: number = EPSILON): boolean {
    return (
      are_near(this.c0, o.c0, eps) &&
      are_near(this.c1, o.c1, eps) &&
      are_near(this.c2, o.c2, eps) &&
      are_near(this.c3, o.c3, eps) &&
      are_near(this.c4, o.c4, eps) &&
      are_near(this.c5, o.c5, eps)
    );
  }
}
