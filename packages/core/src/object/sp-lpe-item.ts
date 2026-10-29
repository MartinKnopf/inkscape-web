// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-lpe-item.cpp, src/object/sp-lpe-item.h
/** \file
 * Base class for live path effect items
 */
/*
 * Authors:
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Bastien Bouclet <bgkweb@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2008 authors
 */
import type { Affine, PathVector } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import type { Effect } from '../live_effects/effect.ts';
import type { EffectType } from '../live_effects/effect-enum.ts';
import type { LivePathEffectObject } from '../live_effects/lpeobject.ts';
import { LPEObjectReference } from '../live_effects/lpeobject-reference.ts';
import { Preferences } from '../preferences.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../svg/svg-path.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { sp_repr_lookup_name } from '../xml/repr-util.ts';
import type { SPGenericEllipse } from './sp-ellipse.ts';
import { SPItem } from './sp-item.ts';
import type { SPGroup } from './sp-item-group.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLESHEET_MODIFIED_FLAG,
  SP_OBJECT_WRITE_EXT,
  type SPObject,
} from './sp-object.ts';
import type { SPPath } from './sp-path.ts';
import type { SPRect } from './sp-rect.ts';
import type { SPShape } from './sp-shape.ts';
import type { SPSpiral } from './sp-spiral.ts';
import type { SPStar } from './sp-star.ts';

export type PathEffectSharedPtr = LPEObjectReference;
export type PathEffectList = PathEffectSharedPtr[];
type HRefList = string[];

/**
 * The subclasses that sp-lpe-item.cpp casts to. They extend SPLPEItem, so this module cannot
 * import them at run time: their modules register them here.
 */
export const lpeItemClasses: {
  SPGroup?: typeof SPGroup;
  SPShape?: typeof SPShape;
  SPPath?: typeof SPPath;
  SPGenericEllipse?: typeof SPGenericEllipse;
  SPRect?: typeof SPRect;
  SPSpiral?: typeof SPSpiral;
  SPStar?: typeof SPStar;
} = {};

const isGroup = (o: SPObject | null): o is SPGroup =>
  !!lpeItemClasses.SPGroup && o instanceof lpeItemClasses.SPGroup;
const isShape = (o: SPObject | null): o is SPShape =>
  !!lpeItemClasses.SPShape && o instanceof lpeItemClasses.SPShape;
const isPath = (o: SPObject | null): o is SPPath =>
  !!lpeItemClasses.SPPath && o instanceof lpeItemClasses.SPPath;
const isEllipse = (o: SPObject | null): o is SPGenericEllipse =>
  !!lpeItemClasses.SPGenericEllipse && o instanceof lpeItemClasses.SPGenericEllipse;

function clear_path_effect_list(l: PathEffectList): void {
  for (const ref of l) {
    ref.unlink();
    ref.destroy();
  }
  l.length = 0;
}

/**
 * An item that can have live path effects: shapes, paths and groups (upstream SPLPEItem). The
 * effects are listed in inkscape:path-effect as "#id;#id2"; the last one is the top of the stack.
 * TODO: satellites of split modes, symbols (onsymbol), clipboard handling, lpe helper paths.
 */
export class SPLPEItem extends SPItem {
  path_effects_enabled = 1;
  path_effect_list: PathEffectList = [];
  #lpe_modified_connection_list: (() => void)[] = [];
  protected current_path_effect: PathEffectSharedPtr | null = null;
  onsymbol = false;
  // avoid update lpe in each selection
  lpe_initialized = false;

  protected override build(document: SPDocument, repr: Node): void {
    this.readAttr(SPAttr.INKSCAPE_PATH_EFFECT);
    super.build(document, repr);
  }

