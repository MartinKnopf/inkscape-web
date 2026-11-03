// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/flood.cpp, src/object/filters/flood.h
/*
 * SVG <feFlood> implementation.
 *
 * Authors:
 *   hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006 Hugo Rodrigues
 */
import { SPAttr } from '../../attributes.ts';
import { Color } from '../../colors/color.ts';
import type { SPDocument } from '../../document.ts';
import { strtod } from '../../util/numeric/converters.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

/** svg:feFlood (upstream SPFeFlood). */
export class SPFeFlood extends SPFilterPrimitive {
  flood_color: Color | undefined = undefined;
  opacity = 1.0;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.FLOOD_OPACITY);
    this.readAttr(SPAttr.FLOOD_COLOR);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.FLOOD_COLOR:
        this.flood_color = Color.parse(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.FLOOD_OPACITY: {
        let n_opacity = 1;
        if (value) {
          // A number that is followed by other text is invalid.
          const r = strtod(value);
          n_opacity = r.ok && Number(value.trim()) === r.value ? r.value : 1;
        }
        if (n_opacity !== this.opacity) {
          this.opacity = n_opacity;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      }
      default:
        super.set(key, value);
        break;
    }
  }
}
