// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-rect.cpp, src/object/sp-rect.h
/*
 * SVG <rect> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  Affine,
  CubicBezier,
  distance,
  LineSegment,
  Path,
  PathBuilder,
  Point,
  Rect,
} from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { SnapCandidatePoint } from '../snap-candidate.ts';
import { SnapSourceType, SnapTargetType } from '../snap-enums.ts';
import type { SnapPreferences } from '../snap-preferences.ts';
import { SVGLength } from '../svg/svg-length.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import type { SPItemCtx } from './sp-item.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_USER_MODIFIED_FLAG_B,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
} from './sp-object.ts';
import { SPShape } from './sp-shape.ts';

/** Upstream: GenericRectType. The element the rect is written as. */
export enum GenericRectType {
  SP_GENERIC_RECT_UNDEFINED,
  SP_GENERIC_RECT,
  SP_GENERIC_PATH,
}

/** Control point factor of a cubic Bezier that approximates a quarter circle. */
const C1 = 0.554;

/** Append a line from the end of the path to p. */
function lineTo(c: Path, p: Point): void {
  c.appendCurve(new LineSegment(c.finalPoint(), p));
}

/** Append a cubic Bezier from the end of the path. */
function curveTo(c: Path, c1: Point, c2: Point, p: Point): void {
  c.appendCurve(new CubicBezier(c.finalPoint(), c1, c2, p));
}

/**
 * svg:rect (upstream SPRect).
 *
 * TODO: LPE (the path is written as svg:path for clips and masks with an effect),
 * snap points, convert_to_guides, adjust_pattern and adjust_gradient in setTransform().
 */
export class SPRect extends SPShape {
  type = GenericRectType.SP_GENERIC_RECT_UNDEFINED;

  x = new SVGLength();
  y = new SVGLength();
  width = new SVGLength();
  height = new SVGLength();
  rx = new SVGLength();
  ry = new SVGLength();

  override typeName(): string {
    return 'rect';
  }
  override displayName(): string {
    return _('Rectangle');
  }

