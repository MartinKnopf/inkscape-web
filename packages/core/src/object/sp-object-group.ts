// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-object-group.cpp, src/object/sp-object-group.h
/*
 * Abstract base class for non-item groups
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2003 Authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG, SP_OBJECT_WRITE_BUILD, SPObject } from './sp-object.ts';

/** Base class of groups that are no items: clipPath, mask (upstream SPObjectGroup). */
export class SPObjectGroup extends SPObject {
  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override removeChild(child: Node): void {
    super.removeChild(child);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override orderChanged(child: Node, oldRef: Node | null, newRef: Node | null): void {
    super.orderChanged(child, oldRef, newRef);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD) {
      repr ??= xmlDoc.createElement('svg:g');
      const l: Node[] = [];
      for (const child of this.children) {
        const crepr = child.write(xmlDoc, null, flags);
        if (crepr) l.push(crepr);
      }
      for (const crepr of l) repr.appendChild(crepr);
    } else {
      for (const child of this.children) child.updateRepr(flags);
    }
    return super.write(xmlDoc, repr, flags);
  }
}
