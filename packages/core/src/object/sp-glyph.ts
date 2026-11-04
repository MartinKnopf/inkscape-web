// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-glyph.cpp, src/object/sp-glyph.h, src/object/sp-missing-glyph.cpp, src/object/sp-missing-glyph.h
/*
 * SVG <glyph> element implementation
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
import { readNumber } from './sp-font.ts';
import { SP_OBJECT_MODIFIED_FLAG, SP_OBJECT_WRITE_BUILD, SPObject } from './sp-object.ts';

export enum glyphArabicForm {
  GLYPH_ARABIC_FORM_INITIAL,
  GLYPH_ARABIC_FORM_MEDIAL,
  GLYPH_ARABIC_FORM_TERMINAL,
  GLYPH_ARABIC_FORM_ISOLATED,
}

export enum glyphOrientation {
  GLYPH_ORIENTATION_HORIZONTAL,
  GLYPH_ORIENTATION_VERTICAL,
  GLYPH_ORIENTATION_BOTH,
}

/** svg:glyph (upstream SPGlyph): a glyph of an SVG font. */
export class SPGlyph extends SPObject {
  unicode = '';
  glyph_name = '';
  d: string | null = null;
  orientation = glyphOrientation.GLYPH_ORIENTATION_BOTH;
  arabic_form = glyphArabicForm.GLYPH_ARABIC_FORM_INITIAL;
  lang: string | null = null;
  horiz_adv_x = 0;
  vert_origin_x = 0;
  vert_origin_y = 0;
  vert_adv_y = 0;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    for (const a of [
      SPAttr.UNICODE,
      SPAttr.GLYPH_NAME,
      SPAttr.D,
      SPAttr.ORIENTATION,
      SPAttr.ARABIC_FORM,
      SPAttr.LANG,
      SPAttr.HORIZ_ADV_X,
      SPAttr.VERT_ORIGIN_X,
      SPAttr.VERT_ORIGIN_Y,
      SPAttr.VERT_ADV_Y,
    ]) {
      this.readAttr(a);
    }
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.UNICODE:
        this.unicode = value ?? '';
        break;
      case SPAttr.GLYPH_NAME:
        this.glyph_name = value ?? '';
        break;
      case SPAttr.D:
        this.d = value;
        break;
      case SPAttr.ORIENTATION:
        this.orientation =
          value === 'h'
            ? glyphOrientation.GLYPH_ORIENTATION_HORIZONTAL
            : value === 'v'
              ? glyphOrientation.GLYPH_ORIENTATION_VERTICAL
              : glyphOrientation.GLYPH_ORIENTATION_BOTH;
        break;
      case SPAttr.ARABIC_FORM:
        this.arabic_form =
          value === 'medial'
            ? glyphArabicForm.GLYPH_ARABIC_FORM_MEDIAL
            : value === 'terminal'
              ? glyphArabicForm.GLYPH_ARABIC_FORM_TERMINAL
              : value === 'isolated'
                ? glyphArabicForm.GLYPH_ARABIC_FORM_ISOLATED
                : glyphArabicForm.GLYPH_ARABIC_FORM_INITIAL;
        break;
      case SPAttr.LANG:
        this.lang = value;
        break;
      case SPAttr.HORIZ_ADV_X:
        this.horiz_adv_x = readNumber(value, 0);
        break;
      case SPAttr.VERT_ORIGIN_X:
        this.vert_origin_x = readNumber(value, 0);
        break;
      case SPAttr.VERT_ORIGIN_Y:
        this.vert_origin_y = readNumber(value, 0);
        break;
      case SPAttr.VERT_ADV_Y:
        this.vert_adv_y = readNumber(value, 0);
        break;
      default:
        super.set(key, value);
        return;
    }
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:glyph');
    if (!repr) return null;
    return super.write(xmlDoc, repr, flags);
  }
}

/** svg:missing-glyph (upstream SPMissingGlyph): the glyph for characters without a glyph. */
export class SPMissingGlyph extends SPObject {
  d: string | null = null;
  horiz_adv_x = 0;
  vert_origin_x = 0;
  vert_origin_y = 0;
  vert_adv_y = 0;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    for (const a of [
      SPAttr.D,
      SPAttr.HORIZ_ADV_X,
      SPAttr.VERT_ORIGIN_X,
      SPAttr.VERT_ORIGIN_Y,
      SPAttr.VERT_ADV_Y,
    ]) {
      this.readAttr(a);
    }
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.D:
        this.d = value;
        break;
      case SPAttr.HORIZ_ADV_X:
        this.horiz_adv_x = readNumber(value, 0);
        break;
      case SPAttr.VERT_ORIGIN_X:
        this.vert_origin_x = readNumber(value, 0);
        break;
      case SPAttr.VERT_ORIGIN_Y:
        this.vert_origin_y = readNumber(value, 0);
        break;
      case SPAttr.VERT_ADV_Y:
        this.vert_adv_y = readNumber(value, 0);
        break;
      default:
        super.set(key, value);
        return;
    }
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }
}
