// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-style-elem.cpp, src/object/sp-style-elem.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import { type CRStyleSheet, cr_stylesheet_parse } from '../3rdparty/libcroco/cr-stylesheet.ts';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import type { NodeObserver } from '../xml/node-observer.ts';
import { sp_repr_compare_position } from '../xml/repr-sorting.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_STYLESHEET_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  SPObject,
} from './sp-object.ts';

/**
 * svg:style (upstream SPStyleElem): its text is parsed into a style sheet
 * that is part of the cascade of the document. When the text changes, the
 * styles of all objects are read again.
 */
export class SPStyleElem extends SPObject {
  /** If false then we don't process this element (type is not text/css). */
  is_css = true;
  style_sheet: CRStyleSheet | null = null;

  readonly #textNodeObserver: NodeObserver = {
    notifyContentChanged: () => this.read_content(),
  };
  readonly #nodeObserver: NodeObserver = {
    notifyChildAdded: (_node, child) => {
      if (child.type() === 'text') child.addObserver(this.#textNodeObserver);
      this.read_content();
    },
    notifyChildRemoved: (_node, child) => {
      child.removeObserver(this.#textNodeObserver);
      this.read_content();
    },
    notifyChildOrderChanged: () => this.read_content(),
  };

  protected override build(document: SPDocument, repr: Node): void {
    const elems = document.styleElems;
    elems.push(this);
    elems.sort((a, b) => sp_repr_compare_position(a.getRepr(), b.getRepr()));
    this.readAttr(SPAttr.TYPE);
    repr.addObserver(this.#nodeObserver);
    for (const child of repr.children()) {
      if (child.type() === 'text') child.addObserver(this.#textNodeObserver);
    }
    super.build(document, repr);
    this.read_content();
  }

  protected override release(): void {
    const repr = this.getRepr();
    repr.removeObserver(this.#nodeObserver);
    for (const child of repr.children()) child.removeObserver(this.#textNodeObserver);
    const elems = this.document.styleElems;
    const i = elems.indexOf(this);
    if (i >= 0) elems.splice(i, 1);
    this.style_sheet = null;
    this.#restyle();
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    if (key === SPAttr.TYPE) {
      /* TODO: `type' attribute is required.  Give error message as per
         http://www.w3.org/TR/SVG11/implnote.html#ErrorProcessing. */
      // Browsers and SVG 2 treat a missing type as text/css.
      this.is_css = !value || /^text\/css(;|$)/i.test(value);
      return;
    }
    super.set(key, value);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:style');
    if (!repr) return null;
    return super.write(xmlDoc, repr, flags);
  }

  /** Parse the text into the style sheet and read the styles of the document again. */
  read_content(): void {
    let text = '';
    for (const rch of this.getRepr().children()) if (rch.type() === 'text') text += rch.content() ?? '';
    this.style_sheet = /\S/.test(text) ? cr_stylesheet_parse(text) : null;
    this.#restyle();
  }

  /** If style sheet has changed, we need to cascade the entire object tree, top down. */
  #restyle(): void {
    this.document
      ?.getRoot()
      ?.requestDisplayUpdate(
        SP_OBJECT_STYLESHEET_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG | SP_OBJECT_MODIFIED_FLAG,
      );
  }
}
