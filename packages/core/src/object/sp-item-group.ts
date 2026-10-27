// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-item-group.cpp, src/object/sp-item-group.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2006 authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import { SPItem, type SPItemCtx } from './sp-item.ts';
import {
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_FLAGS_ALL,
  SP_OBJECT_MODIFIED_CASCADE,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_PARENT_MODIFIED_FLAG,
  type SPCtx,
} from './sp-object.ts';

/** svg:g and the base of svg:svg (upstream SPGroup). TODO: layer mode, LPE, views. */
export class SPGroup extends SPItem {
  protected override update(ctx: SPCtx, flags: number): void {
    const ictx = ctx as SPItemCtx;
    let childflags = flags;
    if (flags & SP_OBJECT_MODIFIED_FLAG) childflags |= SP_OBJECT_PARENT_MODIFIED_FLAG;
    childflags &= SP_OBJECT_MODIFIED_CASCADE;
    for (const child of this.childList()) {
      if (childflags || child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        // Reset the context between siblings in case one of them alters it.
        const cctx = { ...ictx };
        if (child instanceof SPItem) {
          cctx.i2doc = child.transform.multiply(ictx.i2doc);
          cctx.i2vp = child.transform.multiply(ictx.i2vp);
        }
        child.updateDisplay(cctx, childflags);
      }
    }
    super.update(ctx, flags);
  }

  protected override modified(flags: number): void {
    super.modified(flags);
    if (flags & SP_OBJECT_MODIFIED_FLAG) flags |= SP_OBJECT_PARENT_MODIFIED_FLAG;
    flags &= SP_OBJECT_MODIFIED_CASCADE;
    for (const child of this.childList()) {
      if (
        flags & SP_OBJECT_FLAGS_ALL ||
        child.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)
      ) {
        child.emitModified(flags);
      }
    }
  }
}
