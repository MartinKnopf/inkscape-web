// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-flowregion.cpp, src/object/sp-flowregion.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import type { OptRect } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import { modifiedTextChildren } from './sp-flowdiv.ts';
import { BBoxType, SPItem, type SPItemCtx } from './sp-item.ts';
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  type SPCtx,
} from './sp-object.ts';

/** The union of the bounding boxes (in the coordinates of region's parent) of the shapes in region. */
function regionBounds(region: SPItem): OptRect {
  let box: OptRect = null;
  for (const child of region.children) {
    if (!(child instanceof SPItem)) continue;
    const b = child.bbox(child.transform.multiply(region.transform), BBoxType.GEOMETRIC_BBOX);
    if (b) box = box ? box.unionWith(b) : b;
  }
  return box;
}

/**
 * svg:flowRegion (upstream SPFlowregion): the shapes the text flows into.
 * Interim: the text flows into the bounding box of the shapes (upstream:
 * the shapes themselves, as livarot Shapes in `computed`).
 */
export class SPFlowregion extends SPItem {
  protected override update(ctx: SPCtx, flags: number): void {
    const ictx = ctx as SPItemCtx;
    const childflags = cascadeFlags(flags);
    for (const child of this.childList()) {
      if (childflags || child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        const cctx = child instanceof SPItem ? { ...ictx, i2doc: child.transform.multiply(ictx.i2doc) } : ctx;
        child.updateDisplay(cctx, childflags);
      }
    }
    super.update(ctx, flags);
  }
  protected override modified(flags: number): void {
    modifiedTextChildren(this, flags);
  }
  /** The frame of the text (upstream: the computed shapes). */
  computedBounds(): OptRect {
    return regionBounds(this);
  }
  override typeName(): string {
    return 'flow-region';
  }
  override displayName(): string {
    // TRANSLATORS: "Flow region" is an area where text is allowed to flow
    return _('Flow Region');
  }
}

/** svg:flowRegionExclude (upstream SPFlowregionExclude). TODO: exclusion from the flow. */
export class SPFlowregionExclude extends SPItem {
  override typeName(): string {
    return 'flow-region';
  }
  override displayName(): string {
    // TRANSLATORS: A region "cut out of" a flow region; text is not allowed to flow inside the
    // flow excluded region.  flowRegionExclude in SVG 1.2: see
    // http://www.w3.org/TR/2004/WD-SVG12-20041027/flow.html#flowRegion-elem and
    // http://www.w3.org/TR/2004/WD-SVG12-20041027/flow.html#flowRegionExclude-elem.
    return _('Flow Excluded Region');
  }
}
