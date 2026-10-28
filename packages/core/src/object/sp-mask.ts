// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-mask.cpp, src/object/sp-mask.h
/*
 * SVG <mask> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2003 authors
 */
import { type Affine, type OptRect, unify } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { Drawing, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { SPContentUnits } from '../enums.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { contentUnitsTransform, type SPClipMaskView } from './sp-clippath.ts';
import { SP_ITEM_REFERENCE_FLAGS, SPItem } from './sp-item.ts';
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
  type SPObject,
} from './sp-object.ts';
import { SPObjectGroup } from './sp-object-group.ts';
import { URIReference } from './uri-references.ts';

/**
 * svg:mask (upstream SPMask). Like upstream, the mask region (x, y, width, height and
 * maskUnits) is read but not used: the mask is not limited to a region.
 */
export class SPMask extends SPObjectGroup {
  maskUnits_set = false;
  maskUnits = SPContentUnits.SP_CONTENT_UNITS_OBJECTBOUNDINGBOX;
  maskContentUnits_set = false;
  maskContentUnits = SPContentUnits.SP_CONTENT_UNITS_USERSPACEONUSE;
  views: SPClipMaskView[] = [];

  mask_content_units(): SPContentUnits {
    return this.maskContentUnits;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.MASKUNITS);
    this.readAttr(SPAttr.MASKCONTENTUNITS);
    this.readAttr(SPAttr.STYLE);
    // TODO: doc->addResource("mask", this)
  }

  protected override release(): void {
    this.views = [];
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.MASKUNITS:
        this.maskUnits = SPContentUnits.SP_CONTENT_UNITS_OBJECTBOUNDINGBOX;
        this.maskUnits_set = false;
        if (value === 'userSpaceOnUse') {
          this.maskUnits = SPContentUnits.SP_CONTENT_UNITS_USERSPACEONUSE;
          this.maskUnits_set = true;
        } else if (value === 'objectBoundingBox') {
          this.maskUnits_set = true;
        }
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.MASKCONTENTUNITS:
        this.maskContentUnits = SPContentUnits.SP_CONTENT_UNITS_USERSPACEONUSE;
        this.maskContentUnits_set = false;
        if (value === 'userSpaceOnUse') {
          this.maskContentUnits_set = true;
        } else if (value === 'objectBoundingBox') {
          this.maskContentUnits = SPContentUnits.SP_CONTENT_UNITS_OBJECTBOUNDINGBOX;
          this.maskContentUnits_set = true;
        }
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  geometricBounds(transform: Affine): OptRect {
    let bbox: OptRect = null;
    for (const c of this.children) {
      if (c instanceof SPItem) bbox = unify(bbox, c.geometricBounds(c.transform.multiply(transform)));
    }
    return bbox;
  }

  visualBounds(transform: Affine): OptRect {
    let bbox: OptRect = null;
    for (const c of this.children) {
      if (c instanceof SPItem) bbox = unify(bbox, c.visualBounds(c.transform.multiply(transform)));
    }
    return bbox;
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    const item = this.document.getObjectByRepr(child);
    if (item instanceof SPItem) {
      for (const v of this.views) {
        const ac = item.invokeShow(v.drawing, v.key, SP_ITEM_REFERENCE_FLAGS);
        // Fixme: Must take position into account.
        if (ac) v.drawingitem.prependChild(ac);
      }
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    const cflags = cascadeFlags(flags);
    for (const child of this.childList()) {
      if (cflags || child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        child.updateDisplay(ctx, cflags);
      }
    }
    for (const v of this.views) this.#update_view(v);
  }

  #update_view(v: SPClipMaskView): void {
    v.drawingitem.setChildTransform(contentUnitsTransform(this.maskContentUnits, v.bbox));
  }

  protected override modified(flags: number): void {
    const cflags = cascadeFlags(flags);
    for (const child of this.childList()) {
      if (cflags || child.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        child.emitModified(cflags);
      }
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:mask');
    return super.write(xmlDoc, repr, flags);
  }

  /** Create a mask in defs with the nodes reprs as children; returns its id. */
  static create(reprs: Node[], document: SPDocument): string {
    const defsrepr = document.getDefs()?.getRepr();
    if (!defsrepr) throw new Error('SPMask.create: no defs');
    const xml_doc = document.getReprDoc();
    const repr = xml_doc.createElement('svg:mask');
    repr.setAttribute('maskUnits', 'userSpaceOnUse');
    defsrepr.appendChild(repr);
    const mask_id = repr.attribute('id') ?? '';
    const mask_object = document.getObjectById(mask_id);
    for (const node of reprs) mask_object?.appendChildRepr(node);
    if (repr !== defsrepr.lastChild()) {
      defsrepr.changeOrder(repr, defsrepr.lastChild()); // workaround for bug 989084
    }
    return mask_id;
  }

  /** Show the mask for the view key of an item with geometric bounds bbox. */
  show(drawing: Drawing, key: number, bbox: OptRect): DrawingItem {
    const root = drawing.createGroup();
    const v: SPClipMaskView = { drawingitem: root, bbox, key, drawing };
    this.views.push(v);
    for (const child of this.children) {
      if (child instanceof SPItem) {
        const ac = child.invokeShow(drawing, key, SP_ITEM_REFERENCE_FLAGS);
        if (ac) root.appendChild(ac);
      }
    }
    this.#update_view(v);
    return root;
  }

  hide(key: number): void {
    for (const child of this.children) if (child instanceof SPItem) child.invokeHide(key);
    const i = this.views.findIndex((v) => v.key === key);
    if (i < 0) return;
    this.views[i]?.drawingitem.unlink();
    this.views.splice(i, 1);
  }

  setBBox(key: number, bbox: OptRect): void {
    const v = this.views.find((v) => v.key === key);
    if (!v) return;
    v.bbox = bbox;
    this.#update_view(v);
  }
}

/** The reference of an item's mask attribute (upstream SPMaskReference). */
export class SPMaskReference extends URIReference {
  /** Disconnects the modified signal of the mask (set by SPItem). */
  modified_connection: (() => void) | null = null;

  override getObject(): SPMask | null {
    return super.getObject() as SPMask | null;
  }

  protected override _acceptObject(obj: SPObject): boolean {
    if (!(obj instanceof SPMask)) return false;
    if (super._acceptObject(obj)) return true;
    console.warn(
      `WARNING: Ignoring recursive mask reference <${this.getOwner()?.getRepr().name()}> in <${obj.getRepr().name()} id="${obj.getId()}">`,
    );
    return false;
  }
}
