// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-anchor.cpp, src/object/sp-anchor.h
/*
 * SVG <a> element implementation
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2017 Martin Owens
 * Copyright (C) 2001-2002 Lauris Kaplinski
 * Copyright (C) 2001 Ximian, Inc.
 */
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _, C_ } from '../i18n.ts';
import type { XmlDocument } from '../xml/document.ts';
import { setHrefAttribute } from '../xml/href-attribute-helper.ts';
import type { Node } from '../xml/node.ts';
import { SPGroup } from './sp-item-group.ts';
import { SP_OBJECT_MODIFIED_FLAG, SP_OBJECT_WRITE_BUILD } from './sp-object.ts';
import { URIReference } from './uri-references.ts';

/** The characters of an attribute value as XML (upstream xml_quote_strdup). */
function xml_quote(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** svg:a (upstream SPAnchor): a group that links to a URI or to an object of the document. */
export class SPAnchor extends SPGroup {
  href: string | null = null;
  type: string | null = null;
  /** xlink:title (upstream member title; SPObject has the method title() here). */
  xlink_title: string | null = null;
  /** The document of a link of type "page" (upstream createChildDoc). TODO: child documents. */
  page: SPDocument | null = null;
  /** The object that a local link ("#id") points to. */
  local_link: URIReference | null = null;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.XLINK_TYPE);
    this.readAttr(SPAttr.XLINK_ROLE);
    this.readAttr(SPAttr.XLINK_ARCROLE);
    this.readAttr(SPAttr.XLINK_TITLE);
    this.readAttr(SPAttr.XLINK_SHOW);
    this.readAttr(SPAttr.XLINK_ACTUATE);
    this.readAttr(SPAttr.XLINK_HREF);
    this.readAttr(SPAttr.TARGET);
  }

  protected override release(): void {
    this.href = null;
    this.type = null;
    this.xlink_title = null;
    this.page = null;
    this.local_link?.detach();
    this.local_link = null;
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.XLINK_HREF:
        this.href = value;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        this.updatePageAnchor();
        break;
      case SPAttr.XLINK_TYPE:
        this.type = value;
        this.updatePageAnchor();
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.XLINK_ROLE:
      case SPAttr.XLINK_ARCROLE:
      case SPAttr.XLINK_TITLE:
        this.xlink_title = value;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.XLINK_SHOW:
      case SPAttr.XLINK_ACTUATE:
      case SPAttr.TARGET:
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  updatePageAnchor(): void {
    if (this.type === 'page') {
      this.local_link?.detach();
      this.local_link = null;
      // TODO: upstream opens the linked file as a child document (createChildDoc).
    } else if (this.href) {
      this.local_link?.detach();
      this.local_link = new URIReference(this);
      this.local_link.try_attach(this.href);
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) {
      repr = xmlDoc.createElement('svg:a');
    }
    if (repr) {
      setHrefAttribute(repr, this.href);
      if (this.type) repr.setAttribute('xlink:type', this.type);
      if (this.xlink_title) repr.setAttribute('xlink:title', this.xlink_title);
      if (repr !== this.getRepr()) {
        // XML Tree being directly used while it shouldn't be in the below lines
        for (const key of ['xlink:role', 'xlink:arcrole', 'xlink:show', 'xlink:actuate', 'target']) {
          repr.setAttribute(key, this.getRepr().attribute(key));
        }
      }
    }
    return super.write(xmlDoc, repr, flags);
  }

  override typeName(): string {
    return 'link';
  }

  override displayName(): string {
    return C_('Hyperlink|Noun', 'Link');
  }

  override description(): string {
    if (this.href) return _('to %s').replace('%s', xml_quote(this.href));
    return _('without URI');
  }
}
