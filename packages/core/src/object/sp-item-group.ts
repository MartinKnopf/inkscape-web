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
import type { Effect } from '../live_effects/effect.ts';
import type { SnapCandidatePoint } from '../snap-candidate.ts';
import type { SnapPreferences } from '../snap-preferences.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { sp_repr_is_meta_element } from '../xml/repr-util.ts';
import { type BBoxType, i2anc_affine, SPItem, type SPItemCtx } from './sp-item.ts';
import { can_have_lpe, lpeItemClasses, SPLPEItem, sp_lpe_item_update_patheffect } from './sp-lpe-item.ts';
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
 * A path effect on a group applies to the shapes in it (update_patheffect).
 * TODO: layer resources in the document, insertBottom, title/desc in write().
 */
export class SPGroup extends SPLPEItem {
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

  /** Move the child items by tr (desktop coordinates). */
  translateChildItems(tr: Affine): void {
    for (const item of this.item_list()) item.move_rel(tr);
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

  protected override removeChild(child: Node): void {
    super.removeChild(child);
    if (this.hasPathEffectRecursive()) {
      sp_lpe_item_update_patheffect(this, true, true);
      this.requestModified(SP_OBJECT_MODIFIED_FLAG);
    }
  }

  /** Run the effects of the children, then the effects of the group on all shapes in it. */
  override update_patheffect(write: boolean): void {
    for (const sub_item of this.item_list()) {
      // don't need lpe version < 1 (issue only reply on lower LPE on nested LPEs
      // this doesn't happen because it's done at very first stage
      // we need to be sure performed to inform lpe original bounds ok,
      // if not original_bbox function fail on update groups
      const SPShape = lpeItemClasses.SPShape;
      if (SPShape && sub_item instanceof SPShape && sub_item.hasPathEffectRecursive()) {
        sub_item.bbox_vis_cache_is_valid = false;
        sub_item.bbox_geom_cache_is_valid = false;
      }
      if (sub_item instanceof SPLPEItem) sub_item.update_patheffect(write);
    }
    // avoid update lpe in each selection
    // must be set also to non effect items (satellites or parents)
    this.lpe_initialized = true;
    if (this.hasPathEffect() && this.pathEffectsEnabled()) {
      this.resetClipPathAndMaskLPE();
      for (const lperef of [...this.path_effect_list]) {
        const lpe = lperef.lpeobject?.get_lpe();
        if (lpe?.isVisible()) {
          lpe.doBeforeEffect_impl(this);
          sp_group_perform_patheffect(this, this, lpe, write);
          lpe.doAfterEffect_impl(this, null);
        }
      }
    }
  }

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

  protected override show(drawing: Drawing, key: number, flags: number): DrawingItem | null {
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

  /** The snap points of the child items. */
  override snappoints(p: SnapCandidatePoint[], snapprefs: SnapPreferences): void {
    for (const o of this.children) if (o instanceof SPItem) o.getSnappoints(p, snapprefs);
  }
}

/**
 * Ungroup group: move its items into its parent at its place, with the
 * group's transform and style merged into each child. Non-items go to defs
 * (title, desc and metadata are dropped). The new items are prepended to
 * children, topmost first.
 * TODO: adjust_paint_recursive (gradients/patterns to userSpaceOnUse), 3D boxes,
 * path effects, clip and mask (/options/maskobject/maskonungroup), clones of
 * the group and of its children (unlink, compensate source transform).
 */
export function sp_item_group_ungroup(group: SPGroup, children: SPItem[]): void {
  const doc = group.document;
  const defs = doc.getDefs();
  const pitem = group.parent;
  if (!(pitem instanceof SPGroup)) throw new Error('sp_item_group_ungroup: parent is no group');
  const prepr = pitem.getRepr();

  /* Step 1 - generate lists of children objects */
  const items: Node[] = [];
  const objects: Node[] = [];
  const g = i2anc_affine(group, group.parent);

  for (const child of group.children) {
    if (child instanceof SPItem) {
      /* Merging of style */
      child.style.merge(group.style);
      // Merging transform
      child.transform = child.transform.multiply(g);
      child.updateRepr();
      items.push(child.getRepr().duplicate(prepr.document()));
    } else {
      objects.push(child.getRepr().duplicate(prepr.document()));
    }
  }

  /* Step 2 - clear group */
  // remember the position of the group
  let insert_after = group.getRepr().prev();
  // the group is leaving forever, no heir, clones should take note; its children however are going to reemerge
  group.deleteObject(true);

  /* Step 3 - add nonitems */
  if (objects.length && defs) {
    const last_def = defs.getRepr().lastChild();
    for (const repr of objects.reverse()) {
      if (!sp_repr_is_meta_element(repr)) defs.getRepr().addChild(repr, last_def);
    }
  }

  /* Step 4 - add items */
  for (const repr of items) {
    // add item
    prepr.addChild(repr, insert_after);
    insert_after = repr;
    // fill in the children list if non-null
    const item = doc.getObjectByRepr(repr);
    if (!(item instanceof SPItem)) throw new Error('sp_item_group_ungroup: item not built');
    item.doWriteTransform(item.transform, null, false);
    children.unshift(item);
    item.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }
}

lpeItemClasses.SPGroup = SPGroup;

function sp_group_perform_patheffect(group: SPGroup, top_group: SPGroup, lpe: Effect, write: boolean): void {
  for (const sub_item of group.item_list()) {
    if (!can_have_lpe(sub_item)) {
      // Reject things with curves that can't have path
      // effects: polygons, paths with offsets, etc.
      continue;
    }
    if (sub_item instanceof SPGroup) {
      sp_group_perform_patheffect(sub_item, top_group, lpe, write);
      continue;
    }
    top_group.applyToClipPath(sub_item, lpe);
    top_group.applyToMask(sub_item, lpe);
    const SPShape = lpeItemClasses.SPShape;
    if (!SPShape || !(sub_item instanceof SPShape)) continue;
    const sub_shape = sub_item;
    // only run LPEs when the shape has a curve defined
    const curve = sub_shape.curve();
    if (!curve) continue;
    lpe.pathvector_before_effect = curve;
    const i2anc = i2anc_affine(sub_shape, top_group);
    const c: [typeof curve] = [curve.map((p) => p.transformed(i2anc))];
    sub_shape.setCurveInsync(c[0]);
    const success = top_group.performOnePathEffect(c, sub_shape, lpe);
    const result = c[0].map((p) => p.transformed(i2anc.inverse()));
    if (success) {
      sub_shape.setCurveInsync(result);
      if (lpe.lpeversion.param_getSVGValue() !== '0') {
        // we are on 1 or up
        sub_shape.bbox_vis_cache_is_valid = false;
        sub_shape.bbox_geom_cache_is_valid = false;
      }
      lpe.pathvector_after_effect = result;
      if (write) sub_item.getRepr().setAttribute('d', sp_svg_write_path(lpe.pathvector_after_effect));
    }
  }
  top_group.applyToClipPath(group, lpe);
  top_group.applyToMask(group, lpe);
}
