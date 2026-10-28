// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-use-reference.cpp, src/object/sp-use-reference.h
/*
 * The reference corresponding to href of <use> element.
 *
 * Copyright (C) 2004 Bulia Byak
 * Copyright (C) 2004 Monash University
 */
import { SPItem } from './sp-item.ts';
import type { SPObject } from './sp-object.ts';
import { URIReference } from './uri-references.ts';

/**
 * The reference of a clone to its original: accepts items only (upstream SPUseReference).
 * TODO: SPUsePath (linked offsets).
 */
export class SPUseReference extends URIReference {
  override getObject(): SPItem | null {
    return super.getObject() as SPItem | null;
  }

  protected override _acceptObject(obj: SPObject): boolean {
    if (!(obj instanceof SPItem)) return false;
    return super._acceptObject(obj);
  }
}
