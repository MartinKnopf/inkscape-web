// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-gradient.cpp, src/object/sp-gradient.h, src/object/sp-gradient-reference.cpp, src/object/sp-gradient-reference.h
/*
 * SPGradient, SPStop, SPLinearGradient, SPRadialGradient,
 * SPMeshGradient, SPMeshRow, SPMeshPatch
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jasper van de Gronde <th.v.d.gronde@hccnet.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Tavmjong Bah <tavmjong@free.fr>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2004 David Turner
 * Copyright (C) 2009 Jasper van de Gronde
 * Copyright (C) 2011 Tavmjong Bah
 */
import { Affine, type Rect, Scale, Translate } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { cssNumber } from '../svg/css-ostringstream.ts';
import { sp_svg_transform_read, sp_svg_transform_write } from '../svg/svg-affine.ts';
import type { SVGLength } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import { getHrefAttribute, setHrefAttribute } from '../xml/href-attribute-helper.ts';
import type { Node } from '../xml/node.ts';
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_FLAGS_ALL,
  SP_OBJECT_MODIFIED_CASCADE,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_PARENT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_WRITE_ALL,
  SP_OBJECT_WRITE_BUILD,
  SP_OBJECT_WRITE_EXT,
  type SPCtx,
  type SPObject,
} from './sp-object.ts';
import { SPPaintServer } from './sp-paint-server.ts';
import {
  SPGradientSpread,
  type SPGradientStop,
  SPGradientUnits,
  type SPGradientVector,
} from './sp-paint-server-data.ts';
import { SPStop } from './sp-stop.ts';
import { URIReference } from './uri-references.ts';

export enum SPGradientType {
  SP_GRADIENT_TYPE_UNKNOWN,
  SP_GRADIENT_TYPE_LINEAR,
  SP_GRADIENT_TYPE_RADIAL,
  SP_GRADIENT_TYPE_MESH,
}

export enum SPGradientState {
  SP_GRADIENT_STATE_UNKNOWN,
  SP_GRADIENT_STATE_VECTOR,
  SP_GRADIENT_STATE_PRIVATE,
}

/** The handles of the gradient tool (upstream GrPointType). */
export enum GrPointType {
  POINT_LG_BEGIN = 0,
  POINT_LG_END,
  POINT_LG_MID,
  POINT_RG_CENTER,
  POINT_RG_R1,
  POINT_RG_R2,
  POINT_RG_FOCUS,
  POINT_RG_MID1,
  POINT_RG_MID2,
  POINT_MG_CORNER,
  POINT_MG_HANDLE,
  POINT_MG_TENSOR,
  // insert new point types here.
  POINT_G_INVALID,
}

/** Fill or stroke (upstream Inkscape::PaintTarget). */
export enum PaintTarget {
  FOR_FILL,
  FOR_STROKE,
}

/** All values of PaintTarget (upstream allPaintTargets). */
export function allPaintTargets(): readonly PaintTarget[] {
  return [PaintTarget.FOR_FILL, PaintTarget.FOR_STROKE];
}

/** The xlink:href of a gradient (upstream SPGradientReference): accepts only gradients. */
export class SPGradientReference extends URIReference {
  override getObject(): SPGradient | null {
    return super.getObject() as SPGradient | null;
  }
  protected override _acceptObject(obj: SPObject): boolean {
    return obj instanceof SPGradient && super._acceptObject(obj);
  }
}

/**
 * Base class of linear and radial gradients (upstream SPGradient): spread, units, transform,
 * stops, and the href to the gradient that gives the stops (the "vector").
 *
 * Terminology (see gradient-chemistry.ts): a "vector" has stops but no position; a "private"
 * has a position, no stops, and references a vector; each private is used by one object.
 * TODO: mesh gradients, swatch resources (document->addResource), isEquivalent/isAligned,
 * previews.
 */
