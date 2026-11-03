// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/merge.cpp, src/object/filters/merge.h
/*
 * SVG <feMerge> implementation.
 *
 * Authors:
 *   hugo Rodrigues <haa.rodrigues@gmail.com>
 *
 * Copyright (C) 2006 Hugo Rodrigues
 */
import type { Node } from '../../xml/node.ts';
import { cascadeFlags, SP_OBJECT_CHILD_MODIFIED_FLAG, SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFeMergeNode } from './mergenode.ts';
import type { SlotResolver } from './slot-resolver.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

/** svg:feMerge (upstream SPFeMerge); its children are SPFeMergeNode. */
export class SPFeMerge extends SPFilterPrimitive {
  protected override modified(flags: number): void {
    const cflags = cascadeFlags(flags);
    for (const c of this.children) {
      if (cflags || c.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG))
        c.emitModified(cflags);
    }
  }

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

  override resolve_slots(resolver: SlotResolver): void {
    for (const input of this.children) if (input instanceof SPFeMergeNode) input.resolve_slots(resolver);
    super.resolve_slots(resolver);
  }
}
