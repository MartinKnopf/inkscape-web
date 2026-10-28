// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-filter.cpp, src/object/sp-filter.h, src/object/sp-filter-reference.cpp, src/object/sp-filter-reference.h
/*
 * SVG <filter> implementation.
 *
 * Authors:
 *   Hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Niko Kiirala <niko@kiirala.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006,2007 Authors
 */
import { Affine, Rect, Scale, Translate } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { NumberOptNumber } from '../number-opt-number.ts';
import { SPFilterReference } from '../style-internal.ts';
import { svgNumber } from '../svg/stringstream.ts';
import type { XmlDocument } from '../xml/document.ts';
import { getHrefAttribute } from '../xml/href-attribute-helper.ts';
import type { Node } from '../xml/node.ts';
import { SPFilterPrimitive } from './filters/sp-filter-primitive.ts';
import { SPDimensions } from './sp-dimensions.ts';
import { SPFilterUnits } from './sp-filter-units.ts';
import { BBoxType, type SPItem, type SPItemCtx } from './sp-item.ts';
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_ALL,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
  SPObject,
} from './sp-object.ts';

/**
 * svg:filter (upstream SPFilter). Upstream builds a Cairo renderer for each view; here the
 * views get the filter itself (DrawingItem.setFilterRenderer) and the drawing mirrors it.
 * TODO: filterRes in the renderer, the result slots (SlotResolver), valid_for().
 */
export class SPFilter extends SPObject {
  filterUnits = SPFilterUnits.SP_FILTER_UNITS_OBJECTBOUNDINGBOX;
  filterUnits_set = false;
  primitiveUnits = SPFilterUnits.SP_FILTER_UNITS_USERSPACEONUSE;
  primitiveUnits_set = false;
  filterRes = new NumberOptNumber();
  readonly href: SPFilterReference;
  auto_region = true;
  /** x, y, width and height (upstream base class SPDimensions). */
  readonly dims = new SPDimensions();
  /** The drawing items that show this filter. */
  views: DrawingItem[] = [];
  #modified_connection: (() => void) | null = null;

