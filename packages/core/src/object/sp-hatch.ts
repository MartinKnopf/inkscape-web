// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-hatch.cpp, src/object/sp-hatch.h
/*
 * SVG <hatch> implementation
 *
 * Authors:
 *   Tomasz Boczkowski <penginsbacon@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2014 Tomasz Boczkowski
 */
import { Affine, Interval, type OptRect, Rect, Rotate, Translate } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { SPOverflow } from '../style-enums.ts';
import { sp_svg_transform_read, sp_svg_transform_write } from '../svg/svg-affine.ts';
import { SVGAngle } from '../svg/svg-angle.ts';
import { SVGLength } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import { setHrefAttribute } from '../xml/href-attribute-helper.ts';
import type { Node } from '../xml/node.ts';
import { spReprCssAttrNew, spReprCssChangeRecursive, spReprCssSetProperty } from '../xml/repr-css.ts';
import { SPHatchPath } from './sp-hatch-path.ts';
import type { SPItem } from './sp-item.ts';
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_FLAGS_ALL,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
  type SPObject,
} from './sp-object.ts';
import { SPPaintServer } from './sp-paint-server.ts';
import { PaintServerType } from './sp-paint-server-data.ts';
import { URIReference } from './uri-references.ts';

/** The href of a hatch to the hatch it inherits from (upstream SPHatchReference). */
export class SPHatchReference extends URIReference {
  override getObject(): SPHatch | null {
    return super.getObject() as SPHatch | null;
  }
  protected override _acceptObject(obj: SPObject): boolean {
    return obj instanceof SPHatch && super._acceptObject(obj);
  }
}

export enum HatchUnits {
  UserSpaceOnUse,
  ObjectBoundingBox,
}

/** How to draw a hatch for an object bounding box (upstream SPHatch::RenderInfo). */
export interface HatchRenderInfo {
  child_transform: Affine;
  pattern_to_user_transform: Affine;
  tile_rect: Rect;
  overflow_steps: number;
  overflow_step_transform: Affine;
  overflow_initial_transform: Affine;
}

/**
 * svg:hatch (upstream SPHatch), a paint server of strips of hatch paths. Upstream keeps a
 * DrawingPattern per view with the bounding box of the painted object; here the renderers pass
 * the bounding box to calculateRenderInfo() and calculateStripExtents().
 */
export class SPHatch extends SPPaintServer {
  // Reference (href)
  href = '';
  readonly ref: SPHatchReference = new SPHatchReference(this);

  // patternUnits and patternContentUnits attribute
  #hatch_units: HatchUnits | null = null;
  #hatch_content_units: HatchUnits | null = null;
  // transform attribute
  #hatch_transform: Affine | null = null;
  // Strip
  readonly #x = new SVGLength();
  readonly #y = new SVGLength();
  readonly #pitch = new SVGLength();
  readonly #rotate = new SVGAngle();

  #modified_connection: (() => void) | null = null;

