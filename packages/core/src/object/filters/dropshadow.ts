// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/dropshadow.cpp, src/object/filters/dropshadow.h
/*
 * SVG <feDropShadow> implementation.
 *
 * Authors:
 *   Ryan Malloy <ryan@supported.systems>
 *
 * Copyright (C) 2025 Ryan Malloy
 */
import type { Rect } from '@inkscape-web/geom';
import { SPAttr } from '../../attributes.ts';
import { Color } from '../../colors/color.ts';
import type { SPDocument } from '../../document.ts';
import { read_number } from '../../util/numeric/converters.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

/** svg:feDropShadow (upstream SPFeDropShadow). */
export class SPFeDropShadow extends SPFilterPrimitive {
  dx = 2.0; // Default horizontal offset
  dy = 2.0; // Default vertical offset
  stdDeviation = 2.0; // Default blur amount
  flood_color: Color | undefined = undefined; // Shadow color
  flood_opacity = 1.0; // Default full opacity

  get_dx(): number {
    return this.dx;
  }
  get_dy(): number {
    return this.dy;
  }
  get_stdDeviation(): number {
    return this.stdDeviation;
  }
  get_flood_opacity(): number {
    return this.flood_opacity;
  }
  get_flood_color(): Color | undefined {
    return this.flood_color;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.DX);
    this.readAttr(SPAttr.DY);
    this.readAttr(SPAttr.STDDEVIATION);
    this.readAttr(SPAttr.FLOOD_COLOR);
    this.readAttr(SPAttr.FLOOD_OPACITY);
  }

  override set(key: SPAttr, value: string | null): void {
    const num = (name: 'dx' | 'dy' | 'stdDeviation' | 'flood_opacity', def: number) => {
      const read_num = value ? read_number(value) : def;
      if (read_num !== this[name]) {
        this[name] = read_num;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
      }
    };
    switch (key) {
      case SPAttr.DX:
        num('dx', 2.0);
        break;
      case SPAttr.DY:
        num('dy', 2.0);
        break;
      case SPAttr.STDDEVIATION:
        num('stdDeviation', 2.0);
        break;
      case SPAttr.FLOOD_COLOR:
        this.flood_color = Color.parse(value);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.FLOOD_OPACITY:
        num('flood_opacity', 1.0);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  override calculate_region(region: Rect): Rect {
    const blur_expansion = 3.0 * this.stdDeviation; // 3-sigma rule for Gaussian blur
    return region.expandBy(blur_expansion + Math.abs(this.dx), blur_expansion + Math.abs(this.dy));
  }
}
