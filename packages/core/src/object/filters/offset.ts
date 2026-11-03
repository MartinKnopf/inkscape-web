// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/offset.cpp, src/object/filters/offset.h
/*
 * SVG <feOffset> implementation.
 *
 * Authors:
 *   hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Niko Kiirala <niko@kiirala.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006,2007 authors
 */
import { type Rect, Translate } from '@inkscape-web/geom';
import { SPAttr } from '../../attributes.ts';
import type { SPDocument } from '../../document.ts';
import { read_number } from '../../util/numeric/converters.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

/** svg:feOffset (upstream SPFeOffset). */
export class SPFeOffset extends SPFilterPrimitive {
  dx = 0.0;
  dy = 0.0;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.DX);
    this.readAttr(SPAttr.DY);
  }

  override set(key: SPAttr, value: string | null): void {
    if (key === SPAttr.DX || key === SPAttr.DY) {
      const name = key === SPAttr.DX ? 'dx' : 'dy';
      const read_num = value ? read_number(value) : 0.0;
      if (read_num !== this[name]) {
        this[name] = read_num;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
      }
    } else {
      super.set(key, value);
    }
  }

  override calculate_region(region: Rect): Rect {
    return region.unionWith(region.transformed(Translate(this.dx, this.dy)));
  }
}
