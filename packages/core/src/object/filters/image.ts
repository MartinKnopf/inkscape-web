// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/image.cpp, src/object/filters/image.h
/*
 * SVG <feImage> implementation.
 *
 * Authors:
 *   Felipe Corrêa da Silva Sanches <juca@members.fsf.org>
 *   hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007 Felipe Sanches
 * Copyright (C) 2006 Hugo Rodrigues
 */
import { SPAttr } from '../../attributes.ts';
import type { SPDocument } from '../../document.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

/**
 * svg:feImage (upstream SPFeImage): an image file or a document element as the result.
 * TODO: the element and image views (the browser renders the href of the mirrored filter; links to
 * document elements are not mirrored), valid_for(), preserveAspectRatio.
 */
export class SPFeImage extends SPFilterPrimitive {
  href = '';

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.PRESERVEASPECTRATIO);
    this.readAttr(SPAttr.XLINK_HREF);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.XLINK_HREF:
        this.href = value ?? '';
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.PRESERVEASPECTRATIO:
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }
}
