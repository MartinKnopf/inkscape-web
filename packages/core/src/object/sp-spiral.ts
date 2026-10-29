// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-spiral.cpp, src/object/sp-spiral.h
/*
 * <sodipodi:spiral> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Affine, bezier_fit_cubic_full, CubicBezier, LineSegment, Path, Point } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { parseNumberWithUnit, spSvgNumberReadD } from '../svg/svg-length.ts';
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
import { SP_SHAPE_WRITE_PATH, SPShape } from './sp-shape.ts';

const SP_EPSILON = 1e-5;
const SP_HUGE = 1e5;

const SPIRAL_TOLERANCE = 3.0;
/** Step per 2PI */
const SAMPLE_STEP = 1.0 / 4.0;
/** Sample size per one bezier */
const SAMPLE_SIZE = 8;

const BEZIER_SIZE = 4;
const FITTING_MAX_BEZIERS = 4;
const BEZIER_LENGTH = BEZIER_SIZE * FITTING_MAX_BEZIERS;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * <sodipodi:spiral> on svg:path (upstream SPSpiral).
 *
 * The Spiral shape is defined as:
 *   x = cx + rad * t^exp * cos(2 pi revo t + arg), y = cy + rad * t^exp * sin(2 pi revo t + arg),
 * for t from t0 to 1.
 *
 * TODO: LPE, snap points, adjust_pattern and adjust_gradient in setTransform().
 */
export class SPSpiral extends SPShape {
  cx = 0;
  cy = 0;
  /** Spiral expansion factor */
  exp = 1;
  /** Spiral revolution factor */
  revo = 3;
  rad = 1;
  arg = 0;
  t0 = 0;

  override typeName(): string {
    return 'spiral';
  }
  override displayName(): string {
    return _('Spiral');
  }
  override description(): string {
    // TRANSLATORS: since turn count isn't an integer, please adjust the
    // string as needed to deal with an localized plural forms.
    return _('with %3f turns').replace('%3f', this.revo.toFixed(6));
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.SODIPODI_CX);
    this.readAttr(SPAttr.SODIPODI_CY);
    this.readAttr(SPAttr.SODIPODI_EXPANSION);
    this.readAttr(SPAttr.SODIPODI_REVOLUTION);
    this.readAttr(SPAttr.SODIPODI_RADIUS);
    this.readAttr(SPAttr.SODIPODI_ARGUMENT);
    this.readAttr(SPAttr.SODIPODI_T0);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:path');
    if (!repr) return null;

    if (flags & SP_OBJECT_WRITE_EXT) {
      /* Fixme: we may replace these attributes by
       * sodipodi:spiral="cx cy exp revo rad arg t0"
       */
      repr.setAttribute('sodipodi:type', 'spiral');
      repr.setAttributeSvgDouble('sodipodi:cx', this.cx);
      repr.setAttributeSvgDouble('sodipodi:cy', this.cy);
      repr.setAttributeSvgDouble('sodipodi:expansion', this.exp);
      repr.setAttributeSvgDouble('sodipodi:revolution', this.revo);
      repr.setAttributeSvgDouble('sodipodi:radius', this.rad);
      repr.setAttributeSvgDouble('sodipodi:argument', this.arg);
      repr.setAttributeSvgDouble('sodipodi:t0', this.t0);
    }

    // make sure the curve is rebuilt with all up-to-date parameters
    this.set_shape();

    // Nulls might be possible if this called iteratively
    if (!this._curve) return null;

    repr.setAttribute('d', sp_svg_write_path(this._curve));

