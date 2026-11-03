// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/specularlighting.cpp, src/object/filters/specularlighting.h
/*
 * SVG <feSpecularLighting> implementation.
 *
 * Authors:
 *   hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Jean-Rene Reinhard <jr@komite.net>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006 Hugo Rodrigues
 */
import { SPAttr } from '../../attributes.ts';
import { Color } from '../../colors/color.ts';
import type { SPDocument } from '../../document.ts';
import { NumberOptNumber } from '../../number-opt-number.ts';
import { strtod } from '../../util/numeric/converters.ts';
import type { XmlDocument } from '../../xml/document.ts';
import type { Node } from '../../xml/node.ts';
import { cascadeFlags, SP_OBJECT_CHILD_MODIFIED_FLAG, SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

/** svg:feSpecularLighting (upstream SPFeSpecularLighting); its child is the light source. */
export class SPFeSpecularLighting extends SPFilterPrimitive {
  surfaceScale = 1.0;
  specularConstant = 1.0;
  specularExponent = 1.0;
  lighting_color: Color | undefined = undefined;
  surfaceScale_set = false;
  specularConstant_set = false;
  specularExponent_set = false;
  kernelUnitLength = new NumberOptNumber(); // TODO

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.SURFACESCALE);
    this.readAttr(SPAttr.SPECULARCONSTANT);
    this.readAttr(SPAttr.SPECULAREXPONENT);
    this.readAttr(SPAttr.KERNELUNITLENGTH);
    this.readAttr(SPAttr.LIGHTING_COLOR);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.SURFACESCALE: {
        const r = value ? strtod(value) : { value: 1, ok: false };
        this.surfaceScale = r.ok ? r.value : 1;
        this.surfaceScale_set = r.ok;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      }
      case SPAttr.SPECULARCONSTANT: {
        const r = value ? strtod(value) : { value: 1, ok: false };
        // should be a positive number ... defaulting to 1
        this.specularConstant = r.ok && r.value >= 0 ? r.value : 1;
        this.specularConstant_set = r.ok && r.value >= 0;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      }
      case SPAttr.SPECULAREXPONENT: {
        const r = value ? strtod(value) : { value: 1, ok: false };
        // should be a positive number ... defaulting to 1
        this.specularExponent = r.ok && r.value >= 0 ? r.value : 1;
        this.specularExponent_set = r.ok && r.value >= 0;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      }
      case SPAttr.KERNELUNITLENGTH:
        //TODO kernelUnitLength
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.LIGHTING_COLOR:
        this.lighting_color = Color.parse(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  protected override modified(flags: number): void {
    const cflags = cascadeFlags(flags);
    for (const c of this.childList()) {
      if (cflags || c.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG))
        c.emitModified(cflags);
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    repr ??= this.getRepr().duplicate(xmlDoc);
    if (this.surfaceScale_set) repr.setAttributeSvgDouble('surfaceScale', this.surfaceScale);
    else repr.removeAttribute('surfaceScale');
    if (this.specularConstant_set) repr.setAttributeSvgDouble('specularConstant', this.specularConstant);
    else repr.removeAttribute('specularConstant');
    if (this.specularExponent_set) repr.setAttributeSvgDouble('specularExponent', this.specularExponent);
    else repr.removeAttribute('specularExponent');
    if (this.lighting_color)
      repr.setAttributeOrRemoveIfEmpty('lighting-color', this.lighting_color.toString());
    return super.write(xmlDoc, repr, flags);
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override removeChild(child: Node): void {
    super.removeChild(child);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override orderChanged(child: Node, oldRef: Node | null, newRef: Node | null): void {
    super.orderChanged(child, oldRef, newRef);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }
}
