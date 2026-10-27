// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/elliptical-arc.h, src/3rdparty/2geom/src/2geom/elliptical-arc.cpp
/*
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *   Marco Cecchetti <mrcekets at gmail.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2007-2009 Authors
 */
import { Affine } from './affine.ts';
import { Angle, AngleInterval } from './angle.ts';
import { LineSegment } from './bezier-curve.ts';
import { type Coord, type Dim2, hypot, X, Y } from './coord.ts';
import type { Curve } from './curve.ts';
import { Ellipse } from './ellipse.ts';
import { Interval } from './interval.ts';
import type { PathSink } from './path-sink.ts';
import { angle_between, atan2, middle_point, Point } from './point.ts';
import { Rect } from './rect.ts';
import { Rotate } from './transforms.ts';

interface ArcParts {
  readonly initialPoint: Point;
  readonly finalPoint: Point;
  readonly ellipse: Ellipse;
  readonly angles: AngleInterval;
  readonly largeArc: boolean;
}

/**
 * Elliptical arc: a section of an ellipse, defined like the SVG arc command by its end points,
 * the two rays, the rotation of the ellipse and the large-arc and sweep flags. Immutable.
 *
 * Like upstream, the constructor changes unusable input: rays that are too small are enlarged
 * so that the arc reaches its end points, and an arc with a zero ray is a chord (a straight line).
 * `ray()` and `rays()` return the corrected values.
 */
export class EllipticalArc implements Curve {
  #p: ArcParts;

