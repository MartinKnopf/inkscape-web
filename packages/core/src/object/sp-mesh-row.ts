// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-mesh-row.cpp, src/object/sp-mesh-row.h
/*
 * @gradient meshrow class.
 *
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_FLAGS_ALL,
  SP_OBJECT_MODIFIED_CASCADE,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
  SPObject,
} from './sp-object.ts';

/** A row of patches of a mesh gradient (svg:meshrow). */
export class SPMeshrow extends SPObject {
  getNextMeshrow(): SPMeshrow | null {
    for (let obj = this.getNext(); obj; obj = obj.getNext()) if (obj instanceof SPMeshrow) return obj;
    return null;
  }

  getPrevMeshrow(): SPMeshrow | null {
    for (let obj = this.getPrev(); obj; obj = obj.getPrev()) {
      // The closest previous SPObject that is an SPMeshrow *should* be ourself.
      if (obj instanceof SPMeshrow) {
        // Sanity check to ensure we have a proper sibling structure.
        if (obj.getNextMeshrow() === this) return obj;
        console.warn('SPMeshrow previous/next relationship broken');
        return null;
      }
    }
    return null;
  }

  /** Upstream has no update(); it is here so that the styles of the stops are updated (cascaded). */
  protected override update(ctx: SPCtx, flags: number): void {
    updateChildren(this, ctx, flags);
  }

  protected override modified(flags: number): void {
    emitModifiedChildren(this, flags);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:meshrow');
    return super.write(xmlDoc, repr, flags);
  }
}

/** Update the children of a mesh row or patch. */
export function updateChildren(object: SPObject, ctx: SPCtx, flags: number): void {
  flags = cascadeFlags(flags);
  for (const child of object.childList()) {
    if (flags || child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
      child.updateDisplay(ctx, flags);
    }
  }
}

/** Emit modified on the children of a mesh row or patch (upstream SPMeshrow::modified). */
export function emitModifiedChildren(object: SPObject, flags: number): void {
  flags &= SP_OBJECT_MODIFIED_CASCADE;
  for (const child of object.childList()) {
    if (
      flags & SP_OBJECT_FLAGS_ALL ||
      child.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)
    ) {
      child.emitModified(flags);
    }
  }
}
