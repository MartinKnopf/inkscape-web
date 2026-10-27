// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-polyline.cpp, src/object/sp-polyline.h
/*
 * SVG <polyline> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Path } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { SP_OBJECT_WRITE_BUILD } from './sp-object.ts';
import { sp_poly_parse_curve } from './sp-polygon.ts';
import { SPShape } from './sp-shape.ts';

/** svg:polyline (upstream SPPolyLine). */
export class SPPolyLine extends SPShape {
  override typeName(): string {
    return 'path';
  }
  override description(): string {
    return _('<b>Polyline</b>');
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.POINTS);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.POINTS:
        if (value !== null) this.setCurve([sp_poly_parse_curve(value) ?? new Path()]);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:polyline');
    if (!repr) return null;
    if (repr !== this.getRepr()) repr.mergeFrom(this.getRepr(), 'id');
    return super.write(xmlDoc, repr, flags);
  }
}
