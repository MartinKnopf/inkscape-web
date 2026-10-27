// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-line.cpp, src/object/sp-line.h
/*
 * SVG <line> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Affine, LineSegment, Path, Point } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { SVGLength } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import type { SPItemCtx } from './sp-item.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
} from './sp-object.ts';
import { SPShape } from './sp-shape.ts';

/** svg:line (upstream SPLine). TODO: convert_to_guides. */
export class SPLine extends SPShape {
  x1 = new SVGLength();
  y1 = new SVGLength();
  x2 = new SVGLength();
  y2 = new SVGLength();

  override typeName(): string {
    return 'path';
  }
  override displayName(): string {
    return _('Line');
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.X1);
    this.readAttr(SPAttr.Y1);
    this.readAttr(SPAttr.X2);
    this.readAttr(SPAttr.Y2);
  }

  override set(key: SPAttr, value: string | null): void {
    /* fixme: we should really collect updates */
    switch (key) {
      case SPAttr.X1:
        this.x1.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y1:
        this.y1.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.X2:
        this.x2.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y2:
        this.y2.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    if (
      flags &
      (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      const ictx = ctx as SPItemCtx;
      const w = ictx.viewport.width();
      const h = ictx.viewport.height();
      const em = this.style.font_size.computed;
      const ex = em * 0.5; // fixme: get from pango or libnrtype.
      this.x1.update(em, ex, w);
      this.x2.update(em, ex, w);
      this.y1.update(em, ex, h);
      this.y2.update(em, ex, h);
      this.set_shape();
    }
    super.update(ctx, flags);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:line');
    if (!repr) return null;
    if (repr !== this.getRepr()) repr.mergeFrom(this.getRepr(), 'id');

    repr.setAttributeSvgDouble('x1', this.x1.computed);
    repr.setAttributeSvgDouble('y1', this.y1.computed);
    repr.setAttributeSvgDouble('x2', this.x2.computed);
    repr.setAttributeSvgDouble('y2', this.y2.computed);

    return super.write(xmlDoc, repr, flags);
  }

  /** Bake the transform into the end points. Nothing remains for the transform attribute. */
  override setTransform(transform: Affine): Affine {
    const p1 = new Point(this.x1.computed, this.y1.computed).transformed(transform);
    const p2 = new Point(this.x2.computed, this.y2.computed).transformed(transform);
    this.x1.computed = p1.x;
    this.y1.computed = p1.y;
    this.x2.computed = p2.x;
    this.y2.computed = p2.y;
    this.adjustStroke(transform.descrim());
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
    return Affine.identity();
  }

  override set_shape(): void {
    const c = new Path(new Point(this.x1.computed, this.y1.computed));
    c.appendCurve(new LineSegment(c.finalPoint(), new Point(this.x2.computed, this.y2.computed)));
    // *_insync does not call update, avoiding infinite recursion when set_shape is called by update
    this.setCurveInsync([c]);
    // LPEs cannot be applied to lines. (the result can (generally) not be represented as SPLine)
  }
}
