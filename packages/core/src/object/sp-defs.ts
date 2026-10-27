// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-defs.cpp, src/object/sp-defs.h
/*
 * Authors:
 *   Mitsuru Oka <oka326@parkcity.ne.jp>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2000-2002 authors
 */
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_FLAGS_ALL,
  SP_OBJECT_MODIFIED_FLAG,
  type SPCtx,
  SPObject,
} from './sp-object.ts';

/** svg:defs (upstream SPDefs). */
export class SPDefs extends SPObject {
  protected override update(ctx: SPCtx, flags: number): void {
    flags = cascadeFlags(flags);
    for (const child of this.childList()) {
      if (flags || child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        child.updateDisplay(ctx, flags);
      }
    }
  }

  protected override modified(flags: number): void {
    flags = cascadeFlags(flags);
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
