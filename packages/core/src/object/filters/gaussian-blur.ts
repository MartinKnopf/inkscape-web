// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/gaussian-blur.cpp, src/object/filters/gaussian-blur.h
/*
 * SVG <gaussianBlur> implementation.
 *
 * Authors:
 *   Hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Niko Kiirala <niko@kiirala.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006,2007 Authors
 */
import type { Rect } from '@inkscape-web/geom';
import { SPAttr } from '../../attributes.ts';
import type { SPDocument } from '../../document.ts';
import { NumberOptNumber } from '../../number-opt-number.ts';
import { svgNumber } from '../../svg/stringstream.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

/** svg:feGaussianBlur (upstream SPGaussianBlur). */
export class SPGaussianBlur extends SPFilterPrimitive {
  stdDeviation = new NumberOptNumber();

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.STDDEVIATION);
  }

  override set(key: SPAttr, value: string | null): void {
    if (key === SPAttr.STDDEVIATION) {
      this.stdDeviation.set(value);
      this.requestModified(SP_OBJECT_MODIFIED_FLAG);
    } else {
      super.set(key, value);
    }
  }

  get_std_deviation(): NumberOptNumber {
    return this.stdDeviation;
  }

  set_deviation(stdDeviation: NumberOptNumber): void {
    const num = stdDeviation.getNumber();
    let arg = svgNumber(num);
    const optnum = stdDeviation.getOptNumber();
    if (optnum !== num && optnum !== -1) arg += ` ${svgNumber(optnum)}`;
    this.getRepr().setAttribute('stdDeviation', arg);
  }

  /**
   * Calculate the region taken up by gaussian blur
   *
   * @param region The original shape's region or previous primitive's region output.
   */
  override calculate_region(region: Rect): Rect {
    const x = this.stdDeviation.getNumber();
    let y = this.stdDeviation.getOptNumber();
    if (y === -1.0) y = x;
    // If not within the default 10% margin (see
    // http://www.w3.org/TR/SVG11/filters.html#FilterEffectsRegion), specify margins
    // The 2.4 is an empirical coefficient: at that distance the cutoff is practically invisible
    // (the opacity at 2.4 * radius is about 3e-3)
    return region.expandBy(2.4 * x, 2.4 * y);
  }
}
