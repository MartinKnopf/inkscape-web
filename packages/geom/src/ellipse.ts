// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/ellipse.h, src/3rdparty/2geom/src/2geom/ellipse.cpp
/*
 * Authors:
 *   Marco Cecchetti <mrcekets at gmail.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2008-2014 Authors
 */
import { Affine } from './affine.ts';
import { Angle } from './angle.ts';
import { are_near, type Coord, type Dim2, hypot, X, Y } from './coord.ts';
import { EllipticalArc } from './elliptical-arc.ts';
import { Interval } from './interval.ts';
import { atan2, Point } from './point.ts';
import { Rect } from './rect.ts';
import { Rotate, Scale, Translate } from './transforms.ts';

/**
 * An ellipse given by center, the two rays (half axes) and the angle of the X ray
 * against the +X axis. Immutable.
 */
export class Ellipse {
  readonly #center: Point;
  readonly #rays: Point;
  readonly #angle: Angle;

  constructor(center: Point = new Point(), rays: Point = new Point(), angle: Angle | Coord = 0) {
    this.#center = center;
    this.#rays = rays;
    this.#angle = typeof angle === 'number' ? new Angle(angle) : angle;
  }

  /**
   * The ellipse A x^2 + B xy + C y^2 + D x + E y + F = 0, in canonical form
   * (rotation angle in [0, pi/2)).
   */
  static fromCoefficients(A: number, B: number, C: number, D: number, E: number, F: number): Ellipse {
    let den = 4 * A * C - B * B;
    if (den === 0) throw new RangeError('den == 0, while computing ellipse centre');
    const cx = (B * E - 2 * C * D) / den;
    const cy = (B * D - 2 * A * E) / den;

    // E(x,y) = a*(x-cx)^2 + b*(x-cx)*(y-cy) + c*(y-cy)^2 = 1
    const num = A * cx * cx + B * cx * cy + C * cy * cy - F;

    const angle = new Angle(Math.atan2(-B, -(A - C)) / 2);

    const rot = angle.radians();
    const sinrot = Math.sin(rot);
    const cosrot = Math.cos(rot);
    const cos2 = cosrot * cosrot;
    const sin2 = sinrot * sinrot;
    const cossin = cosrot * sinrot;

    den = A * cos2 + B * cossin + C * sin2;
    if (den === 0) throw new RangeError("den == 0, while computing 'rx' coefficient");
    const rx2 = num / den;
    if (rx2 < 0) throw new RangeError("rx2 < 0, while computing 'rx' coefficient");

    den = C * cos2 - B * cossin + A * sin2;
    if (den === 0) throw new RangeError("den == 0, while computing 'ry' coefficient");
    const ry2 = num / den;
    if (ry2 < 0) throw new RangeError("ry2 < 0, while computing 'rx' coefficient");

    return new Ellipse(new Point(cx, cy), new Point(Math.sqrt(rx2), Math.sqrt(ry2)), angle).makeCanonical();
  }

  center(): Point {
    return this.#center;
  }

  rays(): Point {
    return this.#rays;
  }

  ray(d: Dim2): Coord {
    return this.#rays.at(d);
  }

  rotationAngle(): Angle {
    return this.#angle;
  }

