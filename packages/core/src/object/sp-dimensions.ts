// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-dimensions.cpp, src/object/sp-dimensions.h
/*
 * SVG dimensions implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Edward Flick (EAF)
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 1999-2005 Authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import { SVGLength, SVGLengthUnit } from '../svg/svg-length.ts';
import type { Node } from '../xml/node.ts';
import type { SPItemCtx } from './sp-item.ts';

/**
 * x, y, width and height of svg:use, svg:image, nested svg:svg, …
 * (upstream SPDimensions). Upstream classes inherit it; here they hold one.
 */
export class SPDimensions {
  x = new SVGLength();
  y = new SVGLength();
  width = new SVGLength();
  height = new SVGLength();

  /**
   * Update computed x/y/width/height for "percent" units and/or from its
   * referencing clone parent.
   *
   * @param assign_to_set Set `_set` to true for x/y/width/height.
   * @param use If not null, then overwrite computed width and height from there.
   */
  calcDimsFromParentViewport(ictx: SPItemCtx, assign_to_set = false, use: SPDimensions | null = null): void {
    const assign = (field: SVGLength) => {
      if (assign_to_set) field._set = true;
    };

    let effectivewidth = this.width;
    let effectiveheight = this.height;

    if (use) {
      if (use.width._set) effectivewidth = use.width;
      if (use.height._set) effectiveheight = use.height;
    }

    if (this.x.unit === SVGLengthUnit.PERCENT) {
      assign(this.x);
      this.x.computed = this.x.value * ictx.viewport.width();
    }

    if (this.y.unit === SVGLengthUnit.PERCENT) {
      assign(this.y);
      this.y.computed = this.y.value * ictx.viewport.height();
    }

    if (effectivewidth.unit === SVGLengthUnit.PERCENT) {
      assign(this.width);
      this.width.computed = effectivewidth.value * ictx.viewport.width();
    } else {
      this.width.computed = effectivewidth.computed;
    }

    if (effectiveheight.unit === SVGLengthUnit.PERCENT) {
      assign(this.height);
      this.height.computed = effectiveheight.value * ictx.viewport.height();
    } else {
      this.height.computed = effectiveheight.computed;
    }
  }

  /** Write the geometric properties (x/y/width/height) to XML attributes, if they are set. */
  writeDimensions(repr: Node): void {
    if (this.x._set) repr.setAttribute('x', this.x.write());
    if (this.y._set) repr.setAttribute('y', this.y.write());
    if (this.width._set) repr.setAttribute('width', this.width.write());
    if (this.height._set) repr.setAttribute('height', this.height.write());
  }
}
