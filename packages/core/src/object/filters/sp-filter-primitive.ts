// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/sp-filter-primitive.cpp, src/object/filters/sp-filter-primitive.h
/*
 * Superclass for all the filter primitives
 *
 * Authors:
 *   Kees Cook <kees@outflux.net>
 *   Niko Kiirala <niko@kiirala.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004-2007 Authors
 */
import type { Rect } from '@inkscape-web/geom';
import { SPAttr } from '../../attributes.ts';
import type { SPDocument } from '../../document.ts';
import { SVGLengthUnit } from '../../svg/svg-length.ts';
import type { XmlDocument } from '../../xml/document.ts';
import type { Node } from '../../xml/node.ts';
import { SPDimensions } from '../sp-dimensions.ts';
import { SP_OBJECT_MODIFIED_FLAG, SPObject } from '../sp-object.ts';

/**
 * Base class of the filter primitives (upstream SPFilterPrimitive). The primitives without a
 * subclass here (feBlend, feOffset, ...) are plain SPFilterPrimitive objects: the drawing passes
 * them to the browser as they are in the document.
 * TODO: the result slots (resolve_slots), subregions in update(), valid_for().
 */
export class SPFilterPrimitive extends SPObject {
  in_name: string | null = null;
  out_name: string | null = null;
  /** x, y, width and height (upstream base class SPDimensions). */
  readonly dims = new SPDimensions();

  constructor() {
    super();
    // We must keep track if a value is set or not, if not set then the region defaults to 0%, 0%,
    // 100%, 100% ("x", "y", "width", "height") of the -> filter <- region. If set then
    // percentages are in terms of bounding box or viewbox, depending on value of "primitiveUnits"

    // NB: SVGLength.set takes prescaled percent values: 1 means 100%
    this.dims.x.unset(SVGLengthUnit.PERCENT, 0, 0);
    this.dims.y.unset(SVGLengthUnit.PERCENT, 0, 0);
    this.dims.width.unset(SVGLengthUnit.PERCENT, 1, 0);
    this.dims.height.unset(SVGLengthUnit.PERCENT, 1, 0);
  }

  protected override build(document: SPDocument, repr: Node): void {
    this.readAttr(SPAttr.STYLE); // struct not derived from SPItem, we need to do this ourselves.
    this.readAttr(SPAttr.IN_);
    this.readAttr(SPAttr.RESULT);
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.WIDTH);
    this.readAttr(SPAttr.HEIGHT);
    super.build(document, repr);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.IN_:
        if (this.in_name !== value) {
          this.in_name = value;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      case SPAttr.RESULT:
        if (this.out_name !== value) {
          this.out_name = value;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      case SPAttr.X:
        this.dims.x.readOrUnset(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y:
        this.dims.y.readOrUnset(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.WIDTH:
        this.dims.width.readOrUnset(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.HEIGHT:
        this.dims.height.readOrUnset(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    repr ??= this.getRepr().duplicate(xmlDoc);
    repr.setAttributeOrRemoveIfEmpty('in', this.in_name);
    repr.setAttributeOrRemoveIfEmpty('result', this.out_name);
    // Do we need to add x, y, width, height?
    return super.write(xmlDoc, repr, flags);
  }

  /**
   * The region that the primitive draws, for the automatic filter region.
   * @param region The original shape's region or previous primitive's calculate_region output.
   */
  calculate_region(region: Rect): Rect {
    return region; // No change.
  }
}
