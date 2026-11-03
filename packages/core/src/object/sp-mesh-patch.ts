// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-mesh-patch.cpp, src/object/sp-mesh-patch.h
/*
 * @gradient meshpatch class.
 *
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { emitModifiedChildren, updateChildren } from './sp-mesh-row.ts';
import { SP_OBJECT_WRITE_BUILD, type SPCtx, SPObject } from './sp-object.ts';

/** A patch of a mesh gradient (svg:meshpatch): its stops give the sides and the corner colors. */
export class SPMeshpatch extends SPObject {
  /** The tensor attribute (offsets of the tensor points from the corners), or null. */
  tensor_string: string | null = null;

  getNextMeshpatch(): SPMeshpatch | null {
    for (let obj = this.getNext(); obj; obj = obj.getNext()) if (obj instanceof SPMeshpatch) return obj;
    return null;
  }

  getPrevMeshpatch(): SPMeshpatch | null {
    for (let obj = this.getPrev(); obj; obj = obj.getPrev()) {
      // The closest previous SPObject that is an SPMeshpatch *should* be ourself.
      if (obj instanceof SPMeshpatch) {
        // Sanity check to ensure we have a proper sibling structure.
        if (obj.getNextMeshpatch() === this) return obj;
        console.warn('SPMeshpatch previous/next relationship broken');
        return null;
      }
    }
    return null;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.TENSOR);
  }

  override set(key: SPAttr, value: string | null): void {
    if (key === SPAttr.TENSOR && value) this.tensor_string = value;
  }

  /** Upstream has no update(); it is here so that the styles of the stops are updated (cascaded). */
  protected override update(ctx: SPCtx, flags: number): void {
    updateChildren(this, ctx, flags);
  }

  protected override modified(flags: number): void {
    emitModifiedChildren(this, flags);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:meshpatch');
    return super.write(xmlDoc, repr, flags);
  }
}
