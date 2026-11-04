// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-font-face.cpp, src/object/sp-font-face.h
/*
 * SVG <font-face> element implementation
 *
 * Author:
 *   Felipe C. da S. Sanches <juca@members.fsf.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2008, Felipe C. da S. Sanches
 */
import type { SPAttr } from '../attributes.ts';
import { SP_OBJECT_MODIFIED_FLAG, SPObject } from './sp-object.ts';

/**
 * svg:font-face (upstream SPFontFace). The SVG font code reads its
 * attributes from the element (font-family, units-per-em, ascent, descent).
 * TODO: the other descriptors as members.
 */
export class SPFontFace extends SPObject {
  override set(key: SPAttr, value: string | null): void {
    super.set(key, value);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }
}
