// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-ellipse.cpp, src/object/sp-ellipse.h
/*
 * SVG <ellipse> and related implementations
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Mitsuru Oka
 *   bulia byak <buliabyak@users.sf.net>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2013 Tavmjong Bah
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  Affine,
  Angle,
  AngleInterval,
  are_near,
  Ellipse,
  EPSILON,
  LineSegment,
  Path,
  PathVector,
  Point,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { Preferences } from '../preferences.ts';
import { SnapCandidatePoint } from '../snap-candidate.ts';
import { SnapSourceType, SnapTargetType } from '../snap-enums.ts';
import type { SnapPreferences } from '../snap-preferences.ts';
import { SVGLength, spSvgNumberReadD } from '../svg/svg-length.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import type { SPItemCtx } from './sp-item.ts';
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

const SP_2PI = 2 * Math.PI;

export enum GenericEllipseType {
  SP_GENERIC_ELLIPSE_UNDEFINED, // FIXME shouldn't exist
  SP_GENERIC_ELLIPSE_ARC,
  SP_GENERIC_ELLIPSE_CIRCLE,
  SP_GENERIC_ELLIPSE_ELLIPSE,
}

export enum GenericEllipseArcType {
  SP_GENERIC_ELLIPSE_ARC_TYPE_SLICE, // Default
  SP_GENERIC_ELLIPSE_ARC_TYPE_ARC,
  SP_GENERIC_ELLIPSE_ARC_TYPE_CHORD,
}

/**
 * svg:circle, svg:ellipse and svg:path with sodipodi:type="arc" (upstream SPGenericEllipse).
 * The factory sets `type` from the element.
 *
 * TODO: LPE, snap points, adjust_pattern and adjust_gradient in setTransform().
 */
export class SPGenericEllipse extends SPShape {
  // Regardless of type, the ellipse/circle/arc is stored
  // internally with these variables. (Circle radius is rx).
  cx = new SVGLength();
  cy = new SVGLength();
  rx = new SVGLength();
  ry = new SVGLength();

  start = 0;
  end = SP_2PI;
  type = GenericEllipseType.SP_GENERIC_ELLIPSE_UNDEFINED;
  arc_type = GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_SLICE;

  arcType(): GenericEllipseArcType {
    return this.arc_type;
  }
  setArcType(type: GenericEllipseArcType): void {
    this.arc_type = type;
  }

  /** True if the shape is the whole ellipse. */
  is_whole(): boolean {
    return !this.#isSlice();
  }

  /**
   * Ellipse and rect is the only SP object who's repr element tag name changes
   * during it's lifetime. During undo and redo these changes can cause
   * the SP object to become unstuck from the repr's true state.
   */
  protected override tagNameChanged(_oldName: string, newName: string): void {
    if (newName === 'svg:circle') this.type = GenericEllipseType.SP_GENERIC_ELLIPSE_CIRCLE;
    else if (newName === 'svg:ellipse') this.type = GenericEllipseType.SP_GENERIC_ELLIPSE_ELLIPSE;
    else if (newName === 'svg:path') this.type = GenericEllipseType.SP_GENERIC_ELLIPSE_ARC;
    else this.type = GenericEllipseType.SP_GENERIC_ELLIPSE_UNDEFINED;
  }

  protected override build(document: SPDocument, repr: Node): void {
    switch (this.type) {
      case GenericEllipseType.SP_GENERIC_ELLIPSE_ARC:
        this.readAttr(SPAttr.SODIPODI_CX);
        this.readAttr(SPAttr.SODIPODI_CY);
        this.readAttr(SPAttr.SODIPODI_RX);
        this.readAttr(SPAttr.SODIPODI_RY);
        this.readAttr(SPAttr.SODIPODI_START);
        this.readAttr(SPAttr.SODIPODI_END);
        this.readAttr(SPAttr.SODIPODI_OPEN);
        this.readAttr(SPAttr.SODIPODI_ARC_TYPE);
        break;
      case GenericEllipseType.SP_GENERIC_ELLIPSE_CIRCLE:
        this.readAttr(SPAttr.CX);
        this.readAttr(SPAttr.CY);
        this.readAttr(SPAttr.R);
        break;
      case GenericEllipseType.SP_GENERIC_ELLIPSE_ELLIPSE:
        this.readAttr(SPAttr.CX);
        this.readAttr(SPAttr.CY);
        this.readAttr(SPAttr.RX);
        this.readAttr(SPAttr.RY);
        break;
      default:
        console.error('SPGenericEllipse.build() unknown defined type.');
    }
    super.build(document, repr);
  }