    return super.write(xmlDoc, repr, flags | SP_SHAPE_WRITE_PATH);
  }

  override set(key: SPAttr, value: string | null): void {
    /** @todo fixme: we should really collect updates */
    switch (key) {
      case SPAttr.SODIPODI_CX:
        this.cx = parseNumberWithUnit(value, false)?.computed ?? 0.0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_CY:
        this.cy = parseNumberWithUnit(value, false)?.computed ?? 0.0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_EXPANSION: {
        const v = spSvgNumberReadD(value);
        this.exp = v !== null ? clamp(v, 0.0, 1000.0) : 1.0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      }
      case SPAttr.SODIPODI_REVOLUTION: {
        const v = spSvgNumberReadD(value);
        this.revo = v !== null ? clamp(v, 0.05, 1024.0) : 3.0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      }
      case SPAttr.SODIPODI_RADIUS: {
        const v = parseNumberWithUnit(value, false);
        this.rad = v ? v.computed : Math.max(this.rad, 0.001);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      }
      case SPAttr.SODIPODI_ARGUMENT:
        this.arg = spSvgNumberReadD(value) ?? 0.0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_T0: {
        const v = spSvgNumberReadD(value);
        // The upper bound keeps getXY() away from NaN (pow of a negative number).
        this.t0 = v !== null ? clamp(v, 0.0, 0.999) : 0.0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      }
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

  /**
   * Fit beziers together to spiral and draw it.
   * Starts at parameter t with tangent hat1 and returns the end parameter t and the end tangent hat2.
   *
   * pre dstep > 0, hat1 is a unit vector. post hat2 is a unit vector.
   */
  fitAndDraw(c: Path, dstep: number, darray: Point[], hat1: Point, t: number): { t: number; hat2: Point } {
    if (!(dstep > 0)) throw new Error('fitAndDraw: dstep must be positive');
    const bezier: Point[] = new Array<Point>(BEZIER_LENGTH).fill(new Point(0, 0));

    let d = t;
    for (let i = 0; i <= SAMPLE_SIZE; d += dstep, i++) {
      darray[i] = this.getXY(d);

      /* Avoid useless adjacent dups.  (Otherwise we can have all of darray filled with
         the same value, which upsets chord_length_parameterize.) */
      if (i !== 0 && darray[i]?.equals(darray[i - 1] as Point) && d < 1.0) {
        i--;
        d += dstep;
        /* We mustn't increase dstep for subsequent values of
         * i: for large spiral.exp values, rate of growth
         * increases very rapidly.
         */
        // TODO (upstream): Get the function itself to decide what value of d to use next:
        // ensure that we move at least 0.25 * stroke width, for example.
      }
    }

    const nextT = d - 2 * dstep;
    /* == t + (SAMPLE_SIZE - 1) * dstep, in absence of dups. */

    const hat2 = this.getTangent(nextT).neg();

    // TODO (upstream): We should use better algorithm to specify maximum error.
    const depth = bezier_fit_cubic_full(
      bezier,
      null,
      darray,
      SAMPLE_SIZE,
      hat1,
      hat2,
      SPIRAL_TOLERANCE * SPIRAL_TOLERANCE,
      FITTING_MAX_BEZIERS,
    );

    if (depth !== -1) {
      for (let i = 0; i < 4 * depth; i += 4) {
        c.appendCurve(
          new CubicBezier(
            c.finalPoint(),
            bezier[i + 1] as Point,
            bezier[i + 2] as Point,
            bezier[i + 3] as Point,
          ),
        );
      }
    } else {
      for (let i = 1; i < SAMPLE_SIZE; i++) {
        c.appendCurve(new LineSegment(c.finalPoint(), darray[i] as Point));
      }
    }

    return { t: nextT, hat2 };
  }

  override set_shape(): void {
    if (this.checkBrokenPathEffect()) return;
    const darray: Point[] = new Array<Point>(SAMPLE_SIZE + 1).fill(new Point(0, 0));

    this.requestModified(SP_OBJECT_MODIFIED_FLAG);

    /* Initial moveto. */
    const c = new Path(this.getXY(this.t0));

    const tstep = SAMPLE_STEP / this.revo;
    const dstep = tstep / (SAMPLE_SIZE - 1);

    let hat1 = this.getTangent(this.t0);
    let t = this.t0;
    while (t < 1.0 - tstep) {
      const r = this.fitAndDraw(c, dstep, darray, hat1, t);
      t = r.t;
      hat1 = r.hat2.neg();
    }
    if (1.0 - t > SP_EPSILON) {
      this.fitAndDraw(c, (1.0 - t) / (SAMPLE_SIZE - 1.0), darray, hat1, t);
    }

    this.prepareShapeForLPE(c);
  }

  /** Set spiral properties and update display. */
  setPosition(cx: number, cy: number, exp: number, revo: number, rad: number, arg: number, t0: number): void {
    // TODO (upstream): Consider applying CLAMP or adding in-bounds assertions for some of these parameters.
    this.cx = cx;
    this.cy = cy;
    this.exp = exp;
    this.revo = revo;
    this.rad = Math.max(rad, 0.0);
    this.arg = arg;
    this.t0 = clamp(t0, 0.0, 0.999);
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  /**
   * Bake a uniform scale and the translation into the center and radius. Returns the rest, which stays in the
   * transform attribute; a non-uniform transform stays there completely.
   */
  override setTransform(xform: Affine): Affine {
    // TODO: pathEffectsEnabled() && !optimizeTransforms()

    // Only set transform with proportional scaling
    if (!xform.withoutTranslation().isUniformScale()) return xform;

    /* Calculate spiral start in parent coords. */
    let pos = new Point(this.cx, this.cy).transformed(xform);

    /* This function takes care of translation and scaling, we return whatever parts we can't handle. */
    const r = xform.withoutTranslation();
    const s = Math.hypot(r.c0, r.c1);
    const ret =
      s > 1e-9
        ? new Affine(r.c0 / s, r.c1 / s, r.c2 / s, r.c3 / s, 0, 0)
        : new Affine(1.0, 0.0, 0.0, 1.0, 0, 0);

    this.rad *= s;

    /* Find start in item coords */
    pos = pos.transformed(ret.inverse());
    this.cx = pos.x;
    this.cy = pos.y;

    this.set_shape();

    // Adjust stroke width
    this.adjustStroke(s);
    // TODO: adjust_pattern(xform * ret.inverse()), adjust_gradient(xform * ret.inverse())

    return ret;
  }

  /**
   * Return one of the points on the spiral.
   *
   * @param t specifies how far along the spiral. In [0.0, 2.03]. (It doesn't make sense for t to be much more
   * than 1.0, though some callers go slightly beyond 1.0 for curve-fitting purposes.)
   */
  getXY(t: number): Point {
    // exp is in [0, 1000]: otherwise we get NaN for t == 0 or infinities.
    // t >= 0: any callers passing -ve t will have a bug for non-integral values of exp.
    const rad = this.rad * t ** this.exp;
    const arg = 2.0 * Math.PI * this.revo * t + this.arg;
    return new Point(rad * Math.cos(arg) + this.cx, rad * Math.sin(arg) + this.cy);
  }

  /**
   * Returns the derivative of getXY() with respect to t, scaled to a unit vector.
   */
  getTangent(t: number): Point {
    const tScaled = 2.0 * Math.PI * this.revo * t;
    const arg = tScaled + this.arg;
    const s = Math.sin(arg);
    const c = Math.cos(arg);
    if (this.exp === 0.0) return new Point(-s, c);
    if (tScaled === 0.0) return new Point(c, s);

    const unrotated = new Point(this.exp, tScaled);
    const sLen = unrotated.length();
    const u = unrotated.div(sLen);
    /* ret = spiral->exp * (c, s) + t_scaled * (-s, c);
       alternatively ret = (spiral->exp, t_scaled) * (( c, s),
                              (-s, c)).*/
    /* ret should already be approximately normalized: the matrix ((c, -s), (s, c)) is orthogonal
       (it just rotates by arg), and unrotated has been normalized, so ret is already of unit
       length other than numerical error in the above matrix multiplication. */
    return new Point(u.dot(new Point(c, -s)), u.dot(new Point(s, c))).normalized();
  }

  /** Compute rad and arg for the point on the spiral at t. */
  getPolar(t: number): { rad: number; arg: number } {
    return {
      rad: this.rad * t ** this.exp,
      arg: 2.0 * Math.PI * this.revo * t + this.arg,
    };
  }

  /** Return true if spiral has properties that make it invalid. */
  isInvalid(): boolean {
    let rad = this.getPolar(0.0).rad;
    if (rad < 0.0 || rad > SP_HUGE) {
      console.warn(`rad(t=0)=${rad}`);
      return true;
    }
    rad = this.getPolar(1.0).rad;
    if (rad < 0.0 || rad > SP_HUGE) {
      console.warn(`rad(t=1)=${rad}`);
      return true;
    }
    return false;
  }
}

lpeItemClasses.SPSpiral = SPSpiral;
