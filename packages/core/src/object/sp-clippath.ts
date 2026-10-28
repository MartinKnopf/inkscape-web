// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-clippath.cpp, src/object/sp-clippath.h
/*
 * SVG <clipPath> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2001-2002 authors
 * Copyright (C) 2001 Ximian, Inc.
 */
import { Affine, type OptRect, Scale, Translate, unify } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { Drawing, DrawingGroup, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { SPContentUnits } from '../enums.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
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
 * A view of a clip path or mask for one view of the clipped item (upstream ObjectView in
 * object-view.h). `drawing` is extra: upstream gets it from drawingitem->drawing().
 */
export interface SPClipMaskView {
  drawingitem: DrawingGroup;
  bbox: OptRect;
  key: number;
  drawing: Drawing;
}

/** The child transform of a view for objectBoundingBox content units (upstream update_view). */
export function contentUnitsTransform(units: SPContentUnits, bbox: OptRect): Affine {
  if (units === SPContentUnits.SP_CONTENT_UNITS_OBJECTBOUNDINGBOX && bbox) {
    return Scale(bbox.dimensions()).multiply(Translate(bbox.min()));
  }
  return Affine.identity();
}

/** svg:clipPath (upstream SPClipPath). TODO: getPathVector, getTextObject, removeTransformsRecursively. */
export class SPClipPath extends SPObjectGroup {
  clipPathUnits_set = false;
  clipPathUnits = SPContentUnits.SP_CONTENT_UNITS_USERSPACEONUSE;
  views: SPClipMaskView[] = [];

  clippath_units(): SPContentUnits {
    return this.clipPathUnits;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.STYLE);
    this.readAttr(SPAttr.CLIPPATHUNITS);
    // TODO: doc->addResource("clipPath", this)
  }

  protected override release(): void {
    this.views = [];
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    if (key === SPAttr.CLIPPATHUNITS) {
      this.clipPathUnits = SPContentUnits.SP_CONTENT_UNITS_USERSPACEONUSE;
      this.clipPathUnits_set = false;
      if (value === 'userSpaceOnUse') {
        this.clipPathUnits_set = true;
      } else if (value === 'objectBoundingBox') {
        this.clipPathUnits = SPContentUnits.SP_CONTENT_UNITS_OBJECTBOUNDINGBOX;
        this.clipPathUnits_set = true;
      }
      this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    } else {
      super.set(key, value);
    }
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    const item = this.document.getObjectByRepr(child);
    if (item instanceof SPItem) {
      for (const v of this.views) {
        const ac = item.invokeShow(v.drawing, v.key, SP_ITEM_REFERENCE_FLAGS);
        if (ac) v.drawingitem.prependChild(ac);
      }
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    const cflags = cascadeFlags(flags);
    for (const c of this.childList()) {
      if (cflags || c.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        c.updateDisplay(ctx, cflags);
      }
    }
    for (const v of this.views) this.#update_view(v);
  }

  #update_view(v: SPClipMaskView): void {
    v.drawingitem.setChildTransform(contentUnitsTransform(this.clipPathUnits, v.bbox));
  }

  protected override modified(flags: number): void {
    const cflags = cascadeFlags(flags);
    for (const c of this.childList()) {
      if (cflags || c.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        c.emitModified(cflags);
      }
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:clipPath');
    return super.write(xmlDoc, repr, flags);
  }

  /** Show the clip for the view key of an item with geometric bounds bbox. */
  show(drawing: Drawing, key: number, bbox: OptRect): DrawingItem {
    const root = drawing.createGroup();
    const v: SPClipMaskView = { drawingitem: root, bbox, key, drawing };
    this.views.push(v);
    for (const child of this.children) {
      if (child instanceof SPItem) {
        const ac = child.invokeShow(drawing, key, SP_ITEM_REFERENCE_FLAGS);
        // The order is not important in clippath.
        if (ac) root.appendChild(ac);
      }
    }
    root.setStyle(this.style);
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

  geometricBounds(transform: Affine): OptRect {
    let bbox: OptRect = null;
    for (const child of this.children) {
      if (child instanceof SPItem)
        bbox = unify(bbox, child.geometricBounds(child.transform.multiply(transform)));
    }
    return bbox;
  }

  visualBounds(transform: Affine): OptRect {
    // Clips don't support visual modifiers like filters (unlike say, masks), so just provide the geometric bounds
    return this.geometricBounds(transform);
  }

  /** Multiply the transforms of the children by postmul; write them to the reprs if set. */
  transform_multiply(postmul: Affine, set = true): void {
    for (const clip of this.children) {
      if (clip instanceof SPItem) {
        if (set) clip.doWriteTransform(clip.transform.multiply(postmul));
        else clip.setItemTransform(clip.transform.multiply(postmul));
      }
    }
  }

  /** Create a clipPath in defs with the nodes reprs as children; returns its id. */
  static create(reprs: Node[], document: SPDocument): string {
    const defsrepr = document.getDefs()?.getRepr();
    if (!defsrepr) throw new Error('SPClipPath.create: no defs');
    const xml_doc = document.getReprDoc();
    const repr = xml_doc.createElement('svg:clipPath');
    repr.setAttribute('clipPathUnits', 'userSpaceOnUse');
    defsrepr.appendChild(repr);
    const id = repr.attribute('id') ?? '';
    const clip_path_object = document.getObjectById(id);
    for (const node of reprs) clip_path_object?.appendChildRepr(node);
    return id;
  }
}

/** The reference of an item's clip-path attribute (upstream SPClipPathReference). */
export class SPClipPathReference extends URIReference {
  /** Disconnects the modified signal of the clip path (set by SPItem). */
  modified_connection: (() => void) | null = null;

  override getObject(): SPClipPath | null {
    return super.getObject() as SPClipPath | null;
  }

  protected override _acceptObject(obj: SPObject): boolean {
    if (!(obj instanceof SPClipPath)) return false;
    if (super._acceptObject(obj)) return true;
    console.warn(
      `WARNING: Ignoring recursive clippath reference <${this.getOwner()?.getRepr().name()}> in <${obj.getRepr().name()} id="${obj.getId()}">`,
    );
    return false;
  }
}