export class SPGradient extends SPPaintServer {
  /** gradientUnits attribute */
  protected units = SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX;
  protected units_set = false;
  /** gradientTransform attribute */
  gradientTransform = Affine.identity();
  gradientTransform_set = false;
  /** spreadMethod attribute */
  #spread = SPGradientSpread.SP_GRADIENT_SPREAD_PAD;
  #spread_set = false;
  /** Gradient stops */
  #has_stops = false;
  /** Pinned in swatches dialog */
  #pinned = false;
  /** Reference (href) */
  readonly ref: SPGradientReference = new SPGradientReference(this);
  /** State in Inkscape gradient system */
  state = SPGradientState.SP_GRADIENT_STATE_UNKNOWN;
  /** Composed vector */
  readonly vector: SPGradientVector = { built: false, stops: [], geom: [] };
  #modified_connection: (() => void) | null = null;

  constructor() {
    super();
    this.ref.changedSignal.connect((old, ref) => SPGradient.gradientRefChanged(old, ref, this));
  }

  /**
   * The first of this, its href, the href of its href, ... for which match is true, or null.
   * Handles cycles in the href chain (upstream chase_hrefs).
   */
  protected static chase_hrefs(src: SPGradient, match: (g: SPGradient) => boolean): SPGradient | null {
    let p1: SPGradient | null = src;
    let p2: SPGradient | null = src;
    let do1 = false;
    for (;;) {
      if (match(p2)) return p2;
      p2 = p2.ref.getObject();
      if (!p2) return null;
      if (do1) p1 = p1?.ref.getObject() ?? null;
      do1 = !do1;
      if (p2 === p1) return null; // cycle
    }
  }

  /** The SVGLength attribute attr from the href chain, marked as found; else the own value (upstream find_attr_length). */
  protected static find_attr_length<T extends SPGradient>(
    src: T,
    type: abstract new () => T,
    attr: (g: T) => SVGLength,
  ): SVGLength {
    const found = SPGradient.chase_hrefs(src, (g) => g instanceof type && attr(g as T)._set);
    if (found) {
      const l = attr(found as T).copy();
      l._found = true;
      return l;
    }
    // If not found, return the original SVGLength as to not overwrite defaults.
    return attr(src).copy();
  }

  hasStops(): boolean {
    return this.#has_stops;
  }
  isUnitsSet(): boolean {
    return this.units_set;
  }
  override getUnits(): SPGradientUnits {
    return this.units;
  }
  isSpreadSet(): boolean {
    return this.#spread_set;
  }
  override getSpread(): SPGradientSpread {
    return this.#spread;
  }
  isTransformSet(): boolean {
    return this.gradientTransform_set;
  }
  override getGradientTransform(): Affine {
    return this.gradientTransform;
  }
  isPinned(): boolean {
    return this.#pinned;
  }

  setSwatch(swatch = true): void {
    if (swatch !== this.isSwatch()) {
      this.swatch = swatch; // to make isSolid() work, this happens first
      this.setAttribute('inkscape:swatch', swatch ? (this.isSolid() ? 'solid' : 'gradient') : null);
      this.requestModified(SP_OBJECT_MODIFIED_FLAG);
    }
  }

  setPinned(pinned = true): void {
    if (pinned !== this.isPinned()) {
      this.setAttribute('inkscape:pinned', pinned ? 'true' : 'false');
      this.requestModified(SP_OBJECT_MODIFIED_FLAG);
    }
  }

  isSolid(): boolean {
    return this.swatch && this.hasStops() && this.getStopCount() === 1;
  }

  protected override build(document: SPDocument, repr: Node): void {
    // Work-around in case a swatch had been marked for immediate collection:
    if (repr.attribute('inkscape:swatch') && repr.attribute('inkscape:collect')) {
      repr.removeAttribute('inkscape:collect');
    }
    super.build(document, repr);
    this.#has_stops = this.children.some((c) => c instanceof SPStop);
    this.readAttr(SPAttr.GRADIENTUNITS);
    this.readAttr(SPAttr.GRADIENTTRANSFORM);
    this.readAttr(SPAttr.SPREADMETHOD);
    this.readAttr(SPAttr.XLINK_HREF);
    this.readAttr(SPAttr.INKSCAPE_SWATCH);
    this.readAttr(SPAttr.INKSCAPE_PINNED);
  }

