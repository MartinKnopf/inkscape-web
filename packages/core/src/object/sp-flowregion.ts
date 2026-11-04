// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-flowregion.cpp, src/object/sp-flowregion.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import { Affine, type PathVector, write_svg_path } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import { getTextLayoutBackend, type WrapShape } from '../libnrtype/Layout-TNG-Scanline-Makers.ts';
import { SPWindRule } from '../style-enums.ts';
import { modifiedTextChildren } from './sp-flowdiv.ts';
import { SPItem, type SPItemCtx } from './sp-item.ts';
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  type SPCtx,
  type SPObject,
} from './sp-object.ts';
import { SPShape } from './sp-shape.ts';
import { SPUse } from './sp-use.ts';

/** Update the item children with their transform in i2doc and i2vp. */
function updateRegionChildren(region: SPObject, ctx: SPCtx, flags: number): void {
  const ictx = ctx as SPItemCtx;
  for (const child of region.childList()) {
    if (flags || child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
      if (child instanceof SPItem) {
        const cctx: SPItemCtx = {
          ...ictx,
          i2doc: child.transform.multiply(ictx.i2doc),
          i2vp: child.transform.multiply(ictx.i2vp),
        };
        child.updateDisplay(cctx, flags);
      } else {
        child.updateDisplay(ctx, flags);
      }
    }
  }
}

/** The union of two shapes; either may be null (upstream shape_union). */
function shape_union(base_shape: WrapShape | null, add_shape: WrapShape | null): WrapShape | null {
  const backend = getTextLayoutBackend();
  if (!backend || !add_shape) return base_shape;
  if (!base_shape?.hasEdges()) {
    base_shape?.delete();
    return add_shape;
  }
  if (!add_shape.hasEdges()) {
    add_shape.delete();
    return base_shape;
  }
  const temp = backend.booleen(add_shape, base_shape, 0);
  base_shape.delete();
  add_shape.delete();
  return temp;
}

/** The livarot shape of an item of a flow region (upstream extract_shape). */
function extract_shape(item: SPItem): WrapShape | null {
  const backend = getTextLayoutBackend();
  if (!backend) return null;
  let tr_mat: Affine;
  let shape_source: SPItem | null = item;
  if (item instanceof SPUse) {
    shape_source = item.child;
    tr_mat =
      shape_source && item.parent instanceof SPItem
        ? shape_source.getRelativeTransform(item.parent)
        : Affine.identity();
  } else {
    tr_mat = item.transform;
  }
  if (!shape_source) return null;

  let curve: PathVector | null = null;
  if (shape_source instanceof SPShape) {
    if (!shape_source.curve()) shape_source.set_shape();
    curve = shape_source.curve();
  } else if ('getNormalizedBpath' in shape_source && typeof shape_source.getNormalizedBpath === 'function') {
    curve = shape_source.getNormalizedBpath() as PathVector;
  }
  if (!curve) return null;
  const evenodd = shape_source.style.fill_rule.computed === SPWindRule.SP_WIND_RULE_EVENODD;
  return backend.regionShape(write_svg_path(curve), tr_mat, evenodd);
}

/**
 * svg:flowRegion (upstream SPFlowregion): the shapes the text flows into,
 * as livarot shapes in `computed` (in the coordinates of the flowRoot).
 */
export class SPFlowregion extends SPItem {
  computed: WrapShape[] = [];

  protected override update(ctx: SPCtx, flags: number): void {
    updateRegionChildren(this, ctx, cascadeFlags(flags));
    super.update(ctx, flags);
    this.updateComputed();
  }

  protected override release(): void {
    for (const s of this.computed) s.delete();
    this.computed = [];
    super.release();
  }

  updateComputed(): void {
    for (const s of this.computed) s.delete();
    this.computed = [];
    for (const child of this.children) {
      if (child instanceof SPItem) {
        const shape = extract_shape(child);
        if (shape) this.computed.push(shape);
      }
    }
  }

  protected override modified(flags: number): void {
    modifiedTextChildren(this, flags);
  }

  override typeName(): string {
    return 'flow-region';
  }

  override displayName(): string {
    // TRANSLATORS: "Flow region" is an area where text is allowed to flow
    return _('Flow Region');
  }
}

/** svg:flowRegionExclude (upstream SPFlowregionExclude): the union of its shapes is cut out of the flow regions. */
export class SPFlowregionExclude extends SPItem {
  #computed: WrapShape | null = null;

  protected override update(ctx: SPCtx, flags: number): void {
    super.update(ctx, flags);
    updateRegionChildren(this, ctx, cascadeFlags(flags));
    this._updateComputed();
  }

  protected override release(): void {
    this.#computed?.delete();
    this.#computed = null;
    super.release();
  }

  _updateComputed(): void {
    this.#computed?.delete();
    this.#computed = null;
    for (const child of this.children) {
      if (child instanceof SPItem) this.#computed = shape_union(this.#computed, extract_shape(child));
    }
  }

  getComputed(): WrapShape | null {
    return this.#computed;
  }

  protected override modified(flags: number): void {
    modifiedTextChildren(this, flags);
  }

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