  withCenter(c: Point): Ellipse {
    return new Ellipse(c, this.#rays, this.#angle);
  }

  withRays(r: Point): Ellipse {
    return new Ellipse(this.#center, r, this.#angle);
  }

  withRotationAngle(a: Angle | Coord): Ellipse {
    return new Ellipse(this.#center, this.#rays, a);
  }

  /** Same ellipse with the rotation angle below pi/2 (rays swapped if needed), or 0 for a circle. */
  makeCanonical(): Ellipse {
    let angle = this.#angle;
    let rays = this.#rays;
    if (rays.x === rays.y) return new Ellipse(this.#center, rays, 0);
    if (angle.radians() < 0) angle = angle.plus(Math.PI);
    if (angle.radians() >= Math.PI / 2) {
      rays = new Point(rays.y, rays.x);
      angle = angle.minus(Math.PI / 2);
    }
    return new Ellipse(this.#center, rays, angle);
  }

  /** Transform that maps the unit circle to this ellipse. */
  unitCircleTransform(): Affine {
    return Scale(this.ray(X), this.ray(Y))
      .multiply(Rotate(this.#angle.radians()))
      .withTranslation(this.#center);
  }

  /** Transform that maps this ellipse to the unit circle. Throws for a degenerate ellipse. */
  inverseUnitCircleTransform(): Affine {
    if (this.ray(X) === 0 || this.ray(Y) === 0) {
      throw new RangeError("a degenerate ellipse doesn't have an inverse unit circle transform");
    }
    return Translate(this.#center.neg())
      .multiply(Rotate(-this.#angle.radians()))
      .multiply(Scale(1 / this.ray(X), 1 / this.ray(Y)));
  }

  /** Tight bounding box. */
  boundsExact(): Rect {
    const trans = this.unitCircleTransform();
    const proj = (d: Dim2) => {
      const r = hypot(trans.at(d), trans.at(d + 2));
      const mid = trans.at(d + 4);
      return new Interval(mid - r, mid + r);
    };
    return new Rect(proj(X), proj(Y));
  }

  /** Bounding square of the circle with the larger ray; exact only for circles. */
  boundsFast(): Rect {
    const larger = Math.max(this.ray(X), this.ray(Y));
    const rr = new Point(larger, larger);
    return new Rect(this.#center.sub(rr), this.#center.add(rr));
  }

  /** Coefficients [A, B, C, D, E, F] of the implicit equation. Throws for a degenerate ellipse. */
  coefficients(): [number, number, number, number, number, number] {
    if (this.ray(X) === 0 || this.ray(Y) === 0) {
      throw new RangeError("a degenerate ellipse doesn't have an implicit form");
    }
    const rot = this.#angle.radians();
    const sinrot = Math.sin(rot);
    const cosrot = Math.cos(rot);
    const cos2 = cosrot * cosrot;
    const sin2 = sinrot * sinrot;
    const cossin = cosrot * sinrot;
    const invrx2 = 1 / (this.ray(X) * this.ray(X));
    const invry2 = 1 / (this.ray(Y) * this.ray(Y));
    const cx = this.#center.x;
    const cy = this.#center.y;

    const A = invrx2 * cos2 + invry2 * sin2;
    const B = 2 * (invrx2 - invry2) * cossin;
    const C = invrx2 * sin2 + invry2 * cos2;
    const D = -2 * A * cx - B * cy;
    const E = -2 * C * cy - B * cx;
    const F = A * cx * cx + B * cx * cy + C * cy * cy - 1;
    return [A, B, C, D, E, F];
  }

  /** Point at angular parameter t; t wraps around at 2pi. */
  pointAt(t: Coord): Point {
    return Point.polar(t).transformed(this.unitCircleTransform());
  }

  /**
   * Angular parameter in [0, 2pi) of the ray from the center through p. If p is not on the
   * ellipse, this is the parameter of the intersection of that ray with the ellipse.
   */
  timeAt(p: Point): Coord {
    // A degenerate ellipse is a reparametrized line segment.
    if (this.ray(X) === 0 || this.ray(Y) === 0) {
      if (this.ray(X) !== 0) return Math.asin(this.#axisTimeAt(X, p));
      if (this.ray(Y) !== 0) return Math.acos(this.#axisTimeAt(Y, p));
      return 0;
    }
    const iuct = this.inverseUnitCircleTransform();
    return Angle.fromPoint(p.transformed(iuct)).radians0();
  }

  /** Time of p on the line through the ends of the axis `d` (upstream `Line(axis(d)).timeAt(p)`). */
  #axisTimeAt(d: Dim2, p: Point): Coord {
    const uct = this.unitCircleTransform();
    const a = (d === X ? new Point(-1, 0) : new Point(0, -1)).transformed(uct);
    const b = (d === X ? new Point(1, 0) : new Point(0, 1)).transformed(uct);
    const v = b.sub(a);
    if (v.x === 0 && v.y === 0) return 0;
    // Use the coordinate that gives better precision.
    return Math.abs(v.x) > Math.abs(v.y) ? (p.x - a.x) / v.x : (p.y - a.y) / v.y;
  }

  /**
   * The arc of this ellipse from ip through inner to fp, which must lie on the ellipse
   * (upstream Ellipse::arc). The flags are chosen so that the arc passes inner.
   */
  arc(ip: Point, inner: Point, fp: Point): EllipticalArc {
    let largeArc = false;
    let sweep = false;
    const fv = fp.sub(this.#center);
    const iv = ip.sub(this.#center);
    const innerv = inner.sub(this.#center);
    const ifcp = fv.cross(iv);
    if (
      ifcp !== 0 &&
      (Math.sign(fv.cross(innerv)) !== Math.sign(ifcp) || Math.sign(iv.cross(innerv)) !== Math.sign(-ifcp))
    ) {
      largeArc = true;
    }
    if (ifcp < 0 !== largeArc) sweep = true;
    return new EllipticalArc(ip, this.ray(X), this.ray(Y), this.rotationAngle(), largeArc, sweep, fp);
  }

  /** The ellipse after the transform. */
  transformed(m: Affine): Ellipse {
    const a = Scale(this.ray(X), this.ray(Y)).multiply(Rotate(this.#angle.radians()));
    const mwot = m.withoutTranslation();
    const am = a.multiply(mwot);
    const newCenter = this.#center.transformed(m);

    if (are_near(am.descrim(), 0)) {
      // The ellipse collapses to a line segment.
      let angle: number;
      if (am.c0 !== 0) {
        angle = Math.atan2(am.c2, am.c0);
      } else if (am.c1 !== 0) {
        angle = Math.atan2(am.c3, am.c1);
      } else {
        angle = Math.PI / 2;
      }
      const v = Point.polar(angle).transformed(am);
      return new Ellipse(newCenter, new Point(v.length(), 0), atan2(v));
    }
    if (mwot.isScale(0) && this.#angle.radians() === 0) {
      return new Ellipse(
        newCenter,
        new Point(this.ray(X) * Math.abs(mwot.c0), this.ray(Y) * Math.abs(mwot.c3)),
        this.#angle,
      );
    }

    const coeff = this.coefficients();
    let q = new Affine(coeff[0], coeff[1] / 2, coeff[1] / 2, coeff[2], 0, 0);
    let invm = mwot.inverse();
    q = invm.multiply(q);
    invm = new Affine(invm.c0, invm.c2, invm.c1, invm.c3, invm.c4, invm.c5);
    q = q.multiply(invm);
    return Ellipse.fromCoefficients(q.c0, 2 * q.c1, q.c3, 0, 0, -1).withCenter(newCenter);
  }

  /** Exact equality of center, rays and angle. */
  equals(o: Ellipse): boolean {
    return this.#center.equals(o.#center) && this.#rays.equals(o.#rays) && this.#angle.equals(o.#angle);
  }
}
