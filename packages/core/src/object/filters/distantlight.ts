// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/distantlight.cpp, src/object/filters/distantlight.h
/*
 * SVG <fedistantlight> implementation.
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

/** svg:feDistantLight (upstream SPFeDistantLight), the light source of a lighting primitive. */
export class SPFeDistantLight extends SPObject {
  azimuth = 0;
  azimuth_set = false;
  elevation = 0;
  elevation_set = false;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.AZIMUTH);
    this.readAttr(SPAttr.ELEVATION);
    // TODO: document->addResource("fedistantlight", this)
  }

  /** Read value into the field; false (and the default) if it is no number. */
  #read_float(field: 'azimuth' | 'elevation', value: string | null, def = 0): boolean {
    const r = value ? strtod(value) : { value: def, ok: false };
    this[field] = r.ok ? r.value : def;
    return r.ok;
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.AZIMUTH:
        this.azimuth_set = this.#read_float('azimuth', value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.ELEVATION:
        this.elevation_set = this.#read_float('elevation', value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    repr ??= this.getRepr().duplicate(xmlDoc);
    if (this.azimuth_set) repr.setAttributeSvgDouble('azimuth', this.azimuth);
    if (this.elevation_set) repr.setAttributeSvgDouble('elevation', this.elevation);
    return super.write(xmlDoc, repr, flags);
  }
}
