// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-glyph-kerning.cpp, src/object/sp-glyph-kerning.h
/*
 * SVG <hkern> and <vkern> elements implementation
 *
 * Author:
 *   Felipe C. da S. Sanches <juca@members.fsf.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2008, Felipe C. da S. Sanches
 */
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { UnicodeRange } from '../unicoderange.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { readNumber } from './sp-font.ts';
import { SP_OBJECT_MODIFIED_FLAG, SP_OBJECT_WRITE_BUILD, SPObject } from './sp-object.ts';

/** A list of glyph names separated by spaces or commas (upstream GlyphNames). */
export class GlyphNames {
  readonly #names: string[];
  constructor(value: string | null) {
    this.#names = value ? value.split(/[\s,]+/).filter(Boolean) : [];
  }
  contains(name: string | null): boolean {
    return !!name && this.#names.includes(name);
  }
}

/** The kerning of glyph pairs (upstream SPGlyphKerning): u1/g1 followed by u2/g2 move by k. */
export class SPGlyphKerning extends SPObject {
  u1 = new UnicodeRange(null);
  g1 = new GlyphNames(null);
  u2 = new UnicodeRange(null);
  g2 = new GlyphNames(null);
  k = 0;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    for (const a of [SPAttr.U1, SPAttr.G1, SPAttr.U2, SPAttr.G2, SPAttr.K]) this.readAttr(a);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.U1:
        this.u1 = new UnicodeRange(value);
        break;
      case SPAttr.U2:
        this.u2 = new UnicodeRange(value);
        break;
      case SPAttr.G1:
        this.g1 = new GlyphNames(value);
        break;
      case SPAttr.G2:
        this.g2 = new GlyphNames(value);
        break;
      case SPAttr.K:
        this.k = readNumber(value, 0);
        break;
      default:
        super.set(key, value);
        return;
    }
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement(this.#tag());
    if (!repr) return null;
    return super.write(xmlDoc, repr, flags);
  }

  #tag(): string {
    return this instanceof SPVkern ? 'svg:vkern' : 'svg:hkern';
  }
}

/** svg:hkern (upstream SPHkern). */
export class SPHkern extends SPGlyphKerning {}
/** svg:vkern (upstream SPVkern). */
export class SPVkern extends SPGlyphKerning {}