  protected override release(): void {
    this.#modified_connection?.();
    this.#modified_connection = null;
    this.ref.detach();
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.GRADIENTUNITS:
        if (value) {
          this.units =
            value === 'userSpaceOnUse'
              ? SPGradientUnits.SP_GRADIENT_UNITS_USERSPACEONUSE
              : SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX;
          this.units_set = true;
        } else {
          this.units = SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX;
          this.units_set = false;
        }
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.GRADIENTTRANSFORM: {
        const t = value ? sp_svg_transform_read(value) : null;
        this.gradientTransform = t ?? Affine.identity();
        this.gradientTransform_set = t !== null;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      }
      case SPAttr.SPREADMETHOD:
        if (value) {
          this.#spread =
            value === 'reflect'
              ? SPGradientSpread.SP_GRADIENT_SPREAD_REFLECT
              : value === 'repeat'
                ? SPGradientSpread.SP_GRADIENT_SPREAD_REPEAT
                : SPGradientSpread.SP_GRADIENT_SPREAD_PAD;
          this.#spread_set = true;
        } else {
          this.#spread_set = false;
        }
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.XLINK_HREF:
        if (value) this.ref.try_attach(value);
        else this.ref.detach();
        break;
      case SPAttr.INKSCAPE_PINNED:
        if (value) this.#pinned = value === 'true';
        break;
      case SPAttr.INKSCAPE_SWATCH: {
        const newVal = value !== null;
        let modified = false;
        if (newVal !== this.swatch) {
          this.swatch = newVal;
          modified = true;
        }
        if (newVal) {
          // Might need to flip solid/gradient
          const paintVal = this.hasStops() && this.getStopCount() <= 1 ? 'solid' : 'gradient';
          if (paintVal !== value) {
            this.setAttribute('inkscape:swatch', paintVal);
            modified = true;
          }
        }
        if (modified) this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      }
      default:
        super.set(key, value);
        break;
    }
  }

  /** Gets called when the gradient is (re)attached to another gradient. */
  static gradientRefChanged(old_ref: SPObject | null, ref: SPObject | null, gr: SPGradient): void {
    if (old_ref) {
      gr.#modified_connection?.();
      gr.#modified_connection = null;
    }
    if (ref instanceof SPGradient && ref !== gr) {
      gr.#modified_connection = ref.modifiedSignal.connect(() => SPGradient.gradientRefModified(gr));
    }
    // Per SVG, all unset attributes must be inherited from linked gradient.
    // So, as we're now (re)linked, we assign linkee's values to this gradient if they are not yet set -
    // but without setting the _set flags.
    if (!gr.units_set) gr.units = gr.fetchUnits();
    if (!gr.#spread_set) gr.#spread = gr.fetchSpread();
    if (!gr.gradientTransform_set) gr.gradientTransform = gr.fetchTransform();
    SPGradient.gradientRefModified(gr);
  }

  static gradientRefModified(gradient: SPGradient): void {
    // Conditional to avoid causing infinite loop if there's a cycle in the href chain.
    if (gradient.#invalidateVector()) gradient.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    this.#invalidateVector();
    super.childAdded(child, ref);
    const ochild = this.getChildByRepr(child);
    if (ochild instanceof SPStop) {
      this.#has_stops = true;
      if (this.getStopCount() > 1) {
        const attr = this.getAttribute('inkscape:swatch');
        if (attr && attr !== 'gradient') this.setAttribute('inkscape:swatch', 'gradient');
      }
    }
    // TODO: Fixme: should we schedule "modified" here?
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override removeChild(child: Node): void {
    this.#invalidateVector();
    super.removeChild(child);
    this.#has_stops = this.children.some((c) => c instanceof SPStop);
    if (this.getStopCount() <= 1) {
      const attr = this.getAttribute('inkscape:swatch');
      if (attr && attr !== 'solid') this.setAttribute('inkscape:swatch', 'solid');
    }
    // Fixme: should we schedule "modified" here?
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  /** Upstream has no update(); it is here so that the stops' styles are updated (cascaded). */
  protected override update(ctx: SPCtx, flags: number): void {
    flags = cascadeFlags(flags);
    for (const child of this.childList()) {
      if (flags || child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        child.updateDisplay(ctx, flags);
      }
    }
  }

  protected override modified(flags: number): void {
    if (flags & SP_OBJECT_CHILD_MODIFIED_FLAG) this.#invalidateVector();
    if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) this.ensureVector();
    if (flags & SP_OBJECT_MODIFIED_FLAG) flags |= SP_OBJECT_PARENT_MODIFIED_FLAG;
    flags &= SP_OBJECT_MODIFIED_CASCADE;
    // FIXME: climb up the ladder of hrefs
    for (const child of this.childList()) {
      if (
        flags & SP_OBJECT_FLAGS_ALL ||
        child.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)
      ) {
        child.emitModified(flags);
      }
    }
  }

  getFirstStop(): SPStop | null {
    return (this.children.find((c) => c instanceof SPStop) as SPStop | undefined) ?? null;
  }

  getStopCount(): number {
    let count = 0;
    for (let stop = this.getFirstStop(); stop; stop = stop.getNextStop()) count++;
    return count;
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    super.write(xmlDoc, repr, flags);
    if (!repr) return repr;
    if (flags & SP_OBJECT_WRITE_BUILD) {
      for (const child of this.children) {
        const crepr = child.write(xmlDoc, null, flags);
        if (crepr) repr.appendChild(crepr);
      }
    }
    const uri = this.ref.getURI();
    if (uri) repr.setAttributeOrRemoveIfEmpty(getHrefAttribute(repr)[0], uri);
    if (flags & SP_OBJECT_WRITE_ALL || this.units_set) {
      repr.setAttribute(
        'gradientUnits',
        this.units === SPGradientUnits.SP_GRADIENT_UNITS_USERSPACEONUSE
          ? 'userSpaceOnUse'
          : 'objectBoundingBox',
      );
    }
    if (flags & SP_OBJECT_WRITE_ALL || this.gradientTransform_set) {
      repr.setAttributeOrRemoveIfEmpty('gradientTransform', sp_svg_transform_write(this.gradientTransform));
    }
    if (flags & SP_OBJECT_WRITE_ALL || this.#spread_set) {
      // FIXME: Ensure that this->spread is the inherited value if !this->spread_set.
      // Not currently happening: see SPGradient::modified.
      const spread = this.#spread;
      repr.setAttribute(
        'spreadMethod',
        spread === SPGradientSpread.SP_GRADIENT_SPREAD_REFLECT
          ? 'reflect'
          : spread === SPGradientSpread.SP_GRADIENT_SPREAD_REPEAT
            ? 'repeat'
            : 'pad',
      );
    }
    if (flags & SP_OBJECT_WRITE_EXT && this.isSwatch()) {
      repr.setAttribute('inkscape:swatch', this.isSolid() ? 'solid' : 'gradient');
    } else {
      repr.removeAttribute('inkscape:swatch');
    }
    return repr;
  }

  /** Forces the vector to be built, if not present (i.e., changed). */
  ensureVector(): void {
    if (!this.vector.built) this.#rebuildVector();
  }

  override getGradientVector(): SPGradientVector {
    if (!this.vector.built) this.#rebuildVector();
    this.vector.geom = this.getGradientGeom();
    return this.vector;
  }

  /** For linear x1,y1,x2,y2; for radial cx,cy,r,fx,fy,fr. */
  getGradientGeom(): number[] {
    return [];
  }

  /** Set units property of gradient and emit modified. */
  setUnits(units: SPGradientUnits): void {
    if (units !== this.units) {
      this.units = units;
      this.units_set = true;
      this.requestModified(SP_OBJECT_MODIFIED_FLAG);
    }
  }

  /** Set spread property of gradient and emit modified. */
  setSpread(spread: SPGradientSpread): void {
    if (spread !== this.#spread) {
      this.#spread = spread;
      this.#spread_set = true;
      this.requestModified(SP_OBJECT_MODIFIED_FLAG);
    }
  }

  /**
   * The gradient at the end of the href chain that has stops (or this), optionally normalized
   * to a vector (sp_gradient_ensure_vector_normalized).
   */
  getVector(force_vector = false): SPGradient {
    let src = SPGradient.chase_hrefs(this, (g) => g.hasStops()) ?? this;
    if (force_vector) src = sp_gradient_ensure_vector_normalized(src) ?? src;
    return src;
  }

  /** The effective spread (climbing up the refs chain if needed). */
  fetchSpread(): SPGradientSpread {
    const src = SPGradient.chase_hrefs(this, (g) => g.isSpreadSet());
    return src ? src.#spread : SPGradientSpread.SP_GRADIENT_SPREAD_PAD; // pad is the default
  }

  /** The effective units (climbing up the refs chain if needed). */
  fetchUnits(): SPGradientUnits {
    const src = SPGradient.chase_hrefs(this, (g) => g.isUnitsSet());
    return src ? src.units : SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX; // bbox is the default
  }

  /** The effective transform (climbing up the refs chain if needed). */
  fetchTransform(): Affine {
    const src = SPGradient.chase_hrefs(this, (g) => g.isTransformSet());
    return src ? src.gradientTransform : Affine.identity();
  }

  /** Remove the svg:stop children from the repr. */
  repr_clear_vector(): void {
    const repr = this.getRepr();
    for (const child of [...repr.children()].reverse()) {
      if (child.name() === 'svg:stop') repr.removeChild(child);
    }
  }

  /** Write the vector (own stops or inherited from refs) into the repr as svg:stop elements. */
  repr_write_vector(): void {
    const xmlDoc = this.document.getReprDoc();
    const repr = this.getRepr();
    // We have to be careful, as vector may be our own, so construct repr list at first
    const l = this.vector.stops.map((stop: SPGradientStop) => {
      const child = xmlDoc.createElement('svg:stop');
      child.setAttribute('offset', cssNumber(stop.offset));
      if (stop.color) SPStop.setColorRepr(child, stop.color);
      return child;
    });
    this.repr_clear_vector();
    for (const child of l) repr.appendChild(child);
  }

  /** Return true if change made. */
  #invalidateVector(): boolean {
    if (!this.vector.built) return false;
    this.vector.built = false;
    this.vector.stops = [];
    return true;
  }

  /** Creates normalized color vector */
  #rebuildVector(): void {
    const vector = this.vector;
    vector.stops = [];
    const reffed = this.ref.getObject();
    if (!this.hasStops() && reffed) {
      // Copy vector from referenced gradient
      vector.built = true; // Prevent infinite recursion.
      reffed.ensureVector();
      if (reffed.vector.stops.length) {
        vector.built = reffed.vector.built;
        vector.stops = reffed.vector.stops.map((s) => ({ ...s }));
        return;
      }
    }
    for (const child of this.children) {
      if (!(child instanceof SPStop)) continue;
      const last = vector.stops.at(-1);
      // "Each gradient offset value is required to be equal to or greater than the previous
      // gradient stop's offset value. If a given gradient stop's offset value is not equal to or
      // greater than all previous offset values, then the offset value is adjusted to be equal to
      // the largest of all previous offset values."
      let offset = last ? Math.max(child.offset, last.offset) : child.offset;
      // "Gradient offset values less than 0 (or less than 0%) are rounded up to 0%. Gradient
      // offset values greater than 1 (or greater than 100%) are rounded down to 100%."
      offset = Math.min(Math.max(offset, 0), 1);
      vector.stops.push({ offset, color: child.getColor() });
    }
    // Normalize per section 13.2.4 of SVG 1.1.
    const first = vector.stops[0];
    const last = vector.stops.at(-1);
    if (!first || !last) {
      // "If no stops are defined, then painting shall occur as if 'none' were specified as the
      // paint style."
      vector.stops.push({ offset: 0.0 }, { offset: 1.0 });
    } else {
      // "If one stop is defined, then paint with the solid color fill using the color defined
      // for that gradient stop."
      if (first.offset > 0.0) {
        // If the first one is not at 0, then insert a copy of the first at 0.
        vector.stops.unshift({ offset: 0.0, color: first.color });
      }
      if (last.offset < 1.0) {
        // If the last one is not at 1, then insert a copy of the last at 1.
        vector.stops.push({ offset: 1.0, color: last.color });
      }
    }
    vector.built = true;
  }

  /** Transform from gradient (bbox units) to desktop, in the given environment. */
  get_g2d_matrix(ctm: Affine, bbox: Rect): Affine {
    if (this.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX) {
      return Scale(bbox.dimensions()).multiply(Translate(bbox.min())).multiply(ctm);
    }
    return ctm;
  }

  /** Transform from gradient space (with gradientTransform) to desktop. */
  get_gs2d_matrix(ctm: Affine, bbox: Rect): Affine {
    if (this.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX) {
      return this.gradientTransform
        .multiply(Scale(bbox.dimensions()))
        .multiply(Translate(bbox.min()))
        .multiply(ctm);
    }
    return this.gradientTransform.multiply(ctm);
  }

  /** Set the gradientTransform so that get_gs2d_matrix() gives gs2d. */
  set_gs2d_matrix(ctm: Affine, bbox: Rect, gs2d: Affine): void {
    this.gradientTransform = gs2d.multiply(ctm.inverse());
    if (this.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX) {
      this.gradientTransform = this.gradientTransform
        .multiply(Translate(bbox.min().neg()))
        .multiply(Scale(bbox.dimensions()).inverse());
    }
    this.gradientTransform_set = true;
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }
}

