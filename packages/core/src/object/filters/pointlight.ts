// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/pointlight.cpp, src/object/filters/pointlight.h
/*
 * SVG <fepointlight> implementation.
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

/** svg:fePointLight (upstream SPFePointLight), the light source of a lighting primitive. */
export class SPFePointLight extends SPObject {
  x = 0;
  x_set = false;
  y = 0;
  y_set = false;
  z = 0;
  z_set = false;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.Z);
    // TODO: document->addResource("fepointlight", this)
  }

  /** Read value into the field; false (and the default) if it is no number. */
  #read_float(field: 'x' | 'y' | 'z', value: string | null, def = 0): boolean {
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
    return super.write(xmlDoc, repr, flags);
  }
}
