// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-star.cpp, src/object/sp-star.h
/*
 * <sodipodi:star> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *   Tavmjong Bah <tavmjong@free.fr>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Affine, CubicBezier, distance, LineSegment, Path, Point, Rotate } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _, ngettext } from '../i18n.ts';
import { parseNumberWithUnit, readNumberPrefix } from '../svg/svg-length.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { lpeItemClasses } from './sp-lpe-item.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  SP_OBJECT_WRITE_EXT,
  type SPCtx,
} from './sp-object.ts';
import { SPShape } from './sp-shape.ts';

/** Which of the two radii a star point is on. */
export enum SPStarPoint {
  SP_STAR_POINT_KNOT1,
  SP_STAR_POINT_KNOT2,
}
const { SP_STAR_POINT_KNOT1: KNOT1, SP_STAR_POINT_KNOT2: KNOT2 } = SPStarPoint;

/** g_ascii_strtod without the end pointer: 0 when there is no number. */
function strtod(value: string): number {
  return readNumberPrefix(value)?.value ?? 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * Returns a unit-length vector at 90 degrees to the direction from o to n
 */
function rot90_rel(o: Point, n: Point): Point {
  return n.sub(o).ccw().normalized();
}

/**
 * Returns a unique 32 bit int for a given point.
 * Obvious (but acceptable for my purposes) limits to uniqueness:
 * - returned value for x,y repeats for x+n*1024,y+n*1024
 * - returned value is unchanged when the point is moved by less than 1/1024 of px
 */
function point_unique_int(o: Point): number {
  const x = (Math.trunc(Math.floor(o.x * 64)) % 1024) + (Math.trunc(Math.floor(o.x * 1024)) % 64);
  const y = (Math.trunc(Math.floor(o.y * 64)) % 1024) + (Math.trunc(Math.floor(o.y * 1024)) % 64);
  return (Math.imul(65536, x) + y) >>> 0;
}

/**
 * Returns the next pseudorandom value using the Linear Congruential Generator algorithm (LCG)
 * with the parameters (m = 2^32, a = 69069, b = 1). These parameters give a full-period generator,
 * i.e. it is guaranteed to go through all integers < 2^32
 */
function lcg_next(prev: number): number {
  return (Math.imul(69069, prev) + 1) >>> 0;
}

/** Returns a random number in the range [-0.5, 0.5) from the given seed, stepping the given number of steps from the seed. */
function rnd(seed: number, steps: number): number {
  let lcg = seed;
  for (; steps > 0; steps--) lcg = lcg_next(lcg);
  return lcg / 4294967296 - 0.5;
}

/**
 * Get the X-Y value of a vertex in the item coordinate system.
 * @param randomized false (default) if you want to get the exact, not the randomized point
 */
export function sp_star_get_xy(star: SPStar, point: SPStarPoint, index: number, randomized = false): Point {
  const darg = (2.0 * Math.PI) / star.sides;
  let arg = star.arg[point] as number;
  arg += index * darg;
  const xy = new Point(Math.cos(arg), Math.sin(arg)).mul(star.r[point] as number).add(star.center);

  if (!randomized || star.randomized === 0) {
    // return the exact point
    return xy;
  }
  // find out the seed, unique for this point so that randomization is the same so long as the original point is stationary
  const seed = point_unique_int(xy);
  // the full range (corresponding to star->randomized == 1.0) is equal to the star's diameter
  const range = 2 * Math.max(star.r[0], star.r[1]);
  // find out the random displacement; x is controlled by step 1 from the seed, y by the step 2
  const shift = new Point(star.randomized * range * rnd(seed, 1), star.randomized * range * rnd(seed, 2));
  // add the shift to the exact point
  return xy.add(shift);
}

function sp_star_get_curvepoint(star: SPStar, point: SPStarPoint, index: number, previ: boolean): Point {
  // the point whose neighboring curve handle we're calculating
  const o = sp_star_get_xy(star, point, index);

  // indices of previous and next points
  const pi = index > 0 ? index - 1 : star.sides - 1;
  const ni = index < star.sides - 1 ? index + 1 : 0;

  // the other point type
  const other = point === KNOT2 ? KNOT1 : KNOT2;

  // the neighbors of o; depending on flatsided, they're either the same type (polygon) or the other type (star)
  const prev = star.flatsided
    ? sp_star_get_xy(star, point, pi)
    : sp_star_get_xy(star, other, point === KNOT2 ? index : pi);
  const next = star.flatsided
    ? sp_star_get_xy(star, point, ni)
    : sp_star_get_xy(star, other, point === KNOT1 ? index : ni);

  // prev-next midpoint
  const mid = prev.add(next).mul(0.5);

  // point to which we direct the bissector of the curve handles;
  // it's far enough outside the star on the perpendicular to prev-next through mid
  const biss = mid.add(rot90_rel(mid, next).mul(100000));

  // lengths of vectors to prev and next
  const prev_len = prev.sub(o).length();
  const next_len = next.sub(o).length();

  // unit-length vector perpendicular to o-biss
  const rot = rot90_rel(o, biss);

  // multiply rot by star->rounded coefficient and the distance to the star point; flip for next
  let ret: Point;
  if (previ) ret = rot.mul(star.rounded * prev_len);
  else ret = rot.mul(star.rounded * next_len * -1);

  if (star.randomized === 0) {
    // add the vector to o to get the final curvepoint
    return o.add(ret);
  }
  // the seed corresponding to the exact point
  const seed = point_unique_int(o);
  // randomly rotate (by step 3 from the seed) and scale (by step 4) the vector
  ret = ret.transformed(Rotate(star.randomized * Math.PI * rnd(seed, 3)));
  ret = ret.mul(1 + star.randomized * rnd(seed, 4));
  // the randomized corner point
  const o_randomized = sp_star_get_xy(star, point, index, true);
  return o_randomized.add(ret);
}

const NEXT = false;
const PREV = true;

/**
 * <sodipodi:star> on svg:path (upstream SPStar).
 *
 * TODO: LPE, snap points, turn_upright(), adjust_pattern and adjust_gradient in setTransform().
 */
export class SPStar extends SPShape {
  sides = 5;
  center = new Point(0, 0);
  /** Outer and inner radius. */
  r: [number, number] = [1.0, 0.001];
  /** Angle of the first outer and inner point. */
  arg: [number, number] = [0.0, 0.0];
  flatsided = false;
  rounded = 0.0;
  randomized = 0.0;

  override typeName(): string {
    return this.flatsided ? 'polygon' : 'star';
  }
  override displayName(): string {
    return this.flatsided ? _('Polygon') : _('Star');
  }
  override description(): string {
    // while there will never be less than 2 or 3 vertices, we still need to
    // make calls to ngettext because the pluralization may be different
    // for various numbers >=3.  The singular form is used as the index.
    return ngettext('with %d vertex', 'with %d vertices', this.sides).replace('%d', String(this.sides));
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.SODIPODI_CX);
    this.readAttr(SPAttr.SODIPODI_CY);
    this.readAttr(SPAttr.INKSCAPE_FLATSIDED);
    this.readAttr(SPAttr.SODIPODI_SIDES);
    this.readAttr(SPAttr.SODIPODI_R1);
    this.readAttr(SPAttr.SODIPODI_R2);
    this.readAttr(SPAttr.SODIPODI_ARG1);
    this.readAttr(SPAttr.SODIPODI_ARG2);
    this.readAttr(SPAttr.INKSCAPE_ROUNDED);
    this.readAttr(SPAttr.INKSCAPE_RANDOMIZED);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:path');
    if (!repr) return null;

    if (flags & SP_OBJECT_WRITE_EXT) {
      repr.setAttribute('sodipodi:type', 'star');
      repr.setAttributeBoolean('inkscape:flatsided', this.flatsided);
      repr.setAttributeInt('sodipodi:sides', this.sides);
      repr.setAttributeSvgDouble('sodipodi:cx', this.center.x);
      repr.setAttributeSvgDouble('sodipodi:cy', this.center.y);
      repr.setAttributeSvgDouble('sodipodi:r1', this.r[0]);
      repr.setAttributeSvgDouble('sodipodi:r2', this.r[1]);
      repr.setAttributeSvgDouble('sodipodi:arg1', this.arg[0]);
      repr.setAttributeSvgDouble('sodipodi:arg2', this.arg[1]);
      repr.setAttributeSvgDouble('inkscape:rounded', this.rounded);
      repr.setAttributeSvgDouble('inkscape:randomized', this.randomized);
    }

    this.set_shape();
    if (this._curve) repr.setAttribute('d', sp_svg_write_path(this._curve));
    else repr.removeAttribute('d');

    return super.write(xmlDoc, repr, flags);
  }

  override set(key: SPAttr, value: string | null): void {
    /* fixme: we should really collect updates */
    switch (key) {
      case SPAttr.SODIPODI_SIDES:
        if (value !== null) {
          this.sides = clamp(Number.parseInt(value, 10) || 0, this.flatsided ? 3 : 2, 1024);
        } else {
          this.sides = 5;
        }
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_CX:
        this.center = new Point(parseNumberWithUnit(value, true)?.computed ?? 0.0, this.center.y);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_CY:
        this.center = new Point(this.center.x, parseNumberWithUnit(value, true)?.computed ?? 0.0);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_R1:
        this.r[0] = parseNumberWithUnit(value, true)?.computed ?? 1.0;
        /* fixme: Need CLAMP (Lauris) */
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_R2:
        this.r[1] = parseNumberWithUnit(value, true)?.computed ?? 0.0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        return;
      case SPAttr.SODIPODI_ARG1:
        this.arg[0] = value !== null ? strtod(value) : 0.0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_ARG2:
        this.arg[1] = value !== null ? strtod(value) : 0.0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.INKSCAPE_FLATSIDED:
        if (value === 'true') {
          this.flatsided = true;
          this.sides = Math.max(this.sides, 3);
        } else {
          this.flatsided = false;
        }
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.INKSCAPE_ROUNDED:
        this.rounded = value !== null ? strtod(value) : 0.0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.INKSCAPE_RANDOMIZED:
        this.randomized = value !== null ? strtod(value) : 0.0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    if (
      flags &
      (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      this.set_shape();
    }
    super.update(ctx, flags);
  }

  override set_shape(): void {
    if (this.checkBrokenPathEffect()) return;
    const sides = this.sides;
    const notRounded = Math.abs(this.rounded) < 1e-4;
    const xy = (point: SPStarPoint, i: number) => sp_star_get_xy(this, point, i, true);
    const cp = (point: SPStarPoint, i: number, previ: boolean) =>
      sp_star_get_curvepoint(this, point, i, previ);
    const lineTo = (c: Path, p: Point) => c.appendCurve(new LineSegment(c.finalPoint(), p));
    const curveTo = (c: Path, c1: Point, c2: Point, p: Point) =>
      c.appendCurve(new CubicBezier(c.finalPoint(), c1, c2, p));

    // note that we pass randomized=true to sp_star_get_xy, because the curve must be randomized;
    // other places that call that function (e.g. the knotholder) need the exact point

    // draw 1st segment
    const c = new Path(xy(KNOT1, 0));
    if (!this.flatsided) {
      if (notRounded) lineTo(c, xy(KNOT2, 0));
      else curveTo(c, cp(KNOT1, 0, NEXT), cp(KNOT2, 0, PREV), xy(KNOT2, 0));
    }

    // draw all middle segments
    for (let i = 1; i < sides; i++) {
      if (notRounded) {
        lineTo(c, xy(KNOT1, i));
      } else if (!this.flatsided) {
        curveTo(c, cp(KNOT2, i - 1, NEXT), cp(KNOT1, i, PREV), xy(KNOT1, i));
      } else {
        curveTo(c, cp(KNOT1, i - 1, NEXT), cp(KNOT1, i, PREV), xy(KNOT1, i));
      }

      if (!this.flatsided) {
        if (notRounded) lineTo(c, xy(KNOT2, i));
        else curveTo(c, cp(KNOT1, i, NEXT), cp(KNOT2, i, PREV), xy(KNOT2, i));
      }
    }

    // draw last segment
    if (!notRounded) {
      if (!this.flatsided) {
        curveTo(c, cp(KNOT2, sides - 1, NEXT), cp(KNOT1, 0, PREV), xy(KNOT1, 0));
      } else {
        curveTo(c, cp(KNOT1, sides - 1, NEXT), cp(KNOT1, 0, PREV), xy(KNOT1, 0));
      }
    }

    c.close();
    this.prepareShapeForLPE(c);
  }

  /** Set the star parameters, clamped as the star tool does, and update the display. */
  setPosition(
    sides: number,
    center: Point,
    r1: number,
    r2: number,
    arg1: number,
    arg2: number,
    isflat: boolean,
    rounded: number,
    randomized: number,
  ): void {
    this.flatsided = isflat;
    this.center = center;
    this.r[0] = Math.max(r1, 0.001);
    if (!isflat) {
      this.sides = clamp(sides, 2, 1024);
      this.r[1] = clamp(r2, 0.0, this.r[0]);
    } else {
      this.sides = clamp(sides, 3, 1024);
      this.r[1] = clamp(r1 * Math.cos(Math.PI / sides), 0.0, this.r[0]);
    }
    this.arg[0] = arg1;
    this.arg[1] = arg2;
    this.rounded = rounded;
    this.randomized = randomized;
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  /**
   * Bake a uniform scale and the translation into the center and radii. Returns the rest, which stays in the
   * transform attribute; a non-uniform transform stays there completely.
   */
  override setTransform(xform: Affine): Affine {
    const optTrans = this.randomized === 0;
    // TODO: pathEffectsEnabled() && !optimizeTransforms()

    // Only set transform with proportional scaling
    if (!xform.withoutTranslation().isUniformScale()) return xform;

    /* Calculate star start in parent coords. */
    let pos = this.center.transformed(xform);

    /* This function takes care of translation and scaling, we return whatever parts we can't handle. */
    const r = optTrans ? xform.withoutTranslation() : xform;
    const s = Math.hypot(r.c0, r.c1);
    const ret =
      s > 1e-9
        ? new Affine(r.c0 / s, r.c1 / s, r.c2 / s, r.c3 / s, r.c4, r.c5)
        : new Affine(1.0, 0.0, 0.0, 1.0, r.c4, r.c5);

    this.r[0] *= s;
    this.r[1] *= s;

    /* Find start in item coords */
    pos = pos.transformed(ret.inverse());
    this.center = pos;

    this.set_shape();

    // Adjust stroke width
    this.adjustStroke(s);
    // TODO: adjust_pattern(xform * ret.inverse()), adjust_gradient(xform * ret.inverse())

    return ret;
  }

  /**
   * Calculate the average side length of the polygon.
   *
   * For spoked polygons (stars) this is the radius delta; for non-spoked
   * polygons this is the regular side length directly.
   */
  getSideLength(): number {
    const tr = this.i2docAffine();
    if (!this.flatsided) {
      // Pointy star
      const outer1 = sp_star_get_xy(this, KNOT1, 0, false).transformed(tr);
      const inner1 = sp_star_get_xy(this, KNOT2, 0, false).transformed(tr);
      const outer2 = sp_star_get_xy(this, KNOT1, 1, false).transformed(tr);
      return (distance(outer1, inner1) + distance(inner1, outer2)) / 2.0;
    }
    return distance(
      sp_star_get_xy(this, KNOT1, 0, false).transformed(tr),
      sp_star_get_xy(this, KNOT1, 1, false).transformed(tr),
    );
  }

  /** Set the average side length of the polygon (see getSideLength()). */
  setSideLength(length: number): void {
    const currentLength = this.getSideLength();
    if (currentLength <= 0 || length <= 0) return; // Prevent division by zero or invalid scaling
    const scale = length / currentLength;
    if (!this.flatsided) {
      // Pointy star
      this.r[0] *= scale;
      this.r[1] *= scale;
    } else {
      // Flat star
      this.r[0] *= scale;
    }
    this.updateRepr();
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }
}

lpeItemClasses.SPStar = SPStar;
