// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/transforms.h, src/3rdparty/2geom/src/2geom/transforms.cpp
/*
 * Authors:
 *   ? <?@?.?>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *   Johan Engelen
 *
 * Copyright ?-2012 Authors
 */
import { Affine } from './affine.ts';
import type { Coord } from './coord.ts';
import { Point, unit_vector } from './point.ts';

// Upstream has one class per transform. Here each is a factory that returns the
// equivalent Affine, so `a.multiply(Translate(1, 2))` replaces `a * Translate(1, 2)`.

export function rad_from_deg(deg: Coord): Coord {
  return (deg / 180) * Math.PI;
}

export function deg_from_rad(rad: Coord): Coord {
  return (rad / Math.PI) * 180;
}

/** Translation by (x, y), or by a vector. */
export function Translate(x: Coord, y: Coord): Affine;
export function Translate(v: Point): Affine;
export function Translate(x: Coord | Point, y?: Coord): Affine {
  return typeof x === 'number' ? new Affine(1, 0, 0, 1, x, y as Coord) : new Affine(1, 0, 0, 1, x.x, x.y);
}

/** Scale by (x, y), by a vector, or uniformly by a single number. */
export function Scale(x: Coord, y?: Coord): Affine;
export function Scale(v: Point): Affine;
export function Scale(x: Coord | Point, y?: Coord): Affine {
  if (typeof x !== 'number') return new Affine(x.x, 0, 0, x.y, 0, 0);
  return new Affine(x, 0, 0, y ?? x, 0, 0);
}

function rotation(vx: Coord, vy: Coord): Affine {
  return new Affine(vx, vy, -vy, vx, 0, 0);
}

function rotate(theta: Coord): Affine;
function rotate(v: Point): Affine;
function rotate(theta: Coord | Point): Affine {
  const v = typeof theta === 'number' ? Point.polar(theta) : theta.normalized();
  return rotation(v.x, v.y);
}

/** Rotation by an angle in radians, or to the direction of a vector. */
export const Rotate = Object.assign(rotate, {
  from_degrees: (deg: Coord): Affine => rotate(rad_from_deg(deg)),
  /** Rotation about the point p. */
  around: (p: Point, angle: Coord): Affine =>
    Translate(p.neg()).multiply(rotate(angle)).multiply(Translate(p)),
});

/** x' = x + f * y. */
export function HShear(f: Coord): Affine {
  return new Affine(1, 0, f, 1, 0, 0);
}

/** y' = y + f * x. */
export function VShear(f: Coord): Affine {
  return new Affine(1, f, 0, 1, 0, 0);
}

/** Translate by `translation`, then scale by `scale` (upstream Zoom(scale, Translate)). */
export function Zoom(scale: Coord, translation: Point = new Point(0, 0)): Affine {
  return new Affine(scale, 0, 0, scale, translation.x * scale, translation.y * scale);
}

/** Mirror at the line through `origin` with the given direction. */
export function reflection(vector: Point, origin: Point): Affine {
  const vn = unit_vector(vector);
  const cx2 = vn.x * vn.x;
  const cy2 = vn.y * vn.y;
  const c2xy = 2 * vn.x * vn.y;
  const mirror = new Affine(cx2 - cy2, c2xy, c2xy, cy2 - cx2, 0, 0);
  return Translate(origin.neg()).multiply(mirror).multiply(Translate(origin));
}
