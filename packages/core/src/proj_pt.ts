// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/proj_pt.cpp, src/proj_pt.h
/*
 * 3x4 transformation matrix to map points from projective 3-space into the projective plane
 *
 * Authors:
 *   Maximilian Albert <Anhalter42@gmx.de>
 *
 * Copyright (C) 2007  Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Point } from '@inkscape-web/geom';
import { svgNumber } from './svg/stringstream.ts';

export const epsilon = 1e-6;

/** Parse "a : b : c" (upstream: the constructors from a coordinate string). */
function parse_coords(coord_str: string | null, n: number): number[] | null {
  if (!coord_str) {
    console.warn('Coordinate string is empty. Creating default point');
    return null;
  }
  const coords = coord_str.split(':');
  if (coords.length < n) {
    console.warn('Malformed coordinate string.');
    return null;
  }
  return coords.slice(0, n).map((c) => Number.parseFloat(c) || 0);
}

/**
 * A point of the projective plane (x : y : w) (upstream Proj::Pt2). The arithmetic is "affine":
 * for finite points, the result is the same as for the affine points.
 */
export class Pt2 {
  readonly pt: [number, number, number];

  constructor(x: number | Point | string | null = 0, y = 0, w = 1.0) {
    if (x instanceof Point) this.pt = [x.x, x.y, 1];
    else if (typeof x === 'string' || x === null) {
      const c = parse_coords(x, 3);
      this.pt = c ? [c[0]!, c[1]!, c[2]!] : [0, 0, 1.0];
    } else this.pt = [x, y, w];
  }

  at(index: number): number {
    return index > 2 ? Number.POSITIVE_INFINITY : this.pt[index]!;
  }

  equals(rhs: Pt2): boolean {
    const a = this.normalized();
    const b = rhs.normalized();
    return a.pt.every((v, i) => Math.abs(v - b.pt[i]!) < epsilon);
  }

  add(rhs: Pt2): Pt2 {
    const a = this.normalized();
    const b = rhs.normalized();
    return new Pt2(a.pt[0] + b.pt[0], a.pt[1] + b.pt[1], a.pt[2]);
  }
  sub(rhs: Pt2): Pt2 {
    const a = this.normalized();
    const b = rhs.normalized();
    return new Pt2(a.pt[0] - b.pt[0], a.pt[1] - b.pt[1], a.pt[2]);
  }
  mul(s: number): Pt2 {
    const a = this.normalized();
    return new Pt2(a.pt[0] * s, a.pt[1] * s, a.pt[2]);
  }

  normalize(): void {
    if (Math.abs(this.pt[2]) < 1e-6 || this.pt[2] === 1.0) return;
    this.pt[0] /= this.pt[2];
    this.pt[1] /= this.pt[2];
    this.pt[2] = 1.0;
  }

  normalized(): Pt2 {
    const p = new Pt2(...this.pt);
    p.normalize();
    return p;
  }

  affine(): Point {
    if (Math.abs(this.pt[2]) < epsilon) return new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    return new Point(this.pt[0] / this.pt[2], this.pt[1] / this.pt[2]);
  }

  is_finite(): boolean {
    return this.pt[2] !== 0; // FIXME: Should we allow for some tolerance?
  }

  coord_string(): string {
    return this.pt.map((v) => svgNumber(v)).join(' : ');
  }
}

/** A point of projective 3-space (x : y : z : w) (upstream Proj::Pt3). */
export class Pt3 {
  readonly pt: [number, number, number, number];

  constructor(x: number | string | null = 0, y = 0, z = 0, w = 1.0) {
    if (typeof x === 'string' || x === null) {
      const c = parse_coords(x, 4);
      this.pt = c ? [c[0]!, c[1]!, c[2]!, c[3]!] : [0, 0, 0, 1.0];
    } else this.pt = [x, y, z, w];
  }

  at(index: number): number {
    return index > 3 ? Number.POSITIVE_INFINITY : this.pt[index]!;
  }

  equals(rhs: Pt3): boolean {
    const a = this.normalized();
    const b = rhs.normalized();
    return a.pt.every((v, i) => Math.abs(v - b.pt[i]!) < epsilon);
  }

  add(rhs: Pt3): Pt3 {
    const a = this.normalized();
    const b = rhs.normalized();
    return new Pt3(a.pt[0] + b.pt[0], a.pt[1] + b.pt[1], a.pt[2] + b.pt[2], a.pt[3]);
  }
  sub(rhs: Pt3): Pt3 {
    const a = this.normalized();
    const b = rhs.normalized();
    return new Pt3(a.pt[0] - b.pt[0], a.pt[1] - b.pt[1], a.pt[2] - b.pt[2], a.pt[3]);
  }
  mul(s: number): Pt3 {
    const a = this.normalized();
    return new Pt3(a.pt[0] * s, a.pt[1] * s, a.pt[2] * s, a.pt[3]);
  }

  normalize(): void {
    if (Math.abs(this.pt[3]) < 1e-6 || this.pt[3] === 1.0) return;
    this.pt[0] /= this.pt[3];
    this.pt[1] /= this.pt[3];
    this.pt[2] /= this.pt[3];
    this.pt[3] = 1.0;
  }

  normalized(): Pt3 {
    const p = new Pt3(...this.pt);
    p.normalize();
    return p;
  }

  is_finite(): boolean {
    return this.pt[3] !== 0; // FIXME: Should we allow for some tolerance?
  }

  coord_string(): string {
    return this.pt.map((v) => svgNumber(v)).join(' : ');
  }
}