  override set(key: SPAttr, value: string | null): void {
    // There are multiple ways to set internal cx, cy, rx, and ry (via SVG attributes or Sodipodi
    // attributes) thus we don't want to unset them if a read fails (e.g., when we explicitly clear
    // an attribute by setting it to NULL).

    // We must update the SVGLengths immediately or nodes may be misplaced after they are moved.
    const w = this.viewport.width();
    const h = this.viewport.height();
    const d = Math.hypot(w, h) / Math.SQRT2; // diagonal
    const em = this.style.font_size.computed;
    const ex = em * 0.5;

    switch (key) {
      case SPAttr.CX:
      case SPAttr.SODIPODI_CX:
        this.cx.readOrUnset(value);
        this.cx.update(em, ex, w);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.CY:
      case SPAttr.SODIPODI_CY:
        this.cy.readOrUnset(value);
        this.cy.update(em, ex, h);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.RX:
      case SPAttr.SODIPODI_RX:
        this.rx.readOrUnset(value);
        this.rx.update(em, ex, w);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.RY:
      case SPAttr.SODIPODI_RY:
        this.ry.readOrUnset(value);
        this.ry.update(em, ex, h);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.R:
        this.rx.readOrUnset(value);
        this.rx.update(em, ex, d);
        this.ry = this.rx.copy();
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_START:
        this.start = value ? (spSvgNumberReadD(value) ?? this.start) : 0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_END:
        this.end = value ? (spSvgNumberReadD(value) ?? this.end) : 2 * Math.PI;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_OPEN:
        // This is for reading in old files.
        if (!value || value !== 'true') {
          // We rely on this to reset arc_type when changing an arc to
          // an ellipse/circle, so it is drawn as a closed path.
          // A clone will not even change it's this->type
          this.arc_type = GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_SLICE;
        } else {
          this.arc_type = GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_ARC;
        }
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SODIPODI_ARC_TYPE:
        // To read in old files that use 'open', we need to not set if value is null.
        // We could also check inkscape version.
        if (value) {
          if (value === 'arc') this.arc_type = GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_ARC;
          else if (value === 'chord') this.arc_type = GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_CHORD;
          else this.arc_type = GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_SLICE;
        }
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
      const viewbox = (ctx as SPItemCtx).viewport;
      const dx = viewbox.width();
      const dy = viewbox.height();
      const dr = Math.hypot(dx, dy) / Math.SQRT2;
      const em = this.style.font_size.computed;
      const ex = em * 0.5; // fixme: get from pango or libnrtype

      this.cx.update(em, ex, dx);
      this.cy.update(em, ex, dy);
      this.rx.update(em, ex, dr);
      this.ry.update(em, ex, dr);

      this.set_shape();
    }
    super.update(ctx, flags);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    let newType: GenericEllipseType;
    if (this.#isSlice() || this.hasPathEffectOnClipOrMaskRecursive(this))
      newType = GenericEllipseType.SP_GENERIC_ELLIPSE_ARC;
    else if (this.rx.computed === this.ry.computed) newType = GenericEllipseType.SP_GENERIC_ELLIPSE_CIRCLE;
    else newType = GenericEllipseType.SP_GENERIC_ELLIPSE_ELLIPSE;

    if (flags & SP_OBJECT_WRITE_BUILD && !repr) {
      repr = xmlDoc.createElement(ELEMENT_OF_TYPE[newType] ?? 'svg:path');
    }
    if (!repr) return null;

    if (this.type !== newType) {
      repr.setCodeUnsafe(ELEMENT_OF_TYPE[newType] ?? 'svg:path');
      this.type = newType;
    }

    // remember these attributes because removeAttribute() may unset them
    const save_cx = this.cx.copy();
    const save_cy = this.cy.copy();
    const save_rx = this.rx.copy();
    const save_ry = this.ry.copy();

    switch (this.type as GenericEllipseType) {
      case GenericEllipseType.SP_GENERIC_ELLIPSE_UNDEFINED:
      case GenericEllipseType.SP_GENERIC_ELLIPSE_ARC:
        repr.removeAttribute('cx');
        repr.removeAttribute('cy');
        repr.removeAttribute('rx');
        repr.removeAttribute('ry');
        repr.removeAttribute('r');

        if (flags & SP_OBJECT_WRITE_EXT) {
          repr.setAttribute('sodipodi:type', 'arc');
          repr.setAttributeSvgLength('sodipodi:cx', save_cx);
          repr.setAttributeSvgLength('sodipodi:cy', save_cy);
          repr.setAttributeSvgLength('sodipodi:rx', save_rx);
          repr.setAttributeSvgLength('sodipodi:ry', save_ry);

          // write start and end only if they are non-trivial; otherwise remove
          if (this.#isSlice()) {
            repr.setAttributeSvgDouble('sodipodi:start', this.start);
            repr.setAttributeSvgDouble('sodipodi:end', this.end);

            switch (this.arc_type) {
              case GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_SLICE:
                repr.removeAttribute('sodipodi:open'); // For backwards compat.
                repr.setAttribute('sodipodi:arc-type', 'slice');
                break;
              case GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_CHORD:
                // A chord's path isn't "open" but its fill most closely resembles an arc.
                repr.setAttribute('sodipodi:open', 'true'); // For backwards compat.
                repr.setAttribute('sodipodi:arc-type', 'chord');
                break;
              case GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_ARC:
                repr.setAttribute('sodipodi:open', 'true'); // For backwards compat.
                repr.setAttribute('sodipodi:arc-type', 'arc');
                break;
            }
          } else {
            repr.removeAttribute('sodipodi:end');
            repr.removeAttribute('sodipodi:start');
            repr.removeAttribute('sodipodi:open');
            repr.removeAttribute('sodipodi:arc-type');
          }
        }

        // write d=
        this.set_elliptical_path_attribute(repr);
        break;

      case GenericEllipseType.SP_GENERIC_ELLIPSE_CIRCLE:
        for (const name of [
          'rx',
          'ry',
          'sodipodi:cx',
          'sodipodi:cy',
          'sodipodi:rx',
          'sodipodi:ry',
          'sodipodi:end',
          'sodipodi:start',
          'sodipodi:open',
          'sodipodi:arc-type',
          'sodipodi:type',
          'd',
        ]) {
          repr.removeAttribute(name);
        }
        repr.setAttributeSvgLength('cx', save_cx);
        repr.setAttributeSvgLength('cy', save_cy);
        repr.setAttributeSvgLength('r', save_rx);
        break;

      case GenericEllipseType.SP_GENERIC_ELLIPSE_ELLIPSE:
        for (const name of [
          'r',
          'sodipodi:cx',
          'sodipodi:cy',
          'sodipodi:rx',
          'sodipodi:ry',
          'sodipodi:end',
          'sodipodi:start',
          'sodipodi:open',
          'sodipodi:arc-type',
          'sodipodi:type',
          'd',
        ]) {
          repr.removeAttribute(name);
        }
        repr.setAttributeSvgLength('cx', save_cx);
        repr.setAttributeSvgLength('cy', save_cy);
        repr.setAttributeSvgLength('rx', save_rx);
        repr.setAttributeSvgLength('ry', save_ry);
        break;
    }

    this.set_shape(); // evaluate curve

    return super.write(xmlDoc, repr, flags);
  }

  override typeName(): string {
    switch (this.type) {
      case GenericEllipseType.SP_GENERIC_ELLIPSE_UNDEFINED:
      case GenericEllipseType.SP_GENERIC_ELLIPSE_ARC:
        return 'arc';
      default:
        return 'circle';
    }
  }

  override displayName(): string {
    switch (this.type) {
      case GenericEllipseType.SP_GENERIC_ELLIPSE_UNDEFINED:
      case GenericEllipseType.SP_GENERIC_ELLIPSE_ARC:
        if (this.#isSlice()) {
          switch (this.arc_type) {
            case GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_SLICE:
              return _('Slice');
            case GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_CHORD:
              return _('Chord');
            case GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_ARC:
              return _('Arc');
          }
        }
        // fallback to ellipse
        return _('Ellipse');
      case GenericEllipseType.SP_GENERIC_ELLIPSE_ELLIPSE:
        return _('Ellipse');
      case GenericEllipseType.SP_GENERIC_ELLIPSE_CIRCLE:
        return _('Circle');
    }
  }

  /** Create the path for rendering the shape on screen. */
  override set_shape(): void {
    if (this.checkBrokenPathEffect()) return;
    if (this.rx.computed <= EPSILON || this.ry.computed <= EPSILON) {
      this.setCurveInsync(null);
      return;
    }

    this.normalize();

    // For simplicity, we use a circle with center (0, 0) and radius 1 for our calculations.
    const circle = new Ellipse(new Point(0, 0), new Point(1, 1), 0);

    if (!this.#isSlice()) {
      this.start = 0.0;
      this.end = 2.0 * Math.PI;
    }
    let incr = this.end - this.start; // arc angle
    if (incr < 0.0) incr += 2.0 * Math.PI;

    let numsegs = 1 + Math.trunc((incr * 2.0) / Math.PI); // number of arc segments
    if (numsegs > 4) numsegs = 4;

    incr = incr / numsegs; // limit arc angle to less than 90 degrees
    const path = new Path(Point.polar(this.start));
    for (let seg = 0; seg < numsegs; seg++) {
      path.appendCurve(
        circle.arc(
          Point.polar(this.start + seg * incr),
          Point.polar(this.start + (seg + 0.5) * incr),
          Point.polar(this.start + (seg + 1.0) * incr),
        ),
      );
    }
    if (this.#isSlice() && this.arc_type === GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_SLICE) {
      path.appendCurve(new LineSegment(path.finalPoint(), new Point(0, 0)));
    }
    // An arc stays open, the others are closed.
    if (this.arc_type !== GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_ARC) path.close();

    // Stretching / moving the calculated shape to fit the actual dimensions.
    const aff = Scale(this.rx.computed, this.ry.computed).multiply(
      Translate(this.cx.computed, this.cy.computed),
    );
    this.prepareShapeForLPE(PathVector.transformed([path], aff));
  }

  /**
   * Bake the scale and translation into the center and radii. Returns the rest
   * (rotation, skew), which stays in the transform attribute.
   */
  override setTransform(xform: Affine): Affine {
    // TODO: pathEffectsEnabled() && !optimizeTransforms()

    // Calculate ellipse start in parent coords.
    let pos = new Point(this.cx.computed, this.cy.computed).transformed(xform);

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

    if (this.rx._set) this.rx.scale(sw);
    if (this.ry._set) this.ry.scale(sh);

    // Find start in item coords
    pos = pos.transformed(ret.inverse());
    this.cx.assign(pos.x);
    this.cy.assign(pos.y);

    this.set_shape();

    const shouldScaleStroke = Preferences.get().getBool('/options/transform/stroke', true);

    // Adjust stroke width
    const arcType = this.getAttribute('sodipodi:arc-type');
    if (shouldScaleStroke && (arcType === 'slice' || arcType === 'chord' || arcType === 'arc')) {
      const expansion = this.transform.descrim();
      this.adjustStrokeWidthRecursive(expansion);
    }
    this.adjustStroke(Math.sqrt(Math.abs(sw * sh)));

    // TODO: adjust_pattern(xform * ret.inverse()), adjust_gradient(xform * ret.inverse())

    return ret;
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

  /** Make sure that start and end lie between 0 and 2 * PI. */
  normalize(): void {
    const a = new AngleInterval(this.start, this.end, true);
    this.start = a.initialAngle().radians0();
    this.end = a.finalAngle().radians0();
  }

  getPointAtAngle(arg: number): Point {
    return Point.polar(arg)
      .transformed(Scale(this.rx.computed, this.ry.computed))
      .transformed(Translate(this.cx.computed, this.cy.computed));
  }

  /** Update the curve and write it as d. */
  set_elliptical_path_attribute(repr: Node): boolean {
    // Make sure our pathvector is up to date.
    this.set_shape();
    if (this._curve) repr.setAttribute('d', sp_svg_write_path(this._curve));
    else repr.removeAttribute('d');
    return true;
  }

  position_set(x: number, y: number, rx: number, ry: number): void {
    this.cx.assign(x);
    this.cy.assign(y);
    this.rx.assign(rx);
    this.ry.assign(ry);

    const prefs = Preferences.get();

    // those pref values are in degrees, while we want radians
    if (prefs.getDouble('/tools/shapes/arc/start', 0.0) !== 0) {
      this.start = Angle.from_degrees(prefs.getDouble('/tools/shapes/arc/start', 0.0)).radians0();
    }
    if (prefs.getDouble('/tools/shapes/arc/end', 0.0) !== 0) {
      this.end = Angle.from_degrees(prefs.getDouble('/tools/shapes/arc/end', 0.0)).radians0();
    }

    this.arc_type = prefs.getInt('/tools/shapes/arc/arc_type', 0) as GenericEllipseArcType;
    if (this.type !== GenericEllipseType.SP_GENERIC_ELLIPSE_ARC && this.#isSlice()) {
      // force an update while creating shapes, so correct rendering is shown initially
      this.updateRepr();
    }

    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  /** Whether the shape is a part of an ellipse. */
  #isSlice(): boolean {
    const a = new AngleInterval(this.start, this.end, true);
    return !(are_near(a.extent(), 0) || are_near(a.extent(), SP_2PI));
  }

  /** The ratio in which a unit vector n is stretched by the transform. */
  static #vectorStretch(n: Point, trans: Affine): number {
    return n.transformed(trans.withoutTranslation()).length();
  }

  setVisibleCx(cx: number): void {
    this.cx.assign(cx / SPGenericEllipse.#vectorStretch(new Point(1, 0), this.i2docAffine()));
    this.updateRepr();
  }
  setVisibleCy(cy: number): void {
    this.cy.assign(cy / SPGenericEllipse.#vectorStretch(new Point(0, 1), this.i2docAffine()));
    this.updateRepr();
  }
  getVisibleCx(): number {
    if (!this.cx._set) return 0;
    return this.cx.computed * SPGenericEllipse.#vectorStretch(new Point(1, 0), this.i2docAffine());
  }
  getVisibleCy(): number {
    if (!this.cy._set) return 0;
    return this.cy.computed * SPGenericEllipse.#vectorStretch(new Point(0, 1), this.i2docAffine());
  }
  setVisibleRx(rx: number): void {
    if (rx === 0) this.rx.unset();
    else this.rx.assign(rx / SPGenericEllipse.#vectorStretch(new Point(1, 0), this.i2docAffine()));
    this.updateRepr();
  }
  setVisibleRy(ry: number): void {
    if (ry === 0) this.ry.unset();
    else this.ry.assign(ry / SPGenericEllipse.#vectorStretch(new Point(0, 1), this.i2docAffine()));
    this.updateRepr();
  }
  getVisibleRx(): number {
    if (!this.rx._set) return 0;
    return this.rx.computed * SPGenericEllipse.#vectorStretch(new Point(1, 0), this.i2docAffine());
  }
  getVisibleRy(): number {
    if (!this.ry._set) return 0;
    return this.ry.computed * SPGenericEllipse.#vectorStretch(new Point(0, 1), this.i2docAffine());
  }

  /** The quadrant points within the arc, the center and the end points of slices as snap points. */
  override snappoints(p: SnapCandidatePoint[], snapprefs: SnapPreferences): void {
    this.normalize();
    const i2dt = this.i2dtAffine();
    const add = (pt: Point, s: SnapSourceType, t: SnapTargetType) =>
      p.push(new SnapCandidatePoint(pt.transformed(i2dt), s, t));
    // Snap to the 4 quadrant points of the ellipse, but only if the arc
    // spans far enough to include them
    if (snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_ELLIPSE_QUADRANT_POINT)) {
      for (let angle = 0; angle < SP_2PI; angle += Math.PI / 2) {
        if (new AngleInterval(this.start, this.end, true).contains(new Angle(angle))) {
          add(
            this.getPointAtAngle(angle),
            SnapSourceType.SNAPSOURCE_ELLIPSE_QUADRANT_POINT,
            SnapTargetType.SNAPTARGET_ELLIPSE_QUADRANT_POINT,
          );
        }
      }
    }
    const center = new Point(this.cx.computed, this.cy.computed);
    const slice = this.#isSlice();
    const cusp = snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_NODE_CUSP);
    // Add the centre, if we have a closed slice or when explicitly asked for
    if (cusp && slice && this.arc_type === GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_SLICE) {
      add(center, SnapSourceType.SNAPSOURCE_NODE_CUSP, SnapTargetType.SNAPTARGET_NODE_CUSP);
    }
    if (snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_OBJECT_MIDPOINT)) {
      add(center, SnapSourceType.SNAPSOURCE_OBJECT_MIDPOINT, SnapTargetType.SNAPTARGET_OBJECT_MIDPOINT);
    }
    // And if we have a slice, also snap to the endpoints
    if (cusp && slice) {
      // Add the start point, if it's not coincident with a quadrant point
      if (!are_near(this.start % (Math.PI / 2), 0)) {
        add(
          this.getPointAtAngle(this.start),
          SnapSourceType.SNAPSOURCE_NODE_CUSP,
          SnapTargetType.SNAPTARGET_NODE_CUSP,
        );
      }
      // Add the end point, if it's not coincident with a quadrant point
      if (!are_near(this.end % (Math.PI / 2), 0)) {
        add(
          this.getPointAtAngle(this.end),
          SnapSourceType.SNAPSOURCE_NODE_CUSP,
          SnapTargetType.SNAPTARGET_NODE_CUSP,
        );
      }
    }
  }
}

/** Element name by type, for write(). */
const ELEMENT_OF_TYPE: Partial<Record<GenericEllipseType, string>> = {
  [GenericEllipseType.SP_GENERIC_ELLIPSE_ARC]: 'svg:path',
  [GenericEllipseType.SP_GENERIC_ELLIPSE_CIRCLE]: 'svg:circle',
  [GenericEllipseType.SP_GENERIC_ELLIPSE_ELLIPSE]: 'svg:ellipse',
};

lpeItemClasses.SPGenericEllipse = SPGenericEllipse;
