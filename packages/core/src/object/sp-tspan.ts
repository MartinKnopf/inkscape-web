// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-tspan.cpp, src/object/sp-tspan.h
/*
 * SVG <text> and <tspan> implementation
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import type { Affine, OptRect } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { Layout } from '../libnrtype/Layout-TNG.ts';
import { sp_text_get_length_upto } from '../text-editing.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { BBoxType, SPItem, type SPItemCtx } from './sp-item.ts';
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_FLAGS_ALL,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_USER_MODIFIED_FLAG_A,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
  type SPObject,
} from './sp-object.ts';
import { SPString } from './sp-string.ts';
import { TextTagAttributes } from './text-tag-attributes.ts';

/** Text specific flags (upstream sp-text.h). */
export const SP_TEXT_CONTENT_MODIFIED_FLAG = SP_OBJECT_USER_MODIFIED_FLAG_A;
export const SP_TEXT_LAYOUT_MODIFIED_FLAG = SP_OBJECT_USER_MODIFIED_FLAG_A;

export enum TSpanRole {
  SP_TSPAN_ROLE_UNSPECIFIED,
  SP_TSPAN_ROLE_PARAGRAPH,
  SP_TSPAN_ROLE_LINE,
}
export const { SP_TSPAN_ROLE_UNSPECIFIED, SP_TSPAN_ROLE_PARAGRAPH, SP_TSPAN_ROLE_LINE } = TSpanRole;

/** The nearest ancestor (or object itself) that has a text layout: the SPText or SPFlowtext. */
export function textRootOf(object: SPObject | null): (SPItem & { layout: Layout }) | null {
  for (let o = object; o; o = o.parent) {
    if (o instanceof SPItem && 'layout' in o && o.layout instanceof Layout)
      return o as SPItem & { layout: Layout };
  }
  return null;
}

/**
 * svg:tspan (upstream SPTSpan). With sodipodi:role="line" a tspan is a line
 * of Inkscape multi-line text: the layout breaks the line before it and
 * computes its x and y.
 * TODO: textPath (upstream SPTextPath in the same file).
 */
export class SPTSpan extends SPItem {
  role = TSpanRole.SP_TSPAN_ROLE_UNSPECIFIED;
  readonly attributes = new TextTagAttributes();

  protected override build(document: SPDocument, repr: Node): void {
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.DX);
    this.readAttr(SPAttr.DY);
    this.readAttr(SPAttr.ROTATE);

    // sodipodi:role is ignored in SVG 2 flowed text (inline-size, shape-inside).
    const text = this.parent;
    const flowed =
      !!text &&
      'has_shape_inside' in text &&
      typeof text.has_shape_inside === 'function' &&
      'has_inline_size' in text &&
      typeof text.has_inline_size === 'function' &&
      (text.has_shape_inside() || text.has_inline_size());
    if (!flowed) this.readAttr(SPAttr.SODIPODI_ROLE);

    super.build(document, repr);
  }

  override set(key: SPAttr, value: string | null): void {
    if (this.attributes.readSingleAttribute(key, value, this.style, this.viewport)) {
      this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
      return;
    }
    switch (key) {
      case SPAttr.SODIPODI_ROLE:
        this.role =
          value === 'line' || value === 'paragraph'
            ? TSpanRole.SP_TSPAN_ROLE_LINE
            : TSpanRole.SP_TSPAN_ROLE_UNSPECIFIED;
        break;
      case SPAttr.STYLE:
        if (value) {
          // Inkscape 0.48 wrote visibility:hidden on empty lines; remove it.
          const stripped = value.replace(/visibility\s*:\s*hidden;*/g, '');
          if (stripped !== value) this.getRepr().setAttributeOrRemoveIfEmpty('style', stripped);
        }
        super.set(key, value);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    const childflags = cascadeFlags(flags);
    for (const ochild of this.children) {
      if (flags || ochild.uflags & SP_OBJECT_MODIFIED_FLAG) ochild.updateDisplay(ctx, childflags);
    }

    super.update(ctx, flags);

    if (
      flags &
      (SP_OBJECT_STYLE_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG | SP_TEXT_LAYOUT_MODIFIED_FLAG)
    ) {
      const ictx = ctx as SPItemCtx;
      const em = this.style.font_size.computed;
      const ex = 0.5 * em; // fixme: get x height from pango or libnrtype.
      this.attributes.update(em, ex, ictx.viewport.width(), ictx.viewport.height());
    }
  }

  protected override modified(flags: number): void {
    const cflags = cascadeFlags(flags);
    for (const ochild of this.children) {
      if (cflags & SP_OBJECT_FLAGS_ALL || ochild.mflags & SP_OBJECT_MODIFIED_FLAG)
        ochild.emitModified(cflags);
    }
  }

  override bbox(transform: Affine, type: BBoxType): OptRect {
    const text = textRootOf(this.parent);
    if (!text) return null;
    return text.layout.bounds(
      transform,
      type === BBoxType.VISUAL_BBOX,
      sp_text_get_length_upto(text, this),
      sp_text_get_length_upto(this, null) - 1,
    );
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:tspan');
    if (!repr) return null;

    this.attributes.writeTo(repr);

    if (flags & SP_OBJECT_WRITE_BUILD) {
      const l: Node[] = [];
      for (const child of this.children) {
        let c_repr: Node | null = null;
        if (child instanceof SPTSpan) c_repr = child.write(xmlDoc, null, flags);
        else if (child instanceof SPString) c_repr = xmlDoc.createTextNode(child.string);
        // TODO: tref and textPath children.
        if (c_repr) l.push(c_repr);
      }
      for (const c of l) repr.appendChild(c);
    } else {
      for (const child of this.children) {
        if (child instanceof SPTSpan) child.updateRepr(flags);
        else if (child instanceof SPString) child.getRepr().setContent(child.string);
      }
    }

    return super.write(xmlDoc, repr, flags);
  }

  override typeName(): string {
    return 'text-data';
  }

  override displayName(): string {
    return _('Text Span');
  }
}
