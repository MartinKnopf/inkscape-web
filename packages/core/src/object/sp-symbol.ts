// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-symbol.cpp, src/object/sp-symbol.h
/*
 * SVG <symbol> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 1999-2003 Lauris Kaplinski
 */
import { Affine, type OptRect, Point, Rect, Translate } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { Drawing, DrawingGroup, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { refXNamedToPercent, refYNamedToPercent, SVGLength, SVGLengthUnit } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { SPDimensions } from './sp-dimensions.ts';
import type { BBoxType, SPItemCtx } from './sp-item.ts';
import { SPGroup } from './sp-item-group.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
} from './sp-object.ts';
import { SPUse } from './sp-use.ts';
import { SPViewBox } from './viewbox.ts';

/**
 * svg:symbol (upstream SPSymbol): a group that is not rendered, except as
 * the child of an svg:use that references it. The viewBox and
 * preserveAspectRatio fit it to the viewport; refX and refY move its
 * reference point to the origin of the use.
 */
export class SPSymbol extends SPGroup {
  readonly dims = new SPDimensions();
  /** viewBox, preserveAspectRatio and the child to parent transform (upstream base class SPViewBox). */
  readonly vb = new SPViewBox();
  refX = new SVGLength();
  refY = new SVGLength();

  get c2p(): Affine {
    return this.vb.c2p;
  }

  protected override build(document: SPDocument, repr: Node): void {
    for (const attr of [
      SPAttr.REFX,
      SPAttr.REFY,
      SPAttr.X,
      SPAttr.Y,
      SPAttr.WIDTH,
      SPAttr.HEIGHT,
      SPAttr.VIEWBOX,
      SPAttr.PRESERVEASPECTRATIO,
    ]) {
      this.readAttr(attr);
    }
    super.build(document, repr);
    // TODO: document->addResource("symbol", this)
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.REFX:
        this.refX.readOrUnset(refXNamedToPercent(value));
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.REFY:
        this.refY.readOrUnset(refYNamedToPercent(value));
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.X:
        this.dims.x.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y:
        this.dims.y.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.WIDTH:
        this.dims.width.readOrUnset(value, SVGLengthUnit.PERCENT, 1.0, 1.0);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.HEIGHT:
        this.dims.height.readOrUnset(value, SVGLengthUnit.PERCENT, 1.0, 1.0);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.VIEWBOX:
        this.vb.set_viewBox(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG);
        break;
      case SPAttr.PRESERVEASPECTRATIO:
        this.vb.set_preserveAspectRatio(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  /**
   * Replace the symbol by a group in the current layer (or the parent of the
   * symbol without a desktop): the children move to the group, and the
   * group gets the id of the symbol, so that uses reference it.
   * Upstream: SPSymbol::unSymbol. Returns the group repr.
   * TODO: the current layer of the active desktop (layerManager).
   */
  unSymbol(): Node | null {
    const doc = this.document;
    const xml_doc = doc.getReprDoc();
    doc.ensureUpToDate();

    const group = xml_doc.createElement('svg:g');
    this.parent?.getRepr().appendChild(group);

    // Move all children of the symbol to the group.
    let children = this.children.slice();
    // Converting a group to a symbol inserts a group for a non-translational transform. Strip out
    // the inserted group (or any other group that only adds a transform to the symbol content).
    const only = children.length === 1 ? children[0] : undefined;
    if (
      only instanceof SPGroup &&
      (only.getAttribute('style') === null || only.getAttribute('class') === null)
    ) {
      group.setAttribute('transform', only.getAttribute('transform'));
      children = only.children.slice();
    }
    for (const child of children.reverse()) {
      const repr = child.getRepr();
      repr.parent()?.removeChild(repr);
      group.addChild(repr, null);
    }

    // Copy the relevant attributes.
    for (const attr of [
      'style',
      'class',
      'title',
      'inkscape:transform-center-x',
      'inkscape:transform-center-y',
    ]) {
      group.setAttribute(attr, this.getAttribute(attr));
    }

    // All uses of the symbol follow the group when the symbol is deleted before the id is set.
    const id = this.getAttribute('id');
    this.deleteObject(true);
    group.setAttribute('id', id);
    return group;
  }

  protected override update(ctx: SPCtx, flags: number): void {
    if (this.cloned) {
      const ictx = ctx as SPItemCtx;
      // Calculate x, y, width, height from the parent/initial viewport.
      this.dims.calcDimsFromParentViewport(
        ictx,
        false,
        this.parent instanceof SPUse ? this.parent.dims : null,
      );
      const rctx = this.vb.get_rctx(
        {
          ...ictx,
          viewport: Rect.fromXywh(
            this.dims.x.computed,
            this.dims.y.computed,
            this.dims.width.computed,
            this.dims.height.computed,
          ),
        },
        1,
      );

      // Shift according to refX, refY.
      if (this.refX._set && this.refY._set) {
        this.refX.update(1, 1, this.vb.viewBox.width());
        this.refY.update(1, 1, this.vb.viewBox.height());
        const ref = new Point(this.refX.computed, this.refY.computed).transformed(this.vb.c2p);
        this.vb.c2p = this.vb.c2p.multiply(Translate(-ref.x, -ref.y));
      }

      super.update(rctx, flags);

      // As last step set the additional transform of the drawing group.
      for (const v of this.views) (v.drawingitem as DrawingGroup).setChildTransform(this.vb.c2p);
    } else {
      super.update(ctx, flags);
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:symbol');
    if (repr) {
      if (this.refX._set) repr.setAttribute('refX', this.refX.write());
      if (this.refY._set) repr.setAttribute('refY', this.refY.write());
      this.dims.writeDimensions(repr);
      this.vb.write_viewBox(repr);
      this.vb.write_preserveAspectRatio(repr);
    }
    return super.write(xmlDoc, repr, flags);
  }

  /** A cloned symbol (the child of a use) renders; the symbol in the defs does not. */
  protected override show(drawing: Drawing, key: number, flags: number): DrawingItem | null {
    if (!this.cloned) return null;
    const ai = super.show(drawing, key, flags);
    (ai as DrawingGroup | null)?.setChildTransform(this.vb.c2p);
    return ai;
  }

  protected override hide(key: number): void {
    if (this.cloned) super.hide(key);
  }

  override bbox(transform: Affine, bboxtype: BBoxType): OptRect {
    return super.bbox(this.cloned ? this.vb.c2p.multiply(transform) : Affine.identity(), bboxtype);
  }
}