  /**
   * Ellipse and rects are the only SP object who's repr element tag name changes
   * during it's lifetime. During undo and redo these changes can cause
   * the SP object to become unstuck from the repr's true state.
   */
  protected override tagNameChanged(_oldName: string, newName: string): void {
    if (newName === 'svg:rect') this.type = GenericRectType.SP_GENERIC_RECT;
    else if (newName === 'svg:path') this.type = GenericRectType.SP_GENERIC_PATH;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.WIDTH);
    this.readAttr(SPAttr.HEIGHT);
    this.readAttr(SPAttr.RX);
    this.readAttr(SPAttr.RY);
  }

  override set(key: SPAttr, value: string | null): void {
    // We must update the SVGLengths immediately or nodes may be misplaced after they are moved.
    const w = this.viewport.width();
    const h = this.viewport.height();
    const em = this.style.font_size.computed;
    const ex = em * 0.5;

    switch (key) {
      case SPAttr.X:
        this.x.readOrUnset(value);
        this.x.update(em, ex, w);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y:
        this.y.readOrUnset(value);
        this.y.update(em, ex, h);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.WIDTH:
        if (!this.width.read(value) || this.width.value < 0.0) this.width.unset();
        this.width.update(em, ex, w);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.HEIGHT:
        if (!this.height.read(value) || this.height.value < 0.0) this.height.unset();
        this.height.update(em, ex, h);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.RX:
        if (!this.rx.read(value) || this.rx.value <= 0.0) this.rx.unset();
        this.rx.update(em, ex, w);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.RY:
        if (!this.ry.read(value) || this.ry.value <= 0.0) this.ry.unset();
        this.ry.update(em, ex, h);
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
      const ictx = ctx as SPItemCtx;
      const w = ictx.viewport.width();
      const h = ictx.viewport.height();
      const em = this.style.font_size.computed;
      const ex = 0.5 * em; // fixme: get x height from pango or libnrtype.

      this.x.update(em, ex, w);
      this.y.update(em, ex, h);
      this.width.update(em, ex, w);
      this.height.update(em, ex, h);
      this.rx.update(em, ex, w);
      this.ry.update(em, ex, h);
      this.set_shape();

      flags &= ~SP_OBJECT_USER_MODIFIED_FLAG_B; // since we change the description, it's not a "just translation" anymore
    }
    super.update(ctx, flags);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    // TODO: svg:path with sodipodi:type="rect" when a clip or mask has a path effect.
    const newType: GenericRectType = GenericRectType.SP_GENERIC_RECT;
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:rect');
    if (!repr) return null;
    if (this.type !== newType) {
      repr.setCodeUnsafe('svg:rect');
      this.type = newType;
    }
    repr.setAttributeSvgLength('width', this.width);
    repr.setAttributeSvgLength('height', this.height);
    if (this.rx._set) repr.setAttributeSvgLength('rx', this.rx);
    if (this.ry._set) repr.setAttributeSvgLength('ry', this.ry);
    repr.setAttributeSvgLength('x', this.x);
    repr.setAttributeSvgLength('y', this.y);
    // write d=
    if ((this.type as GenericRectType) === GenericRectType.SP_GENERIC_PATH)
      this.set_rect_path_attribute(repr);
    else this.set_shape(); // evaluate curve
    return super.write(xmlDoc, repr, flags);
  }

  override set_shape(): void {
    // TODO: checkBrokenPathEffect()
    if (this.height.computed < 1e-18 || this.width.computed < 1e-18) {
      this.setCurveInsync(null);
      return;
    }

    const x = this.x.computed;
    const y = this.y.computed;
    const w = this.width.computed;
    const h = this.height.computed;
    const w2 = w / 2;
    const h2 = h / 2;
    const rx = Math.min(
      this.rx._set ? this.rx.computed : this.ry._set ? this.ry.computed : 0.0,
      0.5 * this.width.computed,
    );
    const ry = Math.min(
      this.ry._set ? this.ry.computed : this.rx._set ? this.rx.computed : 0.0,
      0.5 * this.height.computed,
    );
    // TODO: Handle negative rx or ry as per
    // http://www.w3.org/TR/SVG11/shapes.html#RectElementRXAttribute

    // We don't use proper circular/elliptical arcs, but bezier curves can approximate a 90-degree
    // arc fairly well.
    let c: Path;
    if (rx > 1e-18 && ry > 1e-18) {
      c = new Path(new Point(x + rx, y));
      if (rx < w2) lineTo(c, new Point(x + w - rx, y));
      curveTo(
        c,
        new Point(x + w - rx * (1 - C1), y),
        new Point(x + w, y + ry * (1 - C1)),
        new Point(x + w, y + ry),
      );
      if (ry < h2) lineTo(c, new Point(x + w, y + h - ry));
      curveTo(
        c,
        new Point(x + w, y + h - ry * (1 - C1)),
        new Point(x + w - rx * (1 - C1), y + h),
        new Point(x + w - rx, y + h),
      );
      if (rx < w2) lineTo(c, new Point(x + rx, y + h));
      curveTo(
        c,
        new Point(x + rx * (1 - C1), y + h),
        new Point(x, y + h - ry * (1 - C1)),
        new Point(x, y + h - ry),
      );
      if (ry < h2) lineTo(c, new Point(x, y + ry));
      curveTo(c, new Point(x, y + ry * (1 - C1)), new Point(x + rx * (1 - C1), y), new Point(x + rx, y));
      c.close();
    } else {
      const pb = new PathBuilder();
      pb.feedRect(Rect.fromXywh(x, y, w, h));
      c = pb.peek()[0] as Path;
    }

    this.prepareShapeForLPE(c);
  }

  /** Update the curve and write it as d. */
  set_rect_path_attribute(repr: Node): boolean {
    // Make sure our pathvector is up to date.
    this.set_shape();
    if (this._curve) repr.setAttribute('d', sp_svg_write_path(this._curve));
    else repr.removeAttribute('d');
    return true;
  }

  protected override modified(flags: number): void {
    if (
      flags &
      (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      this.set_shape();
    }
    super.modified(flags);
  }

  setPosition(x: number, y: number, width: number, height: number): void {
    this.x.assign(x);
    this.y.assign(y);
    this.width.assign(width);
    this.height.assign(height);
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  setRx(set: boolean, value: number): void {
    this.rx._set = set;
    if (set) this.rx.assign(value);
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  setRy(set: boolean, value: number): void {
    this.ry._set = set;
    if (set) this.ry.assign(value);
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  /**
   * Bake the scale and translation into x, y, width, height, rx and ry. Returns the rest
   * (rotation, skew), which stays in the transform attribute.
   */
  override setTransform(xform: Affine): Affine {
    // TODO: pathEffectsEnabled() && !optimizeTransforms()
    // Calculate rect start in parent coords.
    let pos = new Point(this.x.computed, this.y.computed).transformed(xform);

    // This function takes care of translation and scaling, we return whatever parts we can't handle.
    const r = xform.withoutTranslation();
    const sw = Math.hypot(r.c0, r.c1);
    const sh = Math.hypot(r.c2, r.c3);
    const ret = new Affine(
      sw > 1e-9 ? r.c0 / sw : 1.0,
      sw > 1e-9 ? r.c1 / sw : 0.0,
      sh > 1e-9 ? r.c2 / sh : 0.0,
      sh > 1e-9 ? r.c3 / sh : 1.0,
      0,
      0,
    );

    // Preserve units
    this.width.scale(sw);
    this.height.scale(sh);
    if (this.rx._set) this.rx.scale(sw);
    if (this.ry._set) this.ry.scale(sh);

    // Find start in item coords
    pos = pos.transformed(ret.inverse());
    this.x.assign(pos.x);
    this.y.assign(pos.y);

    this.set_shape();

    // Adjust stroke width
    this.adjustStroke(Math.sqrt(Math.abs(sw * sh)));
    // TODO: adjust_pattern(xform * ret.inverse()), adjust_gradient(xform * ret.inverse())

    return ret;
  }

  /** The ratio in which the vector from p0 to p1 is stretched by transform. */
  static vectorStretch(p0: Point, p1: Point, xform: Affine): number {
    if (p0.equals(p1)) return 0;
    return distance(p0.transformed(xform), p1.transformed(xform)) / distance(p0, p1);
  }

  /** Stretch of the x axis at (x, y) from item to document coordinates. */
  #stretchX(): number {
    const p = new Point(this.x.computed, this.y.computed);
    return SPRect.vectorStretch(new Point(p.x + 1, p.y), p, this.i2docAffine());
  }
  /** Stretch of the y axis at (x, y) from item to document coordinates. */
  #stretchY(): number {
    const p = new Point(this.x.computed, this.y.computed);
    return SPRect.vectorStretch(new Point(p.x, p.y + 1), p, this.i2docAffine());
  }

  setVisibleRx(rx: number): void {
    if (rx === 0) this.rx.unset();
    else this.rx.assign(rx / this.#stretchX());
    this.updateRepr();
  }

  setVisibleRy(ry: number): void {
    if (ry === 0) this.ry.unset();
    else this.ry.assign(ry / this.#stretchY());
    this.updateRepr();
  }

  getVisibleRx(): number {
    return this.rx._set ? this.rx.computed * this.#stretchX() : 0;
  }

  getVisibleRy(): number {
    return this.ry._set ? this.ry.computed * this.#stretchY() : 0;
  }

  setVisibleWidth(width: number): void {
    this.width.assign(width / this.#stretchX());
    this.updateRepr();
  }

  setVisibleHeight(height: number): void {
    this.height.assign(height / this.#stretchY());
    this.updateRepr();
  }

  getVisibleWidth(): number {
    return this.width._set ? this.width.computed * this.#stretchX() : 0;
  }

  getVisibleHeight(): number {
    return this.height._set ? this.height.computed * this.#stretchY() : 0;
  }

  getRect(): Rect {
    const p0 = new Point(this.x.computed, this.y.computed);
    const p2 = new Point(this.x.computed + this.width.computed, this.y.computed + this.height.computed);
    return new Rect(p0, p2);
  }

  /** Change rx and ry so that they keep their visible size after xform (applied after the item transform). */
  compensateRxRy(xform: Affine): void {
    if (this.rx.computed === 0 && this.ry.computed === 0) return; // nothing to compensate

    // test unit vectors to find out compensation:
    let c = new Point(this.x.computed, this.y.computed);
    let cx = c.add(new Point(1, 0));
    let cy = c.add(new Point(0, 1));

    // apply previous transform if any
    c = c.transformed(this.transform);
    cx = cx.transformed(this.transform);
    cy = cy.transformed(this.transform);

    // find out stretches that we need to compensate
    const eX = SPRect.vectorStretch(cx, c, xform);
    const eY = SPRect.vectorStretch(cy, c, xform);

    // If only one of the radii is set, set both radii so they have the same visible length
    // This is needed because if we just set them the same length in SVG, they might end up unequal because of transform
    if (this.rx._set !== this.ry._set) {
      const r = Math.max(this.rx.computed, this.ry.computed);
      this.rx.assign(r / eX);
      this.ry.assign(r / eY);
    } else {
      this.rx.assign(this.rx.computed / eX);
      this.ry.assign(this.ry.computed / eY);
    }
    // Note that a radius may end up larger than half-side if the rect is scaled down;
    // that's ok because this preserves the intended radii in case the rect is enlarged again,
    // and set_shape will take care of trimming too large radii when generating d=
  }

  /**
   * The real corners of the rect as snap points, not the eight points of the
   * rounded rect path, plus the edge midpoints and the object midpoint.
   */
  override snappoints(p: SnapCandidatePoint[], snapprefs: SnapPreferences): void {
    const i2dt = this.i2dtAffine();
    const { x, y, width, height } = this;
    const p0 = new Point(x.computed, y.computed).transformed(i2dt);
    const p1 = new Point(x.computed, y.computed + height.computed).transformed(i2dt);
    const p2 = new Point(x.computed + width.computed, y.computed + height.computed).transformed(i2dt);
    const p3 = new Point(x.computed + width.computed, y.computed).transformed(i2dt);
    const add = (pt: Point, s: SnapSourceType, t: SnapTargetType) => p.push(new SnapCandidatePoint(pt, s, t));
    if (snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_RECT_CORNER)) {
      for (const c of [p0, p1, p2, p3])
        add(c, SnapSourceType.SNAPSOURCE_RECT_CORNER, SnapTargetType.SNAPTARGET_RECT_CORNER);
    }
    if (snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_LINE_MIDPOINT)) {
      for (const [a, b] of [
        [p0, p1],
        [p1, p2],
        [p2, p3],
        [p3, p0],
      ] as const) {
        add(
          a.add(b).div(2),
          SnapSourceType.SNAPSOURCE_LINE_MIDPOINT,
          SnapTargetType.SNAPTARGET_LINE_MIDPOINT,
        );
      }
    }
    if (snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_OBJECT_MIDPOINT)) {
      add(
        p0.add(p2).div(2),
        SnapSourceType.SNAPSOURCE_OBJECT_MIDPOINT,
        SnapTargetType.SNAPTARGET_OBJECT_MIDPOINT,
      );
    }
  }
}
