// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/mergenode.cpp, src/object/filters/mergenode.h
/*
 * feMergeNode implementation. A feMergeNode contains the name of one
 * input image for feMerge.
 *
 * Authors:
 *   Kees Cook <kees@outflux.net>
 *   Niko Kiirala <niko@kiirala.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004,2007 authors
 */
import { SPAttr } from '../../attributes.ts';
import { FilterSlotType } from '../../display/nr-filter-types.ts';
import type { SPDocument } from '../../document.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG, SPObject } from '../sp-object.ts';
import type { SlotResolver } from './slot-resolver.ts';

/** svg:feMergeNode (upstream SPFeMergeNode): one input of feMerge. */
export class SPFeMergeNode extends SPObject {
  in_name: string | null = null;
  in_slot: number = FilterSlotType.NR_FILTER_SLOT_NOT_SET;

  get_in(): number {
    return this.in_slot;
  }

  protected override build(_document: SPDocument, _repr: Node): void {
    this.readAttr(SPAttr.IN_);
  }

  override set(key: SPAttr, value: string | null): void {
    if (key === SPAttr.IN_) {
      if (this.in_name !== value) {
        this.in_name = value;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        this.invalidate_parent_slots();
      }
    } else {
      super.set(key, value);
    }
  }

  invalidate_parent_slots(): void {
    const merge = this.parent as { invalidate_parent_slots?: () => void } | null;
    merge?.invalidate_parent_slots?.();
  }

  resolve_slots(resolver: SlotResolver): void {
    this.in_slot = resolver.read(this.in_name);
  }
}
