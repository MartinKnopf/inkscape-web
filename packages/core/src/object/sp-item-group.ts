// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-item-group.cpp, src/object/sp-item-group.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2006 authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import type { Affine, OptRect } from '@inkscape-web/geom';
import { unify } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { Drawing, DrawingGroup, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { _, C_, ngettext } from '../i18n.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { type BBoxType, SPItem, type SPItemCtx } from './sp-item.ts';
import {
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_FLAGS_ALL,
  SP_OBJECT_MODIFIED_CASCADE,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_PARENT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_WRITE_ALL,
  SP_OBJECT_WRITE_BUILD,
  SP_OBJECT_WRITE_EXT,
  type SPCtx,
} from './sp-object.ts';

export enum LayerMode {
  GROUP,
  LAYER,
  MASK_HELPER,
}

/**
 * svg:g and the base of svg:svg (upstream SPGroup).
 * TODO: LPE, layer resources in the document, ungroup, insertBottom, title/desc in write().
 */
export class SPGroup extends SPItem {
  _layer_mode = LayerMode.GROUP;
  /** Layer mode per display key, see setLayerDisplayMode(). */
  _display_modes = new Map<number, LayerMode>();

  isLayer(): boolean {
    return this._layer_mode === LayerMode.LAYER;
  }
  layerMode(): LayerMode {
    return this._layer_mode;
  }
  setLayerMode(mode: LayerMode): void {
    if (this._layer_mode !== mode) {
      // TODO: document->addResource("layer", this) / removeResource.
      this._layer_mode = mode;
      this.#updateLayerMode();
    }
  }
  effectiveLayerMode(displayKey: number): LayerMode {
    return this._layer_mode === LayerMode.LAYER ? LayerMode.LAYER : this.layerDisplayMode(displayKey);
  }
  layerDisplayMode(displayKey: number): LayerMode {
    return this._display_modes.get(displayKey) ?? LayerMode.GROUP;
  }
  setLayerDisplayMode(displayKey: number, mode: LayerMode): void {
    if (this.layerDisplayMode(displayKey) !== mode) {
      this._display_modes.set(displayKey, mode);
      this.#updateLayerMode(displayKey);
    }
  }
  #updateLayerMode(displayKey = 0): void {
    for (const v of this.views) {
      if (!displayKey || v.key === displayKey) {
        (v.drawingitem as DrawingGroup).setPickChildren(this.effectiveLayerMode(v.key) === LayerMode.LAYER);
      }
    }
  }

  item_list(): SPItem[] {
    return this.children.filter((c): c is SPItem => c instanceof SPItem);
  }
  getItemCount(): number {
    return this.item_list().length;
  }

  protected override build(document: SPDocument, repr: Node): void {
    this.readAttr(SPAttr.INKSCAPE_GROUPMODE);
    super.build(document, repr);
  }

  override set(key: SPAttr, value: string | null): void {
    if (key === SPAttr.INKSCAPE_GROUPMODE) {
      if (value === 'layer') this.setLayerMode(LayerMode.LAYER);
      else if (value === 'maskhelper') this.setLayerMode(LayerMode.MASK_HELPER);
      else this.setLayerMode(LayerMode.GROUP);
    } else {
      super.set(key, value);
    }
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    const item = this.getChildByRepr(child);
    if (item instanceof SPItem) {
      // TODO: this should be moved into SPItem somehow
      if (this.lastChild() === item) {
        // optimization for the common special case where the child is being added at the end
        for (const v of this.views) {
          const ac = item.invokeShow(v.drawing, v.key, v.flags);
          if (ac) v.drawingitem.appendChild(ac);
        }
      } else {
        const position = item.posInParent();
        for (const v of this.views) {
          const ac = item.invokeShow(v.drawing, v.key, v.flags);
          if (ac) {
            v.drawingitem.prependChild(ac);
            ac.setZOrder(position);
          }
        }
      }
    }
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  // The views of a removed child are released in SPItem.release().

  protected override orderChanged(child: Node, oldRef: Node | null, newRef: Node | null): void {
    super.orderChanged(child, oldRef, newRef);
    const item = this.getChildByRepr(child);
    if (item instanceof SPItem) {
      const position = item.posInParent();
      for (const v of item.views) v.drawingitem.setZOrder(position);
    }
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override update(ctx: SPCtx, flags: number): void {
    const ictx = ctx as SPItemCtx;
    let childflags = flags;
    if (flags & SP_OBJECT_MODIFIED_FLAG) childflags |= SP_OBJECT_PARENT_MODIFIED_FLAG;
    childflags &= SP_OBJECT_MODIFIED_CASCADE;
    for (const child of this.childList()) {
      if (childflags || child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        // Reset the context between siblings in case one of them alters it.
        const cctx = { ...ictx };
        if (child instanceof SPItem) {
          cctx.i2doc = child.transform.multiply(ictx.i2doc);
          cctx.i2vp = child.transform.multiply(ictx.i2vp);
        }
        child.updateDisplay(cctx, childflags);
      }
    }

    // For a group, we need to update ourselves *after* updating children.
    // this is because the group might contain shapes such as rect or ellipse,
    // which recompute their equivalent path (a.k.a curve) in the update callback,
    // and this is in turn used when computing bbox.
    super.update(ctx, flags);

    if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) {
      for (const v of this.views) {
        if (this.parent) this.context_style = this.parent.context_style;
        v.drawingitem.setStyle(this.style, this.context_style);
      }
    }
  }

  protected override modified(flags: number): void {
    super.modified(flags);
    if (flags & SP_OBJECT_MODIFIED_FLAG) flags |= SP_OBJECT_PARENT_MODIFIED_FLAG;
    flags &= SP_OBJECT_MODIFIED_CASCADE;

    if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) {
      for (const v of this.views) v.drawingitem.setStyle(this.style);
    }

    for (const child of this.childList()) {
      if (
        flags & SP_OBJECT_FLAGS_ALL ||
        child.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)
      ) {
        child.emitModified(flags);
      }
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD) {
      // TODO: svg:switch, and skip title/desc (written by SPItem).
      repr ??= xmlDoc.createElement('svg:g');
      const l: Node[] = [];
      for (const child of this.children) {
        const crepr = child.write(xmlDoc, null, flags);
        if (crepr) l.push(crepr);
      }
      for (const crepr of l) repr.appendChild(crepr);
    } else {
      for (const child of this.children) child.updateRepr(flags);
    }

    if (repr && flags & SP_OBJECT_WRITE_EXT) {
      let value: string | null = null;
      if (this._layer_mode === LayerMode.LAYER) value = 'layer';
      else if (this._layer_mode === LayerMode.MASK_HELPER) value = 'maskhelper';
      else if (flags & SP_OBJECT_WRITE_ALL) value = 'group';
      repr.setAttribute('inkscape:groupmode', value);
    }

    return super.write(xmlDoc, repr, flags);
  }

  override bbox(transform: Affine, bboxtype: BBoxType): OptRect {
    let bbox: OptRect = null;
    for (const item of this.item_list()) {
      if (!item.isHidden()) {
        bbox = unify(bbox, item.bounds(bboxtype, item.transform.multiply(transform)));
      }
    }
    return bbox;
  }

  override typeName(): string {
    return this._layer_mode === LayerMode.LAYER ? 'layer' : 'group';
  }
  override displayName(): string {
    switch (this._layer_mode) {
      case LayerMode.LAYER:
        return _('Layer');
      case LayerMode.MASK_HELPER:
        return _('Mask Helper');
      default:
        return C_('Noun', 'Group');
    }
  }
  override description(): string {
    const len = this.getItemCount();
    return ngettext('of <b>%d</b> object', 'of <b>%d</b> objects', len).replace('%d', String(len));
  }

  protected override show(drawing: Drawing, key: number, flags: number): DrawingItem {
    const ai = drawing.createGroup();
    ai.setPickChildren(this.effectiveLayerMode(key) === LayerMode.LAYER);
    if (this.parent) this.context_style = this.parent.context_style;
    ai.setStyle(this.style, this.context_style);
    this._showChildren(drawing, ai, key, flags);
    return ai;
  }

  protected override hide(key: number): void {
    for (const item of this.item_list()) item.invokeHide(key);
  }

  _showChildren(drawing: Drawing, ai: DrawingItem, key: number, flags: number): void {
    for (const child of this.item_list()) {
      const ac = child.invokeShow(drawing, key, flags);
      if (ac) ai.appendChild(ac);
    }
  }
}
