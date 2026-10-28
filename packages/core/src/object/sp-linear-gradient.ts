// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-linear-gradient.cpp, src/object/sp-linear-gradient.h
/*
 * SPLinearGradient: SVG <lineargradient> implementation
 *
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { SVGLength, SVGLengthUnit } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { SPGradient } from './sp-gradient.ts';
import type { SPItemCtx } from './sp-item.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_ALL,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
} from './sp-object.ts';
import { PaintServerType, SPGradientUnits } from './sp-paint-server-data.ts';

/** Linear gradient. */
export class SPLinearGradient extends SPGradient {
  readonly x1 = new SVGLength();
  readonly y1 = new SVGLength();
  readonly x2 = new SVGLength();
  readonly y2 = new SVGLength();

  constructor() {
    super();
    this.x1.unset(SVGLengthUnit.PERCENT, 0.0, 0.0);
    this.y1.unset(SVGLengthUnit.PERCENT, 0.0, 0.0);
    this.x2.unset(SVGLengthUnit.PERCENT, 1.0, 1.0);
    this.y2.unset(SVGLengthUnit.PERCENT, 0.0, 0.0);
  }

  // Walk up the reference tree to find values.
  find_x1(): SVGLength {
    return SPGradient.find_attr_length(this, SPLinearGradient, (g) => g.x1);
  }
  find_y1(): SVGLength {
    return SPGradient.find_attr_length(this, SPLinearGradient, (g) => g.y1);
  }
  find_x2(): SVGLength {
    return SPGradient.find_attr_length(this, SPLinearGradient, (g) => g.x2);
  }
  find_y2(): SVGLength {
    return SPGradient.find_attr_length(this, SPLinearGradient, (g) => g.y2);
  }

  override getPaintType(): PaintServerType {
    return PaintServerType.LINEAR_GRADIENT;
  }
  override getGradientGeom(): number[] {
    return [this.x1.computed, this.y1.computed, this.x2.computed, this.y2.computed];
  }

  protected override build(document: SPDocument, repr: Node): void {
    this.readAttr(SPAttr.X1);
    this.readAttr(SPAttr.Y1);
    this.readAttr(SPAttr.X2);
    this.readAttr(SPAttr.Y2);
    super.build(document, repr);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.X1:
        this.x1.readOrUnset(value, SVGLengthUnit.PERCENT, 0.0, 0.0);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y1:
        this.y1.readOrUnset(value, SVGLengthUnit.PERCENT, 0.0, 0.0);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.X2:
        this.x2.readOrUnset(value, SVGLengthUnit.PERCENT, 1.0, 1.0);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y2:
        this.y2.readOrUnset(value, SVGLengthUnit.PERCENT, 0.0, 0.0);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    super.update(ctx, flags);
    // To do: Verify flags.
    if (
      flags &
      (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      // Walk up the reference tree to find values.
      if (!this.x1._set) this.x1.unset(this.find_x1());
      if (!this.y1._set) this.y1.unset(this.find_y1());
      if (!this.x2._set) this.x2.unset(this.find_x2());
      if (!this.y2._set) this.y2.unset(this.find_y2());
      if (this.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_USERSPACEONUSE) {
        const { viewport } = ctx as SPItemCtx;
        const w = viewport.width();
        const h = viewport.height();
        const em = this.style.font_size.computed;
        const ex = 0.5 * em; // fixme: get x height from pango or libnrtype.
        this.x1.update(em, ex, w);
        this.y1.update(em, ex, h);
        this.x2.update(em, ex, w);
        this.y2.update(em, ex, h);
      }
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:linearGradient');
    if (!repr) return null;
    if (flags & SP_OBJECT_WRITE_ALL || this.x1._set) repr.setAttributeSvgDouble('x1', this.x1.computed);
    if (flags & SP_OBJECT_WRITE_ALL || this.y1._set) repr.setAttributeSvgDouble('y1', this.y1.computed);
    if (flags & SP_OBJECT_WRITE_ALL || this.x2._set) repr.setAttributeSvgDouble('x2', this.x2.computed);
    if (flags & SP_OBJECT_WRITE_ALL || this.y2._set) repr.setAttributeSvgDouble('y2', this.y2.computed);
    return super.write(xmlDoc, repr, flags);
  }
}
