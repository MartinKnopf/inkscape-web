// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-radial-gradient.cpp, src/object/sp-radial-gradient.h
/*
 * SPRadialGradient: SVG <radialgradient> implementtion.
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

/** Radial gradient. */
export class SPRadialGradient extends SPGradient {
  readonly cx = new SVGLength();
  readonly cy = new SVGLength();
  readonly r = new SVGLength();
  readonly fx = new SVGLength();
  readonly fy = new SVGLength();
  /** Focus radius. Added in SVG 2 */
  readonly fr = new SVGLength();

  constructor() {
    super();
    this.cx.unset(SVGLengthUnit.PERCENT, 0.5, 0.5);
    this.cy.unset(SVGLengthUnit.PERCENT, 0.5, 0.5);
    this.r.unset(SVGLengthUnit.PERCENT, 0.5, 0.5);
    this.fx.unset(SVGLengthUnit.PERCENT, 0.5, 0.5);
    this.fy.unset(SVGLengthUnit.PERCENT, 0.5, 0.5);
    this.fr.unset(SVGLengthUnit.PERCENT, 0.0, 0.0);
  }

  // Walk up the reference tree to find values.
  #find(attr: (g: SPRadialGradient) => SVGLength): SVGLength {
    return SPGradient.find_attr_length(this, SPRadialGradient, attr);
  }
  find_cx(): SVGLength {
    return this.#find((g) => g.cx);
  }
  find_cy(): SVGLength {
    return this.#find((g) => g.cy);
  }
  find_r(): SVGLength {
    return this.#find((g) => g.r);
  }
  find_fx(): SVGLength {
    return this.#find((g) => g.fx);
  }
  find_fy(): SVGLength {
    return this.#find((g) => g.fy);
  }
  find_fr(): SVGLength {
    return this.#find((g) => g.fr);
  }

  override getPaintType(): PaintServerType {
    return PaintServerType.RADIAL_GRADIENT;
  }
  override getGradientGeom(): number[] {
    return [
      this.cx.computed,
      this.cy.computed,
      this.r.computed,
      this.fx.computed,
      this.fy.computed,
      this.fr.computed,
    ];
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.CX);
    this.readAttr(SPAttr.CY);
    this.readAttr(SPAttr.R);
    this.readAttr(SPAttr.FX);
    this.readAttr(SPAttr.FY);
    this.readAttr(SPAttr.FR);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.CX:
        if (!this.cx.read(value)) this.cx.unset(SVGLengthUnit.PERCENT, 0.5, 0.5);
        if (!this.fx._set) this.fx.unset(this.cx); // Copy but don't set
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.CY:
        if (!this.cy.read(value)) this.cy.unset(SVGLengthUnit.PERCENT, 0.5, 0.5);
        if (!this.fy._set) this.fy.unset(this.cy); // Copy but don't set
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.R:
        if (!this.r.read(value)) this.r.unset(SVGLengthUnit.PERCENT, 0.5, 0.5);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.FX:
        if (!this.fx.read(value)) this.fx.unset(this.cx.unit, this.cx.value, this.cx.computed);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.FY:
        if (!this.fy.read(value)) this.fy.unset(this.cy.unit, this.cy.value, this.cy.computed);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.FR:
        if (!this.fr.read(value)) this.fr.unset(SVGLengthUnit.PERCENT, 0.0, 0.0);
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
      if (!this.cx._set) this.cx.unset(this.find_cx());
      if (!this.cy._set) this.cy.unset(this.find_cy());
      if (!this.r._set) this.r.unset(this.find_r());
      if (!this.fx._set) this.fx.unset(this.find_fx());
      if (!this.fy._set) this.fy.unset(this.find_fy());
      if (!this.fr._set) this.fr.unset(this.find_fr());
      // Fallback values, need to be updated in case cx, cy found from referenced gradient,
      // but only if fx and fy not found in reference gradient.
      if (!this.fx._set && !this.fx._found) this.fx.unset(this.cx);
      if (!this.fy._set && !this.fy._found) this.fy.unset(this.cy);
      // Reset
      this.fx._found = false;
      this.fy._found = false;
      if (this.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_USERSPACEONUSE) {
        const { viewport } = ctx as SPItemCtx;
        const w = viewport.width();
        const h = viewport.height();
        const d = Math.sqrt((w * w + h * h) / 2.0);
        const em = this.style.font_size.computed;
        const ex = 0.5 * em; // fixme: get x height from pango or libnrtype.
        this.cx.update(em, ex, w);
        this.cy.update(em, ex, h);
        this.r.update(em, ex, d);
        this.fx.update(em, ex, w);
        this.fy.update(em, ex, h);
        this.fr.update(em, ex, d);
      }
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:radialGradient');
    if (!repr) return null;
    const all = flags & SP_OBJECT_WRITE_ALL;
    if (all || this.cx._set) repr.setAttributeSvgDouble('cx', this.cx.computed);
    if (all || this.cy._set) repr.setAttributeSvgDouble('cy', this.cy.computed);
    if (all || this.r._set) repr.setAttributeSvgDouble('r', this.r.computed);
    if (all || this.fx._set) repr.setAttributeSvgDouble('fx', this.fx.computed);
    if (all || this.fy._set) repr.setAttributeSvgDouble('fy', this.fy.computed);
    if (all || this.fr._set) repr.setAttributeSvgDouble('fr', this.fr.computed);
    return super.write(xmlDoc, repr, flags);
  }
}
