// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-tspan.cpp, src/object/sp-tspan.h, src/object/sp-textpath.h
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
import { type Affine, type OptRect, PathVector, write_svg_path } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { Layout } from '../libnrtype/Layout-TNG.ts';
import { getTextLayoutBackend, type TextPathBackend } from '../libnrtype/Layout-TNG-Scanline-Makers.ts';
import { svgNumber } from '../svg/stringstream.ts';
import { SVGLength, SVGLengthUnit } from '../svg/svg-length.ts';
import { sp_text_get_length_upto } from '../text-editing.ts';
import type { XmlDocument } from '../xml/document.ts';
import { setHrefAttribute } from '../xml/href-attribute-helper.ts';
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
import { SPUsePath } from './sp-use-reference.ts';
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
        // TODO: tref children. textPath children shouldn't happen.
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

export enum TextPathSide {
  SP_TEXT_PATH_SIDE_LEFT,
  SP_TEXT_PATH_SIDE_RIGHT,
}

/**
 * svg:textPath (upstream SPTextPath): the text of its children is put on the
 * path it references. originalPath is the livarot path of the source (with
 * the transform of the source and reversed for side="right"), which
 * SPText.rebuildLayout() passes to Layout.fitToPathAlign().
 */
export class SPTextPath extends SPItem {
  readonly attributes = new TextTagAttributes();
  startOffset = new SVGLength();
  side = TextPathSide.SP_TEXT_PATH_SIDE_LEFT;
  originalPath: TextPathBackend | null = null;
  isUpdating = false;
  readonly sourcePath: SPUsePath;

  constructor() {
    super();
    // set up the uri reference
    this.sourcePath = new SPUsePath(this);
    this.sourcePath.user_unlink = sp_textpath_to_text;
  }

  protected override build(document: SPDocument, repr: Node): void {
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.DX);
    this.readAttr(SPAttr.DY);
    this.readAttr(SPAttr.ROTATE);
    this.readAttr(SPAttr.STARTOFFSET);
    this.readAttr(SPAttr.SIDE);
    this.readAttr(SPAttr.XLINK_HREF);
    this.readAttr(SPAttr.STYLE);
    super.build(document, repr);
  }

  protected override release(): void {
    this.originalPath?.delete();
    this.originalPath = null;
    this.sourcePath.quit_listening();
    this.sourcePath.unlink();
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    if (this.attributes.readSingleAttribute(key, value, this.style, this.viewport)) {
      this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
      return;
    }
    switch (key) {
      case SPAttr.XLINK_HREF:
        this.sourcePath.link(value);
        break;
      case SPAttr.SIDE:
        if (!value) return;
        if (value.startsWith('left')) this.side = TextPathSide.SP_TEXT_PATH_SIDE_LEFT;
        else if (value.startsWith('right')) this.side = TextPathSide.SP_TEXT_PATH_SIDE_RIGHT;
        else this.side = TextPathSide.SP_TEXT_PATH_SIDE_LEFT;
        this.sourcePath.sourceDirty = true;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.STARTOFFSET:
        this.startOffset.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  setStartOffset(offset: number): void {
    this.setAttribute('startOffset', `${svgNumber(offset)}%`);
  }

  setSide(new_side: TextPathSide): void {
    this.setAttribute('side', new_side ? 'right' : 'left');
  }

  protected override update(ctx: SPCtx, flags: number): void {
    this.isUpdating = true;
    if (this.sourcePath.sourceDirty) refresh_textpath_source(this);
    this.isUpdating = false;

    const childflags = cascadeFlags(flags);
    for (const ochild of this.children) {
      if (childflags || ochild.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        ochild.updateDisplay(ctx, childflags);
      }
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

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:textPath');
    if (!repr) return null;

    this.attributes.writeTo(repr);
    if (this.side === TextPathSide.SP_TEXT_PATH_SIDE_RIGHT) repr.setAttribute('side', 'right');
    if (this.startOffset._set) {
      if (this.startOffset.unit === SVGLengthUnit.PERCENT) {
        repr.setAttribute('startOffset', `${svgNumber(this.startOffset.computed * 100.0)}%`);
      } else {
        /* FIXME: This logic looks rather undesirable if e.g. startOffset is to be
           in ems. */
        repr.setAttributeSvgDouble('startOffset', this.startOffset.computed);
      }
    }
    if (this.sourcePath.sourceHref) setHrefAttribute(repr, this.sourcePath.sourceHref);

    if (flags & SP_OBJECT_WRITE_BUILD) {
      const l: Node[] = [];
      for (const child of this.children) {
        let c_repr: Node | null = null;
        if (child instanceof SPTSpan) c_repr = child.write(xmlDoc, null, flags);
        else if (child instanceof SPString) c_repr = xmlDoc.createTextNode(child.string);
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
    return _('Text on path');
  }
}

/** Read the path of the source of a textPath (upstream refresh_textpath_source). */
function refresh_textpath_source(tp: SPTextPath): void {
  tp.sourcePath.refresh_source();
  tp.sourcePath.sourceDirty = false;

  const original = tp.sourcePath.originalPath;
  const backend = getTextLayoutBackend();
  if (original && backend) {
    tp.originalPath?.delete();
    let curve_copy = original;
    if (tp.side === TextPathSide.SP_TEXT_PATH_SIDE_RIGHT) curve_copy = PathVector.reversed(curve_copy);
    const item = tp.sourcePath.sourceObject!;
    tp.originalPath = backend.textPath(write_svg_path(curve_copy), item.transform);
  }
}

/** Whether obj is a text whose first child is a textPath (upstream SP_IS_TEXT_TEXTPATH). */
export function SP_IS_TEXT_TEXTPATH(obj: SPObject | null): boolean {
  return !!obj && 'layout' in obj && obj.firstChild() instanceof SPTextPath;
}

/** The path item of a textPath (upstream sp_textpath_get_path_item). */
export function sp_textpath_get_path_item(tp: SPTextPath | null): SPItem | null {
  return tp?.sourcePath.getObject() ?? null;
}

/**
 * Move the children of a textPath to its text and remove it, placing the
 * text near where it was on the path (upstream sp_textpath_to_text).
 */
export function sp_textpath_to_text(tp: SPObject): void {
  const text = tp.parent;
  if (!text) return;

  // make a list of textpath children
  const tp_reprs: Node[] = tp.children.map((o) => o.getRepr());
  for (const repr of tp_reprs) {
    // make a copy of each textpath child
    const copy = repr.duplicate(text.getRepr().document());
    // remove the old repr from under textpath
    tp.getRepr().removeChild(repr);
    // put its copy under text
    text.getRepr().appendChild(copy); // fixme: copy id
  }

  // set x/y on text (to be near where it was when on path)
  // Copied from Layout::fitToPathAlign
  let midpoint = [0, 0];
  const path = tp instanceof SPTextPath ? tp.originalPath : null;
  if (path && tp instanceof SPTextPath) {
    const startOffset = tp.startOffset;
    let offset = 0.0;
    if (startOffset._set) {
      if (startOffset.unit === SVGLengthUnit.PERCENT) offset = startOffset.computed * path.length();
      else offset = startOffset.computed;
    }
    const pos = path.position(offset);
    if (pos.length) midpoint = path.pointAndTangentAt(pos[0]!, pos[1]!).slice(0, 2);
  }
  text.getRepr().setAttributeSvgDouble('x', midpoint[0]!);
  text.getRepr().setAttributeSvgDouble('y', midpoint[1]!);

  //remove textpath
  tp.deleteObject();
}
