// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/spotlight.cpp, src/object/filters/spotlight.h
/*
 * SVG <fespotlight> implementation.
 *
 * Authors:
 *   Hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Niko Kiirala <niko@kiirala.com>
 *   Jean-Rene Reinhard <jr@komite.net>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006,2007 Authors
 */
import { SPAttr } from '../../attributes.ts';
import type { SPDocument } from '../../document.ts';
import { strtod } from '../../util/numeric/converters.ts';
import type { XmlDocument } from '../../xml/document.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG, SPObject } from '../sp-object.ts';

/** svg:feSpotLight (upstream SPFeSpotLight), the light source of a lighting primitive. */
export class SPFeSpotLight extends SPObject {
  x = 0;
  x_set = false;
  y = 0;
  y_set = false;
  z = 0;
  z_set = false;
  pointsAtX = 0;
  pointsAtX_set = false;
  pointsAtY = 0;
  pointsAtY_set = false;
  pointsAtZ = 0;
  pointsAtZ_set = false;
  specularExponent = 1;
  specularExponent_set = false;
  limitingConeAngle = 90;
  limitingConeAngle_set = false;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.Z);
    this.readAttr(SPAttr.POINTSATX);
    this.readAttr(SPAttr.POINTSATY);
    this.readAttr(SPAttr.POINTSATZ);
    this.readAttr(SPAttr.SPECULAREXPONENT);
    this.readAttr(SPAttr.LIMITINGCONEANGLE);
    // TODO: document->addResource("fespotlight", this)
  }

  /** Read value into the field; false (and the default) if it is no number. */
  #read_float(
    field:
      | 'x'
      | 'y'
      | 'z'
      | 'pointsAtX'
      | 'pointsAtY'
      | 'pointsAtZ'
      | 'specularExponent'
      | 'limitingConeAngle',
    value: string | null,
    def = 0,
  ): boolean {
    const r = value ? strtod(value) : { value: def, ok: false };
    this[field] = r.ok ? r.value : def;
    return r.ok;
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.X:
        this.x_set = this.#read_float('x', value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y:
        this.y_set = this.#read_float('y', value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Z:
        this.z_set = this.#read_float('z', value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.POINTSATX:
        this.pointsAtX_set = this.#read_float('pointsAtX', value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.POINTSATY:
        this.pointsAtY_set = this.#read_float('pointsAtY', value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.POINTSATZ:
        this.pointsAtZ_set = this.#read_float('pointsAtZ', value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SPECULAREXPONENT:
        this.specularExponent_set = this.#read_float('specularExponent', value, 1);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.LIMITINGCONEANGLE:
        this.limitingConeAngle_set = this.#read_float('limitingConeAngle', value, 90);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    repr ??= this.getRepr().duplicate(xmlDoc);
    if (this.x_set) repr.setAttributeSvgDouble('x', this.x);
    if (this.y_set) repr.setAttributeSvgDouble('y', this.y);
    if (this.z_set) repr.setAttributeSvgDouble('z', this.z);
    if (this.pointsAtX_set) repr.setAttributeSvgDouble('pointsAtX', this.pointsAtX);
    if (this.pointsAtY_set) repr.setAttributeSvgDouble('pointsAtY', this.pointsAtY);
    if (this.pointsAtZ_set) repr.setAttributeSvgDouble('pointsAtZ', this.pointsAtZ);
    if (this.specularExponent_set) repr.setAttributeSvgDouble('specularExponent', this.specularExponent);
    if (this.limitingConeAngle_set) repr.setAttributeSvgDouble('limitingConeAngle', this.limitingConeAngle);
    return super.write(xmlDoc, repr, flags);
  }
}