  constructor() {
    super();
    this.href = new SPFilterReference(this);
    this.href.changedSignal.connect((_old_ref, ref) => {
      this.#modified_connection?.();
      this.#modified_connection = null;
      if (ref instanceof SPFilter && ref !== this) {
        this.#modified_connection = ref.modifiedSignal.connect(() =>
          this.requestModified(SP_OBJECT_MODIFIED_FLAG),
        );
      }
      this.requestModified(SP_OBJECT_MODIFIED_FLAG);
    });
  }

  get x() {
    return this.dims.x;
  }
  get y() {
    return this.dims.y;
  }
  get width() {
    return this.dims.width;
  }
  get height() {
    return this.dims.height;
  }

  protected override build(document: SPDocument, repr: Node): void {
    // Read values of key attributes from XML nodes into object.
    this.readAttr(SPAttr.STYLE); // struct not derived from SPItem, we need to do this ourselves.
    this.readAttr(SPAttr.FILTERUNITS);
    this.readAttr(SPAttr.PRIMITIVEUNITS);
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.WIDTH);
    this.readAttr(SPAttr.HEIGHT);
    this.readAttr(SPAttr.AUTO_REGION);
    this.readAttr(SPAttr.FILTERRES);
    this.readAttr(SPAttr.XLINK_HREF);
    super.build(document, repr);
    // TODO: document->addResource("filter", this)
  }

  protected override release(): void {
    this.#modified_connection?.();
    this.#modified_connection = null;
    this.href.detach();
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.FILTERUNITS:
        this.filterUnits =
          value === 'userSpaceOnUse'
            ? SPFilterUnits.SP_FILTER_UNITS_USERSPACEONUSE
            : SPFilterUnits.SP_FILTER_UNITS_OBJECTBOUNDINGBOX;
        this.filterUnits_set = value !== null;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.PRIMITIVEUNITS:
        this.primitiveUnits =
          value === 'objectBoundingBox'
            ? SPFilterUnits.SP_FILTER_UNITS_OBJECTBOUNDINGBOX
            : SPFilterUnits.SP_FILTER_UNITS_USERSPACEONUSE;
        this.primitiveUnits_set = value !== null;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.X:
        this.x.readOrUnset(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y:
        this.y.readOrUnset(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.WIDTH:
        this.width.readOrUnset(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.HEIGHT:
        this.height.readOrUnset(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.AUTO_REGION:
        this.auto_region = !value || value !== 'false';
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.FILTERRES:
        this.filterRes.set(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.XLINK_HREF:
        if (!this.href.try_attach(value)) this.href.detach();
        break;
      default:
        // See if any parents need this value.
        super.set(key, value);
        break;
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    const cflags = cascadeFlags(flags);
    if (
      flags &
      (SP_OBJECT_MODIFIED_FLAG |
        SP_OBJECT_CHILD_MODIFIED_FLAG |
        SP_OBJECT_STYLE_MODIFIED_FLAG |
        SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      // Do here since we know viewport (Bounding box case handled during rendering)
      // Note: This only works for root viewport since this routine is not called after
      // setting a new viewport. A true fix requires a strategy like SPItemView or SPMarkerView.
      if (this.filterUnits === SPFilterUnits.SP_FILTER_UNITS_USERSPACEONUSE) {
        this.dims.calcDimsFromParentViewport(ctx as SPItemCtx, true);
      }
    }
    // Update filter primitives in order to update filter primitive area
    for (const c of this.childList()) {
      if (cflags || c.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        c.updateDisplay(ctx, cflags);
      }
    }
    super.update(ctx, flags);
  }

  protected override modified(flags: number): void {
    const cflags = cascadeFlags(flags);
    // TODO: upstream calls update_filter_all_regions() here, which writes the region to the
    // repr at every change; here only the blur slider updates the region (update_filter_region).
    for (const c of this.childList()) {
      if (cflags || c.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        c.emitModified(cflags);
      }
    }
    // The drawing follows the modified signal of the filter (its mirror), see setFilterRenderer.
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    // Original from sp-item-group.cpp
    if (flags & SP_OBJECT_WRITE_BUILD) {
      repr ??= xmlDoc.createElement('svg:filter');
      const l: Node[] = [];
      for (const child of this.children) {
        const crepr = child.write(xmlDoc, null, flags);
        if (crepr) l.push(crepr);
      }
      for (const crepr of l) repr.appendChild(crepr);
    } else {
      for (const child of this.children) child.updateRepr(flags);
    }
    if (!repr) return null;

    if (flags & SP_OBJECT_WRITE_ALL || this.filterUnits_set) {
      repr.setAttribute(
        'filterUnits',
        this.filterUnits === SPFilterUnits.SP_FILTER_UNITS_USERSPACEONUSE
          ? 'userSpaceOnUse'
          : 'objectBoundingBox',
      );
    }
    if (flags & SP_OBJECT_WRITE_ALL || this.primitiveUnits_set) {
      repr.setAttribute(
        'primitiveUnits',
        this.primitiveUnits === SPFilterUnits.SP_FILTER_UNITS_OBJECTBOUNDINGBOX
          ? 'objectBoundingBox'
          : 'userSpaceOnUse',
      );
    }
    for (const [name, len] of [
      ['x', this.x],
      ['y', this.y],
      ['width', this.width],
      ['height', this.height],
    ] as const) {
      repr.setAttribute(name, len._set ? svgNumber(len.computed) : null);
    }
    repr.setAttribute('filterRes', this.filterRes.getNumber() >= 0 ? this.filterRes.getValueString() : null);
    const uri = this.href.getURI();
    if (uri) repr.setAttributeOrRemoveIfEmpty(getHrefAttribute(repr)[0], uri);
    return super.write(xmlDoc, repr, flags);
  }

  /**
   * Update the filter region based on the object's bounding box
   *
   * @param item - The item whose coords are used as the basis for the area.
   */
  update_filter_region(item: SPItem): void {
    if (!this.auto_region || this.filterUnits === SPFilterUnits.SP_FILTER_UNITS_USERSPACEONUSE) {
      return; // No adjustment for dead box
    }
    const region = this.get_automatic_filter_region(item);
    // Set the filter region into this filter object
    this.set_filter_region(region.left(), region.top(), region.width(), region.height());
  }

  /**
   * Generate a filter region based on the item and return it.
   *
   * @param item - The item whose coords are used as the basis for the area.
   */
  get_automatic_filter_region(item: SPItem): Rect {
    // Calling bbox instead of visualBound() avoids re-requesting filter regions
    const v_box = item.bbox(Affine.identity(), BBoxType.VISUAL_BBOX);
    const g_box = item.bbox(Affine.identity(), BBoxType.GEOMETRIC_BBOX);
    if (!v_box || !g_box) return new Rect(0, 0, 0, 0); // No adjustment for dead box

    // Because the filter box is in geometric bounding box units, it must ALSO
    // take account of the visualBox, so even if the filter does NOTHING to the
    // size of an object, we must add the difference between the geometric and
    // visual boxes ourselves or find them cut off by renderers of all kinds.
    const inbox = g_box;
    let outbox = v_box;
    for (const primitive of this.children) {
      // Update the region with the primitive's options
      if (primitive instanceof SPFilterPrimitive) outbox = primitive.calculate_region(outbox);
    }
    // Include the original visual bounding-box in the result
    outbox = outbox.unionWith(v_box);
    // Scale outbox to width/height scale of input, this scales the geometric
    // into the visual bounding box requiring any changes to it to re-run this.
    return outbox.transformed(
      Translate(-inbox.left(), -inbox.top()).multiply(Scale(1.0 / inbox.width(), 1.0 / inbox.height())),
    );
  }

  /** Set the filter region attributes from a bounding box. */
  set_filter_region(x: number, y: number, width: number, height: number): void {
    if (width !== 0 && height !== 0) {
      // TODO: set it in UserSpaceOnUse instead?
      const repr = this.getRepr();
      repr.setAttribute('x', svgNumber(x));
      repr.setAttribute('y', svgNumber(y));
      repr.setAttribute('width', svgNumber(width));
      repr.setAttribute('height', svgNumber(height));
    }
  }

  /** Returns the number of filter primitives in this SPFilter object. */
  primitive_count(): number {
    return this.children.filter((c) => c instanceof SPFilterPrimitive).length;
  }

  /** Let the drawing item render this filter. */
  show(item: DrawingItem): void {
    this.views.push(item);
    item.setFilterRenderer(this);
  }

  hide(item: DrawingItem): void {
    const i = this.views.indexOf(item);
    if (i >= 0) this.views.splice(i, 1);
    item.setFilterRenderer(null);
  }
}

SPFilterReference.isFilter = (obj): obj is SPFilter => obj instanceof SPFilter;