  constructor() {
    super();
    // Gets called when the hatch is reattached to another <hatch>
    this.ref.changedSignal.connect((_old, ref) => {
      this.#modified_connection?.();
      this.#modified_connection = null;
      if (ref instanceof SPHatch) {
        // Gets called when the referenced <hatch> is changed
        this.#modified_connection = ref.modifiedSignal.connect(() =>
          this.requestModified(SP_OBJECT_MODIFIED_FLAG),
        );
      }
      this.requestModified(SP_OBJECT_MODIFIED_FLAG);
    });
  }

  protected override build(doc: SPDocument, repr: Node): void {
    super.build(doc, repr);
    for (const key of [
      SPAttr.HATCHUNITS,
      SPAttr.HATCHCONTENTUNITS,
      SPAttr.TRANSFORM,
      SPAttr.X,
      SPAttr.Y,
      SPAttr.PITCH,
      SPAttr.ROTATE,
      SPAttr.XLINK_HREF,
    ]) {
      this.readAttr(key);
    }
    // TODO: doc->addResource("hatch", this)
  }

  protected override release(): void {
    this.#modified_connection?.();
    this.#modified_connection = null;
    this.ref.detach();
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    const units = (v: string | null) =>
      v === null ? null : v === 'userSpaceOnUse' ? HatchUnits.UserSpaceOnUse : HatchUnits.ObjectBoundingBox;
    switch (key) {
      case SPAttr.HATCHUNITS:
        this.#hatch_units = units(value);
        break;
      case SPAttr.HATCHCONTENTUNITS:
        this.#hatch_content_units = units(value);
        break;
      case SPAttr.TRANSFORM:
        this.#hatch_transform = value ? sp_svg_transform_read(value) : null;
        break;
      case SPAttr.X:
        this.#x.readOrUnset(value);
        break;
      case SPAttr.Y:
        this.#y.readOrUnset(value);
        break;
      case SPAttr.PITCH:
        this.#pitch.readOrUnset(value);
        break;
      case SPAttr.ROTATE:
        this.#rotate.readOrUnset(value);
        break;
      case SPAttr.XLINK_HREF:
        if (value && this.href === value) break; // Href unchanged, do nothing.
        this.href = '';
        if (value) {
          // First, set the href field; it's only used in the "unchanged" check above.
          this.href = value;
          // Now do the attaching, which emits the changed signal.
          if (!this.ref.try_attach(value)) this.ref.detach();
        } else {
          this.ref.detach();
        }
        break;
      default:
        super.set(key, value);
        return;
    }
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override update(ctx: SPCtx, flags: number): void {
    const cflags = cascadeFlags(flags);
    for (const child of this.hatchPaths()) {
      if (
        cflags & SP_OBJECT_FLAGS_ALL ||
        child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)
      ) {
        child.updateDisplay(ctx, cflags);
      }
    }
  }

  protected override modified(flags: number): void {
    const cflags = cascadeFlags(flags);
    for (const child of this.hatchPaths()) {
      if (
        cflags & SP_OBJECT_FLAGS_ALL ||
        child.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)
      ) {
        child.emitModified(cflags);
      }
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:hatch');
    return super.write(xmlDoc, repr, flags);
  }

  override getPaintType(): PaintServerType {
    return PaintServerType.HATCH_PATTERN;
  }

  /** The hatches of the href chain, starting with this one; stops at a cycle. */
  *#chain(): Generator<SPHatch> {
    const seen = new Set<SPHatch>();
    for (let h: SPHatch | null = this; h && !seen.has(h); h = h.ref.getObject()) {
      seen.add(h);
      yield h;
    }
  }

  static _hasHatchPatchChildren(hatch: SPHatch): boolean {
    return hatch.children.some((c) => c instanceof SPHatchPath);
  }

  get_this_transform(): Affine {
    return this.#hatch_transform ?? Affine.identity();
  }

  /** The hatch paths of the root hatch. */
  hatchPaths(): SPHatchPath[] {
    return this.rootHatch().children.filter((c): c is SPHatchPath => c instanceof SPHatchPath);
  }

  /** The first hatch of the chain with hatch path children: the one whose paths are drawn. */
  rootHatch(): SPHatch {
    for (const h of this.#chain()) if (SPHatch._hasHatchPatchChildren(h)) return h;
    // document is broken, we can't get to root; but at least we can return ourself which is supposedly a valid hatch
    return this;
  }

  // Access functions that look up fields up the chain of referenced hatchs and return the first one which is set

  hatchUnits(): HatchUnits {
    for (const h of this.#chain()) if (h.#hatch_units !== null) return h.#hatch_units;
    return HatchUnits.ObjectBoundingBox;
  }
  hatchContentUnits(): HatchUnits {
    for (const h of this.#chain()) if (h.#hatch_content_units !== null) return h.#hatch_content_units;
    return HatchUnits.UserSpaceOnUse;
  }
  hatchTransform(): Affine {
    for (const h of this.#chain()) if (h.#hatch_transform) return h.#hatch_transform;
    return Affine.identity();
  }
  #value(get: (h: SPHatch) => { _set: boolean; computed: number }): number {
    for (const h of this.#chain()) if (get(h)._set) return get(h).computed;
    return 0;
  }
  x(): number {
    return this.#value((h) => h.#x);
  }
  y(): number {
    return this.#value((h) => h.#y);
  }
  pitch(): number {
    return this.#value((h) => h.#pitch);
  }
  rotate(): number {
    return this.#value((h) => h.#rotate);
  }

  /** Count how many times hatch is used by the styles of o and its descendants */
  #countHrefs(o: SPObject | null): number {
    if (!o) return 1;
    let i = 0;
    if (o.style.fill.isPaintserver() && o.style.getFillPaintServer() === this) i++;
    if (o.style.stroke.isPaintserver() && o.style.getStrokePaintServer() === this) i++;
    for (const child of o.children) i += this.#countHrefs(child);
    return i;
  }

  /**
   * A hatch of item's property ("fill" or "stroke") that only item uses: this one, or a new
   * hatch that references this one and that item's style now uses.
   */
  clone_if_necessary(item: SPItem, property: 'fill' | 'stroke'): SPHatch {
    if (this.href && this.hrefcount <= this.#countHrefs(item)) return this;
    const doc = this.document;
    const repr = doc.getReprDoc().createElement('svg:hatch');
    repr.setAttribute('inkscape:collect', 'always');
    setHrefAttribute(repr, `#${this.getId()}`);
    doc.getDefs()?.getRepr().addChild(repr, null);
    const hatch = doc.getObjectByRepr(repr) as SPHatch;

    const css = spReprCssAttrNew();
    spReprCssSetProperty(css, property, `url(#${hatch.getId()})`);
    spReprCssChangeRecursive(item.getRepr(), css, 'style');
    return hatch;
  }

  transform_multiply(postmul: Affine, set: boolean): void {
    this.#hatch_transform = set ? postmul : this.hatchTransform().multiply(postmul);
    this.setAttributeOrRemoveIfEmpty('transform', sp_svg_transform_write(this.#hatch_transform));
  }

  override isValid(): boolean {
    if (this.pitch() <= 0) return false;
    const children = this.hatchPaths();
    if (children.length === 0) return false;
    return children.every((c) => c.isValid());
  }

  /** The horizontal extent of the hatch paths with their strokes. */
  bounds(): Interval {
    let result: Interval | null = null;
    for (const child of this.hatchPaths()) {
      const b = child.bounds();
      result = result && result.extent() !== 0 ? result.unionWith(b) : b;
    }
    return result ?? new Interval(0, 0);
  }

  /** How to draw the hatch for an object with the bounding box (upstream calculateRenderInfo). */
  calculateRenderInfo(bbox: OptRect): HatchRenderInfo {
    const info: HatchRenderInfo = {
      child_transform: Affine.identity(),
      pattern_to_user_transform: Affine.identity(),
      tile_rect: new Rect(0, 0, 0, 0),
      overflow_steps: 0,
      overflow_step_transform: Affine.identity(),
      overflow_initial_transform: Affine.identity(),
    };
    const extents = this.calculateStripExtents(bbox);
    if (!extents) return info;

    let tile_x = this.x();
    let tile_y = this.y();
    let tile_width = this.pitch();
    let tile_height = extents.max() - extents.min();
    const tile_rotate = this.rotate();
    let tile_render_y = extents.min();

    if (bbox && this.hatchUnits() === HatchUnits.ObjectBoundingBox) {
      tile_x *= bbox.width();
      tile_y *= bbox.height();
      tile_width *= bbox.width();
    }

    // Extent calculated using content units, need to correct.
    if (bbox && this.hatchContentUnits() === HatchUnits.ObjectBoundingBox) {
      tile_height *= bbox.height();
      tile_render_y *= bbox.height();
    }

    // Content to bbox
    if (bbox && this.hatchContentUnits() === HatchUnits.ObjectBoundingBox) {
      info.child_transform = new Affine(bbox.width(), 0.0, 0.0, bbox.height(), 0, 0);
    }

    // Tile (hatch space) to user.
    info.pattern_to_user_transform = Translate(tile_x, tile_y)
      .multiply(Rotate.from_degrees(tile_rotate))
      .multiply(this.hatchTransform());
    // Pattern size in hatch space
    info.tile_rect = Rect.fromXywh(0, tile_render_y, tile_width, tile_height);

    if (this.style.overflow.computed === SPOverflow.SP_CSS_OVERFLOW_VISIBLE) {
      let bounds = this.bounds();
      let pitch = this.pitch();
      if (bbox) {
        if (this.hatchUnits() === HatchUnits.ObjectBoundingBox) pitch *= bbox.width();
        if (this.hatchContentUnits() === HatchUnits.ObjectBoundingBox) {
          bounds = new Interval(bounds.min() * bbox.width(), bounds.max() * bbox.width());
        }
      }
      const overflow_right_strip = Math.floor(bounds.max() / pitch) * pitch;
      info.overflow_steps = Math.ceil((overflow_right_strip - bounds.min()) / pitch) + 1;
      info.overflow_step_transform = Translate(pitch, 0.0);
      info.overflow_initial_transform = Translate(-overflow_right_strip, 0.0);
    } else {
      info.overflow_steps = 1;
    }
    return info;
  }

  /** The strip extents in content space for the bounding box (upstream _calculateStripExtents). */
  calculateStripExtents(bbox: OptRect): Interval | null {
    if (!bbox || bbox.hasZeroArea()) return null;

    const ps2user = Translate(this.x(), this.y())
      .multiply(Rotate.from_degrees(this.rotate()))
      .multiply(this.hatchTransform());
    const user2ps = ps2user.inverse();

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 4; ++i) {
      const corner_ps = bbox.corner(i).transformed(user2ps);
      min = Math.min(min, corner_ps.y);
      max = Math.max(max, corner_ps.y);
    }

    if (this.hatchContentUnits() === HatchUnits.ObjectBoundingBox) {
      min /= bbox.height();
      max /= bbox.height();
    }
    return new Interval(min, max);
  }
}