/** Set (or with null remove) the href of a gradient repr (upstream sp_gradient_repr_set_link). */
export function sp_gradient_repr_set_link(repr: Node, link: SPGradient | null): void {
  if (link) {
    setHrefAttribute(repr, `#${link.getId()}`);
  } else {
    repr.removeAttribute('xlink:href');
    repr.removeAttribute('href');
  }
}

/**
 * Either normalizes given gradient to vector, or returns fresh normalized vector - in latter
 * case, original gradient is flattened and stops cleared. Returns null for a private gradient.
 * Upstream: gradient-chemistry.cpp (here, because SPGradient.getVector() needs it).
 */
export function sp_gradient_ensure_vector_normalized(gr: SPGradient): SPGradient | null {
  // If we are already normalized vector, just return
  if (gr.state === SPGradientState.SP_GRADIENT_STATE_VECTOR) return gr;
  // Fail, if we have wrong state set
  if (gr.state !== SPGradientState.SP_GRADIENT_STATE_UNKNOWN) {
    console.warn(`Cannot normalize private gradient to vector (${gr.getId()})`);
    return null;
  }
  // First make sure we have vector directly defined (i.e. gr has its own stops)
  if (!gr.hasStops()) {
    // We do not have stops ourselves, so flatten stops as well
    gr.ensureVector();
    // this adds stops from gr->vector as children to gr
    gr.repr_write_vector();
  }
  // If gr hrefs some other gradient, remove the href
  if (gr.ref.getObject()) {
    // We are hrefing someone, so require flattening
    gr.updateRepr(SP_OBJECT_WRITE_EXT | SP_OBJECT_WRITE_ALL);
    sp_gradient_repr_set_link(gr.getRepr(), null);
  }
  // Everything is OK, set state flag
  gr.state = SPGradientState.SP_GRADIENT_STATE_VECTOR;
  return gr;
}
