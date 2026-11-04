// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-font.cpp, src/object/sp-font.h
/*
 * SVG <font> element implementation
 *
 * Author:
 *   Felipe C. da S. Sanches <juca@members.fsf.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2008, Felipe C. da S. Sanches
 */
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG, SP_OBJECT_WRITE_BUILD, SPObject } from './sp-object.ts';

//I think we should have extra stuff here and in the set method in order to set default value as specified at https://www.w3.org/TR/SVG/fonts.html

// TODO determine better values and/or make these dynamic:
const FNT_DEFAULT_ADV = 1024; // TODO determine proper default
const FNT_DEFAULT_ASCENT = 768; // TODO determine proper default
const FNT_UNITS_PER_EM = 1024; // TODO determine proper default

export { FNT_DEFAULT_ADV, FNT_DEFAULT_ASCENT, FNT_UNITS_PER_EM };

/** A number attribute, or def. */
export function readNumber(value: string | null, def: number): number {
  const v = value === null ? Number.NaN : Number.parseFloat(value);
  return Number.isNaN(v) ? def : v;
}

/** svg:font (upstream SPFont): an SVG font, its glyphs are the children. */
export class SPFont extends SPObject {
  horiz_origin_x = 0;
  horiz_origin_y = 0;
  horiz_adv_x = FNT_DEFAULT_ADV;
  vert_origin_x = FNT_DEFAULT_ADV / 2.0;
  vert_origin_y = FNT_DEFAULT_ASCENT;
  vert_adv_y = FNT_UNITS_PER_EM;
  /** Block the modified notifications of child changes (while the dialog edits). */
  _block = false;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.HORIZ_ORIGIN_X);
    this.readAttr(SPAttr.HORIZ_ORIGIN_Y);
    this.readAttr(SPAttr.HORIZ_ADV_X);
    this.readAttr(SPAttr.VERT_ORIGIN_X);
    this.readAttr(SPAttr.VERT_ORIGIN_Y);
    this.readAttr(SPAttr.VERT_ADV_Y);
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    if (!this._block) this.parent?.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override removeChild(child: Node): void {
    super.removeChild(child);
    if (!this._block) this.parent?.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  override set(key: SPAttr, value: string | null): void {
    // TODO: add decent default values instead of using 0 as default!
    switch (key) {
      case SPAttr.HORIZ_ORIGIN_X:
        this.horiz_origin_x = readNumber(value, 0);
        break;
      case SPAttr.HORIZ_ORIGIN_Y:
        this.horiz_origin_y = readNumber(value, 0);
        break;
      case SPAttr.HORIZ_ADV_X:
        this.horiz_adv_x = readNumber(value, FNT_DEFAULT_ADV);
        break;
      case SPAttr.VERT_ORIGIN_X:
        this.vert_origin_x = readNumber(value, FNT_DEFAULT_ADV / 2.0);
        break;
      case SPAttr.VERT_ORIGIN_Y:
        this.vert_origin_y = readNumber(value, FNT_DEFAULT_ASCENT);
        break;
      case SPAttr.VERT_ADV_Y:
        this.vert_adv_y = readNumber(value, FNT_UNITS_PER_EM);
        break;
      default:
        super.set(key, value);
        return;
    }
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:font');
    if (!repr) return null;
    repr.setAttributeSvgDouble('horiz-origin-x', this.horiz_origin_x);
    repr.setAttributeSvgDouble('horiz-origin-y', this.horiz_origin_y);
    repr.setAttributeSvgDouble('horiz-adv-x', this.horiz_adv_x);
    repr.setAttributeSvgDouble('vert-origin-x', this.vert_origin_x);
    repr.setAttributeSvgDouble('vert-origin-y', this.vert_origin_y);
    repr.setAttributeSvgDouble('vert-adv-y', this.vert_adv_y);
    return super.write(xmlDoc, repr, flags);
  }

  /** Sort the glyphs by their unicode code points (upstream sort_glyphs). */
  sort_glyphs(): void {
    const repr = this.getRepr();
    const glyphs = this.children
      .filter((c) => c.getRepr().name() === 'svg:glyph')
      .map((g) => ({
        cps: [...(g.getRepr().attribute('unicode') ?? '')].map((c) => c.codePointAt(0)!),
        node: g.getRepr(),
      }));
    // compare individual unicode points in each string one by one to establish glyph order
    glyphs.sort((a, b) => {
      for (let i = 0; i < Math.min(a.cps.length, b.cps.length); i++) {
        if (a.cps[i] !== b.cps[i]) return a.cps[i]! - b.cps[i]!;
      }
      return a.cps.length - b.cps.length;
    });
    // remove all glyph nodes from the document; block notifications
    this._block = true;
    for (const g of glyphs) repr.removeChild(g.node);
    // re-add them in the desired order
    for (const g of glyphs) repr.appendChild(g.node);
    this._block = false;
    // notify listeners about the change
    this.parent?.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }
}
