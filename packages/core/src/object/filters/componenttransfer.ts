// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/componenttransfer.cpp, src/object/filters/componenttransfer.h
/*
 * SVG <feComponentTransfer> implementation.
 *
 * Authors:
 *   hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006 Hugo Rodrigues
 */
import type { Node } from '../../xml/node.ts';
import { cascadeFlags, SP_OBJECT_CHILD_MODIFIED_FLAG, SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

/** svg:feComponentTransfer (upstream SPFeComponentTransfer); its children are SPFeFuncNode. */
export class SPFeComponentTransfer extends SPFilterPrimitive {
  // TODO: document->addResource("feComponentTransfer", this)

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override removeChild(child: Node): void {
    super.removeChild(child);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override modified(flags: number): void {
    const cflags = cascadeFlags(flags);
    for (const c of this.children) {
      if (cflags || c.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG))
        c.emitModified(cflags);
    }
  }
}