  protected override release(): void {
    // disconnect all modified listeners:
    for (const c of this.#lpe_modified_connection_list) c();
    this.#lpe_modified_connection_list = [];
    clear_path_effect_list(this.path_effect_list);
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    if (key !== SPAttr.INKSCAPE_PATH_EFFECT) {
      super.set(key, value);
      return;
    }
    this.current_path_effect = null;

    // Disable the path effects while populating the LPE list
    sp_lpe_item_enable_path_effects(this, false);

    // disconnect all modified listeners:
    for (const c of this.#lpe_modified_connection_list) c();
    this.#lpe_modified_connection_list = [];

    clear_path_effect_list(this.path_effect_list);

    // Parse the contents of "value" to rebuild the path effect reference list
    if (value) {
      for (const href of value.split(';')) {
        if (!href) continue;
        const path_effect_ref = new LPEObjectReference(this);
        path_effect_ref.link(href);
        if (path_effect_ref.lpeobject?.get_lpe()) {
          // connect modified-listener
          this.#lpe_modified_connection_list.push(
            path_effect_ref.lpeobject.modifiedSignal.connect((_obj, flags) =>
              lpeobject_ref_modified(flags, this),
            ),
          );
        } else if (!this.isOnClipboard()) {
          // something has gone wrong in finding the right patheffect.
          console.warn('Unknown LPE type specified, LPE stack effectively disabled');
          // keep the effect in the lpestack, so the whole stack is effectively disabled but maintained
        }
        this.path_effect_list.push(path_effect_ref);
      }
    }

    sp_lpe_item_enable_path_effects(this, true);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (repr && flags & SP_OBJECT_WRITE_EXT) {
      if (this.hasPathEffect()) {
        repr.setAttributeOrRemoveIfEmpty(
          'inkscape:path-effect',
          patheffectlist_svg_string(this.path_effect_list),
        );
      } else {
        repr.removeAttribute('inkscape:path-effect');
      }
    }
    return super.write(xmlDoc, repr, flags);
  }

  /** The lpeitem is on clipboard */
  isOnClipboard(): boolean {
    return sp_repr_lookup_name(this.document.getReprRoot(), 'inkscape:clipboard', 1) !== null;
  }

  /** returns true when LPE was successful. The result is in curve[0]. */
  performPathEffect(curve: [PathVector], current: SPShape, is_clip_or_mask = false): boolean {
    if (!can_have_lpe(current)) {
      // Reject things that have curves put can't have path
      // effects: polygons, paths with offsets, etc.
      return false;
    }
    if (this.hasPathEffect() && this.pathEffectsEnabled()) {
      const path_effect_list = [...this.path_effect_list];
      const path_effect_list_size = path_effect_list.length;
      for (const lperef of path_effect_list) {
        const lpeobj = lperef.lpeobject;
        if (!lpeobj) {
          /** \todo Investigate the cause of this.
           * For example, this happens when copy pasting an object with LPE applied. Probably because the object is pasted while the effect is not yet pasted to defs, and cannot be found.
           */
          console.warn('SPLPEItem::performPathEffect - NULL lpeobj in list!');
          return false;
        }
        const lpe = lpeobj.get_lpe();
        if (!lpe || !this.performOnePathEffect(curve, current, lpe, is_clip_or_mask)) return false;
        if (lpeobj.hrefList.length) {
          // lpe can be removed on perform (eg: clone lpe on copy)
          if (path_effect_list_size !== this.path_effect_list.length) break;
        }
      }
    }
    return true;
  }

  /** returns true when LPE was successful. */
  performOnePathEffect(curve: [PathVector], current: SPShape, lpe: Effect, is_clip_or_mask = false): boolean {
    if (this.document.isSeeking()) lpe.refresh_widgets = true;
    if (lpe.isVisible()) {
      if (lpe.acceptsNumClicks() > 0 && !lpe.isReady()) {
        // if the effect expects mouse input before being applied and the input is not finished
        // yet, we don't alter the path
        return false;
      }
      //if is not clip or mask or LPE apply to clip and mask
      if (!is_clip_or_mask || lpe.apply_to_clippath_and_mask) {
        lpe.setCurrentShape(current);
        const group = isGroup(this);
        if (!group) lpe.pathvector_before_effect = curve[0];
        // To Calculate BBox on shapes and nested LPE
        current.setCurveInsync(curve[0]);
        // Groups have their doBeforeEffect called elsewhere
        if (lpe.lpeversion.param_getSVGValue() !== '0') {
          // we are on 1 or up
          current.bbox_vis_cache_is_valid = false;
          current.bbox_geom_cache_is_valid = false;
        }
        if (!group && !is_clip_or_mask) lpe.doBeforeEffect_impl(this);

        try {
          curve[0] = lpe.doEffect(curve[0]);
          lpe.has_exception = false;
        } catch (e) {
          console.warn(`Exception during LPE ${lpe.getName()} execution. \n ${e}`);
          // TODO: flash "An exception occurred during execution of the Path Effect." in the desktop message stack.
          lpe.doOnException(this);
          return false;
        }

        if (!group) {
          // To have processed the shape to doAfterEffect
          current.setCurveInsync(curve[0]);
          lpe.pathvector_after_effect = curve[0];
          lpe.doAfterEffect_impl(this, curve[0]);
        }
      }
    }
    return true;
  }

  /** returns false when LPE write unoptimiced */
  optimizeTransforms(): boolean {
    if (isGroup(this)) return false;
    // TODO: spirals and stars with non-uniform scale, measure segments and lattice2 effects.
    if (this.getMaskObject()) return false;
    if (this.getClipObject()) return false;
    if (this.unoptimized()) return false;
    return !Preferences.get().getBool('/options/preservetransform/value', false);
  }

  /** notify tranbsform applied to a LPE */
  override notifyTransform(postmul: Affine): void {
    if (!this.pathEffectsEnabled()) return;
    for (const lperef of [...this.path_effect_list]) {
      const lpe = lperef.lpeobject?.get_lpe();
      if (lpe && !lpe.is_load) lpe.transform_multiply_impl(postmul, this);
    }
  }

  // CPPIFY: make pure virtual
  update_patheffect(_write: boolean): void {}

  addPathEffect(value: string | LivePathEffectObject, reset = false): void {
    if (typeof value !== 'string') {
      this.addPathEffect(`#${value.getRepr().attribute('id')}`, false);
      return;
    }
    if (!value) return;
    // Apply the path effects here because in the casse of a group, lpe->resetDefaults
    // needs that all the subitems have their effects applied
    if (isGroup(this)) sp_lpe_item_update_patheffect(this, false, true);
    // Disable the path effects while preparing the new lpe
    sp_lpe_item_enable_path_effects(this, false);

    // Add the new reference to the list of LPE references
    const hreflist: HRefList = this.path_effect_list.map((it) => it.lpeobject_href ?? '');
    hreflist.push(value);

    this.setAttributeOrRemoveIfEmpty('inkscape:path-effect', hreflist_svg_string(hreflist));
    // Make sure that ellipse is stored as <svg:path>
    if (isEllipse(this)) this.write(this.getRepr().document(), this.getRepr(), SP_OBJECT_WRITE_EXT);
    // make sure there is an original-d for paths!!!
    sp_lpe_item_create_original_path_recursive(this);

    const lpe = this.path_effect_list.at(-1)?.lpeobject?.get_lpe();
    if (lpe) {
      // Ask the path effect to reset itself if it doesn't have parameters yet
      if (reset) {
        // has to be called when all the subitems have their lpes applied
        lpe.resetDefaults(this);
      }
      // perform this once when the effect is applied
      lpe.doOnApply_impl(this);
    }

    //Enable the path effects now that everything is ready to apply the new path effect
    sp_lpe_item_enable_path_effects(this, true);

    // Apply the path effect
    sp_lpe_item_update_patheffect(this, true, true);
  }

  /** If keep_path is true, the item should not be updated, effectively 'flattening' the LPE. */
  removeCurrentPathEffect(keep_paths: boolean): SPLPEItem | null {
    const lperef = this.getCurrentLPEReference();
    if (!lperef) return null;
    const effect_ = this.getCurrentLPE();
    if (effect_) {
      effect_.keep_paths = keep_paths;
      effect_.on_remove_all = false;
      if (effect_.getHolderRemove()) {
        this.deleteObject(true);
        return null;
      }
      effect_.doOnRemove_impl(this);
    }
    //current lpe ref is always our 'own' pointer from the path_effect_list
    const new_list = this.path_effect_list.filter((r) => r !== lperef);
    this.setAttributeOrRemoveIfEmpty('inkscape:path-effect', patheffectlist_svg_string(new_list));
    if (!keep_paths) {
      // Make sure that ellipse is stored as <svg:circle> or <svg:ellipse> if possible.
      if (isEllipse(this)) this.write(this.getRepr().document(), this.getRepr(), SP_OBJECT_WRITE_EXT);
    }
    return sp_lpe_item_cleanup_original_path_recursive(this, keep_paths);
  }

  /** If keep_path is true, the item should not be updated, effectively 'flattening' the LPE. */
  removeAllPathEffects(keep_paths: boolean, recursive = false): SPLPEItem | null {
    if (recursive && isGroup(this)) {
      for (const iter of this.item_list()) {
        if (iter instanceof SPLPEItem && iter.document) iter.removeAllPathEffects(keep_paths, recursive);
      }
    }
    if (!this.hasPathEffect()) return null;
    if (keep_paths && this.path_effect_list.length === 0) return null;
    for (const lperef of [...this.path_effect_list]) {
      const lpe = lperef.lpeobject?.get_lpe();
      if (lpe) {
        lpe.keep_paths = keep_paths;
        lpe.on_remove_all = true;
        if (lpe.getHolderRemove()) {
          this.deleteObject(true);
          return null;
        }
        lpe.doOnRemove_impl(this);
      }
      if (!this.document) {
        // We got deleted ourselves during the removal of the LPE
        return null;
      }
    }
    this.removeAttribute('inkscape:path-effect');
    if (!keep_paths) {
      // Make sure that ellipse is stored as <svg:circle> or <svg:ellipse> if possible.
      if (isEllipse(this)) this.write(this.getRepr().document(), this.getRepr(), SP_OBJECT_WRITE_EXT);
    }
    // SPItem can be changed on remove all LPE items (Shape to Path) We return generated item
    return sp_lpe_item_cleanup_original_path_recursive(this, keep_paths);
  }

  downCurrentPathEffect(): void {
    const lperef = this.getCurrentLPEReference();
    if (!lperef) return;
    const new_list = [...this.path_effect_list];
    const cur = new_list.indexOf(lperef);
    // perhaps current effect is already last effect
    if (cur >= 0 && cur + 1 < new_list.length) {
      [new_list[cur], new_list[cur + 1]] = [new_list[cur + 1] as PathEffectSharedPtr, lperef];
    }
    this.setAttributeOrRemoveIfEmpty('inkscape:path-effect', patheffectlist_svg_string(new_list));
    sp_lpe_item_cleanup_original_path_recursive(this, false);
  }

  upCurrentPathEffect(): void {
    const lperef = this.getCurrentLPEReference();
    if (!lperef) return;
    const new_list = [...this.path_effect_list];
    const cur = new_list.indexOf(lperef);
    if (cur > 0) {
      [new_list[cur], new_list[cur - 1]] = [new_list[cur - 1] as PathEffectSharedPtr, lperef];
    }
    this.setAttributeOrRemoveIfEmpty('inkscape:path-effect', patheffectlist_svg_string(new_list));
    sp_lpe_item_cleanup_original_path_recursive(this, false);
  }

  duplicateCurrentPathEffect(): void {
    const lperef = this.getCurrentLPEReference();
    if (!lperef) return;
    const hreflist: HRefList = [];
    for (const it of this.path_effect_list) {
      hreflist.push(it.lpeobject_href ?? '');
      if (it === lperef && it.lpeobject) {
        const duple = it.lpeobject.fork_private_if_necessary(0);
        hreflist.push(`#${duple.getId()}`);
      }
    }
    this.setAttributeOrRemoveIfEmpty('inkscape:path-effect', hreflist_svg_string(hreflist));
    sp_lpe_item_cleanup_original_path_recursive(this, false);
    this.update_satellites(true);
  }

  flattenCurrentPathEffect(): SPLPEItem | null {
    const lperef = this.getCurrentLPEReference();
    if (!lperef) return null;
    const hreflist: HRefList = [];
    const hreflist2: HRefList = [];
    let done = false;
    for (const it of this.path_effect_list) {
      if (done) hreflist2.push(it.lpeobject_href ?? '');
      else hreflist.push(it.lpeobject_href ?? '');
      if (it === lperef) done = true;
    }
    this.setAttributeOrRemoveIfEmpty('inkscape:path-effect', hreflist_svg_string(hreflist));
    sp_lpe_item_cleanup_original_path_recursive(this, false, false, false, true);
    sp_lpe_item_update_patheffect(this, true, true);

    const lpeitem = this.removeAllPathEffects(true);
    if (lpeitem && hreflist2.length) {
      sp_lpe_item_enable_path_effects(lpeitem, false);
      lpeitem.setAttributeOrRemoveIfEmpty('inkscape:path-effect', hreflist_svg_string(hreflist2));
      sp_lpe_item_create_original_path_recursive(lpeitem);
      sp_lpe_item_enable_path_effects(lpeitem, true);
      sp_lpe_item_update_patheffect(lpeitem, true, true);
      lpeitem.update_satellites(true);
    }
    return lpeitem;
  }

  removePathEffect(lpe: Effect | null, keep_paths: boolean): void {
    if (!lpe) return;
    const lperef = this.path_effect_list.find((r) => r.lpeobject === lpe.getLPEObj());
    if (lperef) {
      this.setCurrentPathEffect(lperef);
      // this function is called only with FILLET_CHAMFER if do with holderRemove LPE`s (clones LPE) need to rework
      this.removeCurrentPathEffect(keep_paths);
    } else {
      console.warn('LPE dont exist to remove');
    }
  }

  /** Move the effect at origin to dest (upstream movePathEffect, used by drag and drop). */
  movePathEffect(origin: number, dest: number, select_moved = false): void {
    const lpe = this.getCurrentLPE();
    if (!lpe) return;
    const lpeobj = lpe.getLPEObj();
    const nlpe = this.path_effect_list.length;
    if (!nlpe || origin === dest || origin > nlpe - 1 || dest > nlpe - 1) return;
    const new_list = [...this.path_effect_list];
    const [moved] = new_list.splice(origin, 1);
    new_list.splice(dest, 0, moved as PathEffectSharedPtr);
    this.setAttributeOrRemoveIfEmpty('inkscape:path-effect', patheffectlist_svg_string(new_list));
    sp_lpe_item_cleanup_original_path_recursive(this, false);
    const select = select_moved
      ? this.path_effect_list[dest]
      : this.path_effect_list.find((r) => r.lpeobject === lpeobj);
    if (select) this.setCurrentPathEffect(select);
  }

  update_satellites(recursive = true): void {
    if (this.path_effect_list.length === 0) return;
    if (recursive && isGroup(this)) {
      for (const iter of this.item_list()) if (iter instanceof SPLPEItem) iter.update_satellites(recursive);
    }
    for (const lperef of [...this.path_effect_list]) lperef.lpeobject?.get_lpe()?.update_satellites();
  }

  /** used for shapes so they can see if they should also disable shape calculation and read from d= */
  hasBrokenPathEffect(): boolean {
    if (this.path_effect_list.length === 0) return false;
    // go through the list; if some are unknown or invalid, return true
    return this.path_effect_list.some((lperef) => !lperef.lpeobject?.get_lpe());
  }

  hasPathEffectOfTypeRecursive(type: EffectType, is_ready = true): boolean {
    const parent = this.parent;
    if (parent instanceof SPLPEItem) {
      return this.hasPathEffectOfType(type, is_ready) || parent.hasPathEffectOfTypeRecursive(type, is_ready);
    }
    return this.hasPathEffectOfType(type, is_ready);
  }

  hasPathEffectOfType(type: EffectType, is_ready = true): boolean {
    for (const it of this.path_effect_list) {
      const lpe = it.lpeobject?.get_lpe();
      if (lpe && lpe.effectType() === type && (is_ready || lpe.isReady())) return true;
    }
    return false;
  }

  /** returns true when any LPE apply to clip or mask. */
  hasPathEffectOnClipOrMask(shape: SPLPEItem): boolean {
    if (shape.hasPathEffectRecursive()) return true;
    if (this.path_effect_list.length === 0) return false;
    return this.path_effect_list.some((lperef) => lperef.lpeobject?.get_lpe()?.apply_to_clippath_and_mask);
  }

  /** returns true when any LPE apply to clip or mask. recursive mode */
  hasPathEffectOnClipOrMaskRecursive(shape: SPLPEItem): boolean {
    const parent = this.parent;
    if (parent instanceof SPLPEItem) {
      return this.hasPathEffectOnClipOrMask(shape) || parent.hasPathEffectOnClipOrMaskRecursive(shape);
    }
    return this.hasPathEffectOnClipOrMask(shape);
  }

  hasPathEffect(): boolean {
    if (this.path_effect_list.length === 0) return false;
    // go through the list; if some are unknown or invalid, we are not an LPE item!
    return this.path_effect_list.every((lperef) => !!lperef.lpeobject?.get_lpe());
  }

  hasPathEffectRecursive(): boolean {
    const parent = this.parent;
    if (parent instanceof SPLPEItem) return this.hasPathEffect() || parent.hasPathEffectRecursive();
    return this.hasPathEffect();
  }

  /** returns top most LPE item with LPE */
  getTopPathEffect(): SPLPEItem {
    const parent = this.parent instanceof SPLPEItem ? this.parent : null;
    if (parent && !this.hasPathEffectRecursive()) return this.hasPathEffect() ? parent : this;
    return parent ? parent.getTopPathEffect() : this;
  }

  /** Reset the curves of the shapes in clip paths and masks to their original (upstream resetClipPathAndMaskLPE). */
  resetClipPathAndMaskLPE(fromrecurse = false): void {
    const resetShape = (shape: SPShape) => {
      shape.setCurveInsync(shape.curveForEdit());
      if (!this.hasPathEffectOnClipOrMaskRecursive(shape)) {
        shape.removeAttribute('inkscape:original-d');
        shape.setCurveBeforeLPE(null);
      } else {
        // make sure there is an original-d for paths!!!
        sp_lpe_item_create_original_path_recursive(shape);
      }
    };
    if (fromrecurse) {
      if (isGroup(this)) {
        for (const iter2 of this.item_list())
          if (iter2 instanceof SPLPEItem) iter2.resetClipPathAndMaskLPE(true);
      } else if (isShape(this)) {
        resetShape(this);
      }
      return;
    }
    for (const owner of [this.getClipObject(), this.getMaskObject()]) {
      if (!owner) continue;
      for (const iter of owner.childList()) {
        if (isGroup(iter)) {
          for (const iter2 of iter.item_list())
            if (iter2 instanceof SPLPEItem) iter2.resetClipPathAndMaskLPE(true);
        } else if (isShape(iter)) {
          resetShape(iter);
        }
      }
    }
  }

  applyToClipPath(to: SPItem, lpe: Effect | null = null): void {
    if (lpe && !lpe.apply_to_clippath_and_mask) return;
    const clip_path = to.getClipObject();
    if (clip_path) {
      for (const clip_data of clip_path.childList()) {
        if (clip_data instanceof SPItem) this.applyToClipPathOrMask(clip_data, to, lpe);
      }
    }
  }

  applyToMask(to: SPItem, lpe: Effect | null = null): void {
    if (lpe && !lpe.apply_to_clippath_and_mask) return;
    const mask = to.getMaskObject();
    if (mask) {
      for (const mask_data of mask.childList()) {
        if (mask_data instanceof SPItem) this.applyToClipPathOrMask(mask_data, to, lpe);
      }
    }
  }

  applyToClipPathOrMask(clip_mask: SPItem, to: SPItem, lpe: Effect | null = null): void {
    if (isGroup(clip_mask)) {
      for (const subitem of clip_mask.item_list()) this.applyToClipPathOrMask(subitem, to, lpe);
    } else if (isShape(clip_mask)) {
      const shape = clip_mask;
      const c = shape.curve();
      if (!c) return;
      const curve: [PathVector] = [c];
      let success = false;
      try {
        success = lpe
          ? this.performOnePathEffect(curve, shape, lpe, true)
          : this.performPathEffect(curve, shape, true);
      } catch (e) {
        console.warn(`Exception during LPE execution. \n ${e}`);
        success = false;
      }
      if (success) {
        const str = sp_svg_write_path(curve[0]);
        shape.setCurveInsync(curve[0]);
        shape.setAttribute('d', str);
      } else {
        // LPE was unsuccessful or doeffect stack return null.. Read the old 'd'-attribute.
        const value = shape.getAttribute('d');
        if (value) shape.setCurve(sp_svg_read_pathv(value));
      }
      shape.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    }
  }

  getFirstPathEffectOfType(type: EffectType): Effect | null {
    for (const i of this.path_effect_list) {
      const lpe = i.lpeobject?.get_lpe();
      if (lpe && lpe.effectType() === type) return lpe;
    }
    return null;
  }

  getPathEffectsOfType(type: EffectType): Effect[] {
    return this.getPathEffects().filter((lpe) => lpe.effectType() === type);
  }

  getPathEffects(): Effect[] {
    const effects: Effect[] = [];
    for (const lperef of this.path_effect_list) {
      const lpe = lperef.lpeobject?.get_lpe();
      if (lpe) effects.push(lpe);
    }
    return effects;
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    if (this.hasPathEffectRecursive()) {
      const ochild = this.getChildByRepr(child);
      if (ochild instanceof SPLPEItem) sp_lpe_item_create_original_path_recursive(ochild);
    }
  }

  protected override removeChild(child: Node): void {
    const ochild = this.getChildByRepr(child);
    if (ochild instanceof SPLPEItem && ochild.hasPathEffectRecursive()) {
      // we not need to update item because keep paths is false
      sp_lpe_item_cleanup_original_path_recursive(ochild, false);
    }
    super.removeChild(child);
  }

  // Return a copy of the effect list
  getEffectList(): PathEffectList {
    return [...this.path_effect_list];
  }

  getPrevLPEReference(lperef: PathEffectSharedPtr): PathEffectSharedPtr | null {
    let prev: PathEffectSharedPtr | null = null;
    for (const it of this.path_effect_list) {
      if (it.lpeobject_repr === lperef.lpeobject_repr) break;
      prev = it;
    }
    return prev;
  }

  getNextLPEReference(lperef: PathEffectSharedPtr): PathEffectSharedPtr | null {
    const i = this.path_effect_list.findIndex((it) => it.lpeobject_repr === lperef.lpeobject_repr);
    return i >= 0 ? (this.path_effect_list[i + 1] ?? null) : null;
  }

  getLastLPEReference(): PathEffectSharedPtr | null {
    return this.path_effect_list.at(-1) ?? null;
  }

  getLPEReferenceIndex(lperef: PathEffectSharedPtr): number {
    return this.path_effect_list.findIndex((it) => it.lpeobject_repr === lperef.lpeobject_repr);
  }

  getCurrentLPEReference(): PathEffectSharedPtr | null {
    const last = this.path_effect_list.at(-1);
    if (!this.current_path_effect && last) this.setCurrentPathEffect(last);
    if (this.path_effect_list.length === 0) this.current_path_effect = null;
    return this.current_path_effect;
  }

  getCurrentLPE(): Effect | null {
    return this.getCurrentLPEReference()?.lpeobject?.get_lpe() ?? null;
  }

  getPrevLPE(lpe: Effect): Effect | null {
    let prev: Effect | null = null;
    for (const it of this.path_effect_list) {
      if (it.lpeobject === lpe.getLPEObj()) break;
      prev = it.lpeobject?.get_lpe() ?? null;
    }
    return prev;
  }

  getNextLPE(lpe: Effect): Effect | null {
    const i = this.path_effect_list.findIndex((it) => it.lpeobject === lpe.getLPEObj());
    return i >= 0 ? (this.path_effect_list[i + 1]?.lpeobject?.get_lpe() ?? null) : null;
  }

  getLastLPE(): Effect | null {
    return this.path_effect_list.at(-1)?.lpeobject?.get_lpe() ?? null;
  }

  countLPEOfType(type: EffectType, inc_hidden = true, is_ready = true): number {
    let counter = 0;
    for (const it of this.path_effect_list) {
      const lpe = it.lpeobject?.get_lpe();
      if (
        lpe &&
        lpe.effectType() === type &&
        (lpe.isVisible() || inc_hidden) &&
        (is_ready || lpe.isReady())
      ) {
        counter++;
      }
    }
    return counter;
  }

  getLPEIndex(lpe: Effect): number {
    return this.path_effect_list.findIndex((it) => it.lpeobject === lpe.getLPEObj());
  }

  setCurrentPathEffect(lperef: PathEffectSharedPtr | LivePathEffectObject): boolean {
    const repr = lperef instanceof LPEObjectReference ? lperef.lpeobject_repr : lperef.getRepr();
    for (const it of this.path_effect_list) {
      if (it.lpeobject_repr === repr) {
        this.current_path_effect = it; // current_path_effect should always be a pointer from the path_effect_list !
        return true;
      }
    }
    return false;
  }

  get_satellites(force = true, recursive = false, onchilds = false): SPObject[] {
    const satellites: SPObject[] = [];
    if (onchilds && isGroup(this)) {
      for (const child of this.item_list()) {
        if (child instanceof SPLPEItem) satellites.push(...child.get_satellites(force, recursive));
      }
    }
    for (const it of this.path_effect_list) {
      const lpe = it.lpeobject?.get_lpe();
      if (lpe) satellites.unshift(...lpe.effect_get_satellites(force));
    }
    if (recursive) {
      const allsatellites: SPObject[] = [];
      for (const satellite of satellites) {
        if (satellite instanceof SPLPEItem)
          allsatellites.unshift(...satellite.get_satellites(force, recursive));
      }
      satellites.unshift(...allsatellites);
    }
    return satellites;
  }

  /**
   * Writes a new "inkscape:path-effect" string to xml, where the old_lpeobjects are substituted by the new ones.
   *  Note that this method messes up the item's \c PathEffectList.
   */
  replacePathEffects(old_lpeobjs: LivePathEffectObject[], new_lpeobjs: LivePathEffectObject[]): void {
    const hreflist: HRefList = [];
    for (const it of this.path_effect_list) {
      const found_index = it.lpeobject ? old_lpeobjs.indexOf(it.lpeobject) : -1;
      if (found_index >= 0) {
        hreflist.push(`#${new_lpeobjs[found_index]?.getRepr().attribute('id')}`);
      } else {
        hreflist.push(it.lpeobject_href ?? '');
      }
    }
    this.setAttributeOrRemoveIfEmpty('inkscape:path-effect', hreflist_svg_string(hreflist));
  }

  /**
   *  Check all effects in the stack if they are used by other items, and fork them if so.
   *  It is not recommended to fork the effects by yourself calling LivePathEffectObject::fork_private_if_necessary,
   *  use this method instead.
   *  Returns true if one or more effects were forked; returns false if nothing was done.
   */
  forkPathEffectsIfNecessary(nr_of_allowed_users = 1, recursive = true, force = false): boolean {
    let forked = false;
    if (isGroup(this) && recursive) {
      for (const child of this.item_list()) {
        if (child instanceof SPLPEItem && child.forkPathEffectsIfNecessary(nr_of_allowed_users, recursive)) {
          forked = true;
        }
      }
    }
    if (this.hasPathEffect()) {
      // If one of the path effects is used by 2 or more items, fork it
      // so that each object has its own independent copy of the effect.
      // Note: replacing path effects messes up the path effect list

      // Clones of the LPEItem will increase the refcount of the lpeobjects.
      // Therefore, nr_of_allowed_users should be increased with the number of clones (i.e. refs to the lpeitem)
      nr_of_allowed_users += this.hrefcount;
      if (force) nr_of_allowed_users = 1;
      const old_lpeobjs: LivePathEffectObject[] = [];
      const new_lpeobjs: LivePathEffectObject[] = [];
      for (const it of this.getEffectList()) {
        const lpeobj = it.lpeobject;
        if (!lpeobj) continue;
        const forked_lpeobj = lpeobj.fork_private_if_necessary(nr_of_allowed_users);
        if (forked_lpeobj !== lpeobj) {
          forked = true;
          const lpe = forked_lpeobj.get_lpe();
          if (lpe) {
            lpe.is_load = true;
            lpe.sp_lpe_item = this;
          }
          old_lpeobjs.push(lpeobj);
          new_lpeobjs.push(forked_lpeobj);
        }
      }
      if (forked) {
        this.replacePathEffects(old_lpeobjs, new_lpeobjs);
        for (const forked_lpeobj of new_lpeobjs) forked_lpeobj.get_lpe()?.read_from_SVG();
      }
    }
    return forked;
  }

  // Are the path effects enabled on this item ?
  pathEffectsEnabled(): boolean {
    return !this.onsymbol && this.path_effects_enabled > 0;
  }
}

/** Calls any registered handlers for the update_patheffect action */
export function sp_lpe_item_update_patheffect(
  lpeitem: SPLPEItem,
  wholetree: boolean,
  write: boolean,
  with_satellites = false,
): void {
  // Do not check for LPE item to allow LPE work on clips/mask
  if (!lpeitem.pathEffectsEnabled()) return;
  let top: SPLPEItem;
  if (wholetree) {
    let prev_parent = lpeitem;
    let parent = prev_parent.parent instanceof SPLPEItem ? prev_parent.parent : null;
    while (parent?.hasPathEffectRecursive()) {
      prev_parent = parent;
      parent = prev_parent.parent instanceof SPLPEItem ? prev_parent.parent : null;
    }
    top = prev_parent;
  } else {
    top = lpeitem;
  }
  top.update_patheffect(write);
  if (with_satellites) lpeitem.update_satellites();
}

/** Gets called when any of the lpestack's lpeobject repr contents change: i.e. parameter change in any of the stacked LPEs */
function lpeobject_ref_modified(flags: number, lpeitem: SPLPEItem): void {
  if (
    !lpeitem.document.isSeeking() &&
    flags !== 29 &&
    flags !== 253 &&
    !(flags & SP_OBJECT_STYLESHEET_MODIFIED_FLAG)
  ) {
    sp_lpe_item_update_patheffect(lpeitem, false, true, true);
  }
}

function sp_lpe_item_create_original_path_recursive(lpeitem: SPLPEItem): void {
  for (const owner of [lpeitem.getClipObject(), lpeitem.getMaskObject()]) {
    if (!owner) continue;
    for (const iter of owner.childList()) {
      if (iter instanceof SPLPEItem) sp_lpe_item_create_original_path_recursive(iter);
    }
  }
  if (isGroup(lpeitem)) {
    for (const subitem of lpeitem.item_list()) {
      if (subitem instanceof SPLPEItem) sp_lpe_item_create_original_path_recursive(subitem);
    }
  } else if (isPath(lpeitem)) {
    if (!lpeitem.getAttribute('inkscape:original-d')) {
      const value = lpeitem.getAttribute('d');
      if (value) lpeitem.setAttribute('inkscape:original-d', value);
    }
  } else if (isShape(lpeitem)) {
    if (!lpeitem.curveBeforeLPE()) lpeitem.setCurveBeforeLPE(lpeitem.curve());
  }
}

function sp_lpe_item_cleanup_original_path_recursive(
  lpeitem: SPLPEItem | null,
  keep_paths: boolean,
  force = false,
  is_clip_mask = false,
  is_flatten = false,
): SPLPEItem | null {
  if (!lpeitem) return null;
  for (const owner of [lpeitem.getClipObject(), lpeitem.getMaskObject()]) {
    if (!owner) continue;
    for (const iter of owner.childList()) {
      if (iter instanceof SPLPEItem) {
        sp_lpe_item_cleanup_original_path_recursive(
          iter,
          keep_paths,
          !lpeitem.hasPathEffectRecursive(),
          true,
        );
      }
    }
  }

  if (isGroup(lpeitem)) {
    for (const iter of lpeitem.item_list()) {
      if (iter instanceof SPLPEItem) {
        if (isShape(iter)) {
          const value = iter.getAttribute('d');
          if (value) iter.setCurve(sp_svg_read_pathv(value));
        }
        sp_lpe_item_cleanup_original_path_recursive(iter, keep_paths, false, false, is_flatten);
      }
    }
  } else if (isPath(lpeitem)) {
    const repr = lpeitem.getRepr();
    if (
      repr.attribute('inkscape:original-d') &&
      !lpeitem.hasPathEffectRecursive() &&
      (!is_clip_mask || (is_clip_mask && force))
    ) {
      if (!keep_paths) repr.setAttribute('d', repr.attribute('inkscape:original-d'));
      repr.removeAttribute('inkscape:original-d');
      lpeitem.setCurveBeforeLPE(null);
      const c = lpeitem.curve();
      if (!c || c.reduce((n, p) => n + p.size(), 0) === 0) {
        repr.parent()?.removeChild(repr); // will delete lpeitem
        return null;
      }
    } else if (!keep_paths) {
      // we dont want to update the whole tree when we flatten
      sp_lpe_item_update_patheffect(lpeitem, !is_flatten, true);
    }
  } else if (isShape(lpeitem)) {
    const shape = lpeitem;
    const repr = lpeitem.getRepr();
    const c_lpe = shape.curve();
    let d_str: string;
    if (c_lpe) d_str = sp_svg_write_path(c_lpe);
    else if (shape.getAttribute('d')) d_str = shape.getAttribute('d') as string;
    else return lpeitem;
    if (!lpeitem.hasPathEffectRecursive() && (!is_clip_mask || (is_clip_mask && force))) {
      if (!keep_paths) {
        repr.removeAttribute('d');
        shape.setCurveBeforeLPE(null);
      } else {
        lpeitem = shape_to_path(shape, d_str);
      }
    } else if (!keep_paths) {
      // we dont want to update the whole tree when we flatten
      sp_lpe_item_update_patheffect(lpeitem, !is_flatten, true);
    }
  }
  if (
    lpeitem?.getRepr() &&
    !lpeitem.getAttribute('inkscape:path-effect') &&
    lpeitem.path_effect_list.length
  ) {
    clear_path_effect_list(lpeitem.path_effect_list);
  }
  return lpeitem;
}

/** Replace shape by an svg:path with the path data d_str (part of sp_lpe_item_cleanup_original_path_recursive). */
function shape_to_path(shape: SPShape, d_str: string): SPLPEItem | null {
  const old = shape.getRepr();
  // remember the position of the item
  const pos = old.position();
  // remember parent
  const parent = old.parent();
  // TODO: keep the title and description (SPObject::title/desc are not ported).
  const keep = [
    'id',
    'class',
    'transform',
    'clip-path',
    'mask',
    'inkscape:transform-center-x',
    'inkscape:transform-center-y',
    'style',
  ];
  const values = keep.map((k) => old.attribute(k));
  const doc = shape.document;
  // It's going to resurrect, so we delete without notifying listeners.
  shape.deleteObject(false);
  const repr = doc.getReprDoc().createElement('svg:path');
  keep.forEach((k, i) => {
    if (k !== 'style') repr.setAttribute(k, values[i] ?? null);
  });
  //restore d
  repr.setAttribute('d', d_str);
  //restore style
  repr.setAttribute('style', values[keep.indexOf('style')] ?? null);
  // add the new repr to the parent
  parent?.appendChild(repr);
  const newObj = doc.getObjectByRepr(repr);
  // move to the saved position
  repr.setPosition(Math.max(pos, 0));
  return newObj instanceof SPLPEItem ? newObj : null;
}

/**
 *  THE function that should be used to generate any patheffectlist string.
 * one of the methods to change the effect list:
 *  - create temporary href list
 *  - populate the templist with the effects from the old list that you want to have and their order
 *  - call this function with temp list as param
 */
function hreflist_svg_string(list: HRefList): string {
  return list.join(';');
}

function patheffectlist_svg_string(list: PathEffectList): string {
  return hreflist_svg_string(list.map((it) => it.lpeobject_href ?? ''));
}

// Enable or disable the path effects of the item.
export function sp_lpe_item_enable_path_effects(lpeitem: SPLPEItem, enable: boolean): void {
  if (enable) lpeitem.path_effects_enabled++;
  else lpeitem.path_effects_enabled--;
}

/** Whether object can have path effects (upstream Inkscape::LivePathEffect::can_have_lpe). */
export function can_have_lpe(object: SPObject): boolean {
  // TODO: SPBox3D and SPOffset are not ported; SPUse (clones get the Clone original effect).
  const { SPRect, SPSpiral, SPStar } = lpeItemClasses;
  return (
    isEllipse(object) ||
    isGroup(object) ||
    isPath(object) ||
    (!!SPRect && object instanceof SPRect) ||
    (!!SPSpiral && object instanceof SPSpiral) ||
    (!!SPStar && object instanceof SPStar)
  );
}