  /**
   * @param rotationAngle rotation of the ellipse in radians
   * @param sweep true if the arc goes in the direction of increasing angles (clockwise on screen)
   */
  constructor(
    initialPoint: Point,
    rx: Coord,
    ry: Coord,
    rotationAngle: Coord | Angle,
    largeArc: boolean,
    sweep: boolean,
    finalPoint: Point,
  ) {
    this.#p = EllipticalArc.#updateCenterAndAngles(
      initialPoint,
      finalPoint,
      new Ellipse(new Point(0, 0), new Point(rx, ry), rotationAngle),
      new AngleInterval(0, 0, sweep),
      largeArc,
    );
  }

  static #of(p: ArcParts): EllipticalArc {
    const arc = new EllipticalArc(p.initialPoint, 0, 0, 0, false, false, p.initialPoint);
    arc.#p = p;
    return arc;
  }

  /** Compute center and angles of the ellipse from the end points (SVG implementation notes F.6.5). */
  static #updateCenterAndAngles(
    ip: Point,
    fp: Point,
    ellipse: Ellipse,
    angles: AngleInterval,
    largeArcIn: boolean,
  ): ArcParts {
    const d = ip.sub(fp);
    const mid = middle_point(ip, fp);

    const degenerate = (): ArcParts => ({
      initialPoint: ip,
      finalPoint: fp,
      ellipse: new Ellipse(ip, new Point(0, 0), 0),
      angles: new AngleInterval(),
      largeArc: false,
    });

    // If ip = fp, the arc contains no other points.
    if (ip.equals(fp)) return degenerate();

    // Rays should be positive.
    let e = ellipse.withRays(new Point(Math.abs(ellipse.ray(X)), Math.abs(ellipse.ray(Y))));

    if (e.ray(X) === 0 || e.ray(Y) === 0) {
      // A chord.
      return {
        initialPoint: ip,
        finalPoint: fp,
        ellipse: new Ellipse(mid, new Point(d.length() / 2, 0), atan2(d)),
        angles: new AngleInterval(0, Math.PI, false),
        largeArc: false,
      };
    }

    const theta = e.rotationAngle().radians();
    const rot = Rotate(theta); // the matrix in F.6.5.3
    const invrot = new Affine(rot.c0, -rot.c1, -rot.c2, rot.c3, 0, 0); // the matrix in F.6.5.1

    let r = e.rays();
    const p = d.div(2).transformed(invrot); // x', y' in F.6.5.1
    let c = new Point(0, 0); // cx', cy' in F.6.5.2

    // Correct out-of-range radii.
    const lambda = hypot(p.x / r.x, p.y / r.y);
    if (lambda > 1) {
      r = r.mul(lambda);
      e = e.withRays(r).withCenter(mid);
    } else {
      // F.6.5.2
      const rxry = r.x * r.x * r.y * r.y;
      const pxry = p.x * p.x * r.y * r.y;
      const rxpy = r.x * r.x * p.y * p.y;
      const denominator = rxpy + pxry;
      if (denominator === 0) return degenerate();
      let rad = (rxry - pxry - rxpy) / denominator;
      // Normally rad should never be negative, but numerical inaccuracy may cause this.
      if (rad > 0) {
        rad = Math.sqrt(rad);
        if (angles.sweep() === largeArcIn) rad = -rad;
        c = new Point((r.x * p.y) / r.y, (-r.y * p.x) / r.x).mul(rad);
        e = e.withCenter(c.transformed(rot).add(mid));
      } else {
        e = e.withCenter(mid);
      }
    }

    // Start and end angles. If the ellipse was enlarged, c is zero, which is correct.
    const sp = new Point((p.x - c.x) / r.x, (p.y - c.y) / r.y);
    const ep = new Point((-p.x - c.x) / r.x, (-p.y - c.y) / r.y);
    const v = new Point(1, 0);

    return {
      initialPoint: ip,
      finalPoint: fp,
      ellipse: e,
      angles: angles.withInitial(angle_between(v, sp)).withFinal(angle_between(v, ep)),
      largeArc: largeArcIn,
    };
  }

  center(): Point {
    return this.#p.ellipse.center();
  }

  ray(d: Dim2): Coord {
    return this.#p.ellipse.ray(d);
  }

  rays(): Point {
    return this.#p.ellipse.rays();
  }

  rotationAngle(): Angle {
    return this.#p.ellipse.rotationAngle();
  }

  largeArc(): boolean {
    return this.#p.largeArc;
  }

  sweep(): boolean {
    return this.#p.angles.sweep();
  }

  initialAngle(): Angle {
    return this.#p.angles.initialAngle();
  }

  finalAngle(): Angle {
    return this.#p.angles.finalAngle();
  }

  containsAngle(angle: Angle): boolean {
    return this.#p.angles.contains(angle);
  }

  /** Point on the ellipse at the angular parameter t (not limited to the arc). */
  pointAtAngle(t: Coord): Point {
    return this.#p.ellipse.pointAt(t);
  }

  /** Curve time [0, 1] of an angular parameter. */
  timeAtAngle(a: Angle): Coord {
    return this.#p.angles.timeAtAngle(a);
  }

  /** Angular parameter at curve time t. */
  angleAt(t: Coord): Angle {
    return this.#p.angles.angleAt(t);
  }

  sweepAngle(): Coord {
    return this.#p.angles.sweepAngle();
  }

  angularExtent(): Coord {
    return this.#p.angles.extent();
  }

  /** Transform that maps the unit circle to the ellipse of the arc. */
  unitCircleTransform(): Affine {
    return this.#p.ellipse.unitCircleTransform();
  }

  /** True when a ray is 0: the arc is the straight line between its end points. */
  isChord(): boolean {
    return this.ray(X) === 0 || this.ray(Y) === 0;
  }

  chord(): LineSegment {
    return new LineSegment(this.#p.initialPoint, this.#p.finalPoint);
  }

  initialPoint(): Point {
    return this.#p.initialPoint;
  }

  finalPoint(): Point {
    return this.#p.finalPoint;
  }

  isDegenerate(): boolean {
    return this.#p.initialPoint.equals(this.#p.finalPoint);
  }

  isLineSegment(): boolean {
    return this.isChord();
  }

  pointAt(t: Coord): Point {
    if (t === 0) return this.#p.initialPoint;
    if (t === 1) return this.#p.finalPoint;
    if (this.isChord()) return this.chord().pointAt(t);
    return this.#p.ellipse.pointAt(this.angleAt(t).radians());
  }

  boundsFast(): Rect {
    return this.boundsExact();
  }

  /**
   * The extreme X and Y points are either end points or local extrema of the ellipse. The extrema
   * correspond to two angles pi apart; they count if the arc contains the angle.
   */
  boundsExact(): Rect {
    const { initialPoint: ip, finalPoint: fp, angles } = this.#p;
    if (this.isChord()) return new Rect(ip, fp);
    if (angles.isFull()) return this.#p.ellipse.boundsExact();

    const trans = this.unitCircleTransform();
    const projBounds = (d: Dim2) => {
      // The d-th coordinate function pulled back to the unit circle is
      // trans[d] * x + trans[d + 2] * y + trans[d + 4].
      let result = new Interval(ip.at(d), fp.at(d));
      const v = new Point(trans.at(d), trans.at(d + 2));
      const r = v.length();
      const mid = trans.at(d + 4);
      const angle = Angle.fromPoint(v);
      if (angles.contains(angle)) result = result.expandTo(mid + r);
      if (angles.contains(angle.plus(Math.PI))) result = result.expandTo(mid - r);
      return result;
    };
    return new Rect(projBounds(X), projBounds(Y));
  }

  /**
   * The arc after the transform. A non-uniform scale or a shear changes the ellipse, which is
   * still an ellipse, so the result is again an arc. A singular transform gives a chord.
   */
  transformed(m: Affine): EllipticalArc {
    const { initialPoint, finalPoint, ellipse, angles, largeArc } = this.#p;
    const ip = initialPoint.transformed(m);
    const fp = finalPoint.transformed(m);

    if (this.isChord()) {
      return EllipticalArc.#of({
        initialPoint: ip,
        finalPoint: fp,
        ellipse: new Ellipse(middle_point(ip, fp), new Point(0, 0), 0),
        angles,
        largeArc,
      });
    }

    const e = ellipse.transformed(m);
    // The ellipse transform does not preserve its functional form, so the angles are recomputed.
    const flipped = m.det() < 0 ? angles.withSweep(!angles.sweep()) : angles;
    return EllipticalArc.#of({
      initialPoint: ip,
      finalPoint: fp,
      ellipse: e,
      angles: flipped.withInitial(e.timeAt(ip)).withFinal(e.timeAt(fp)),
      largeArc,
    });
  }

  /** The same arc traversed in the opposite direction. */
  reverse(): EllipticalArc {
    const p = this.#p;
    return EllipticalArc.#of({
      ...p,
      initialPoint: p.finalPoint,
      finalPoint: p.initialPoint,
      angles: p.angles.reversed(),
    });
  }

  portion(f: Coord, t: Coord): EllipticalArc {
    f = Math.min(Math.max(f, 0), 1);
    t = Math.min(Math.max(t, 0), 1);

    if (f === t) {
      const pt = this.pointAt(f);
      return EllipticalArc.#of({
        initialPoint: pt,
        finalPoint: pt,
        ellipse: new Ellipse(),
        angles: new AngleInterval(),
        largeArc: false,
      });
    }
    if (f === 0 && t === 1) return this;
    if (f === 1 && t === 0) return this.reverse();

    let angles = this.#p.angles.withAngles(this.angleAt(f), this.angleAt(t));
    if (f > t) angles = angles.withSweep(!this.sweep());
    const largeArc = this.#p.largeArc && !(Math.abs(this.angularExtent() * (t - f)) <= Math.PI);
    return EllipticalArc.#of({
      ...this.#p,
      initialPoint: this.pointAt(f),
      finalPoint: this.pointAt(t),
      angles,
      largeArc,
    });
  }

  /** The arc with another final point (rays, rotation and flags as before; the center changes). */
  withFinal(p: Point): EllipticalArc {
    const { initialPoint, ellipse, angles, largeArc } = this.#p;
    return EllipticalArc.#of(
      EllipticalArc.#updateCenterAndAngles(initialPoint, p, ellipse, angles, largeArc),
    );
  }

  equals(other: Curve): boolean {
    if (!(other instanceof EllipticalArc)) return false;
    return (
      this.#p.initialPoint.equals(other.#p.initialPoint) &&
      this.#p.finalPoint.equals(other.#p.finalPoint) &&
      this.rays().equals(other.rays()) &&
      this.rotationAngle().equals(other.rotationAngle()) &&
      this.largeArc() === other.largeArc() &&
      this.sweep() === other.sweep()
    );
  }

  feed(sink: PathSink, moveToInitial: boolean): void {
    if (moveToInitial) sink.moveTo(this.#p.initialPoint);
    sink.arcTo(
      this.ray(X),
      this.ray(Y),
      this.rotationAngle().radians(),
      this.#p.largeArc,
      this.sweep(),
      this.#p.finalPoint,
    );
  }
}
