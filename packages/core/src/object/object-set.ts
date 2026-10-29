// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/object-set.cpp, src/object/object-set.h, src/selection-chemistry.cpp
/*
 * Multiindex container for selection
 *
 * Authors:
 *   Adrian Boguszewski
 *   Marc Jeanmougin
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Frank Felfe <innerspace@iname.com>
 *   MenTaLguY <mental@rydia.net>
 *   bulia byak <buliabyak@users.sf.net>
 *   Andrius R. <knutux@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Martin Sucha <martin.sucha-inkscape@jts-sro.sk>
 *   Abhishek Sharma
 *   Kris De Gussem <Kris.DeGussem@gmail.com>
 *   Tavmjong Bah <tavmjong@free.fr> (Symbol additions)
 *
 * Copyright (C) 2016 Adrian Boguszewski
 * Copyright (C) 1999-2016 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { Affine, type OptRect, type Point, Rotate, Scale, Translate, unify } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import { SPDocument } from '../document.ts';
import { DocumentUndo } from '../document-undo.ts';
import { PrefsMaskobjectGrouping } from '../enums.ts';
import { C_ } from '../i18n.ts';
import { Preferences } from '../preferences.ts';
import { sp_svg_transform_read, sp_svg_transform_write } from '../svg/svg-affine.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { spReprCssAttrInherited, spReprCssSet } from '../xml/repr-css.ts';
import { sp_repr_compare_position } from '../xml/repr-sorting.ts';
import { sp_repr_is_def } from '../xml/repr-util.ts';
import { SPClipPath } from './sp-clippath.ts';
import { BBoxType, SPItem } from './sp-item.ts';
import { LayerMode, SPGroup, sp_item_group_ungroup } from './sp-item-group.ts';
import { SPMask } from './sp-mask.ts';
import { SP_OBJECT_MODIFIED_FLAG, type SPObject } from './sp-object.ts';
import { SPPath } from './sp-path.ts';
import { SPRoot } from './sp-root.ts';
import { SPSymbol } from './sp-symbol.ts';
import { SPCloneCompensation, SPUse } from './sp-use.ts';

/** The part of upstream LayerManager that the selection uses (the editor implements it). */
export interface ObjectSetLayerManager {
  currentLayer(): SPGroup | null;
  /** The layer that contains object, or null (e.g. for objects in defs). */
  layerForObject(object: SPObject): SPObject | null;
  setCurrentLayer(object: SPObject, clear?: boolean): void;
}

/** The part of upstream SPDesktop that ObjectSet and Selection use (the core cannot import the editor). */
export interface ObjectSetDesktop {
  getDocument(): SPDocument;
  current_zoom(): number;
  layerManager(): ObjectSetLayerManager;
}

/** The size that smallestItem() and largestItem() compare (upstream ObjectSet::CompareSize). */
export enum CompareSize {
  HORIZONTAL,
  VERTICAL,
  AREA,
}

/**
 * An ordered set of objects (upstream Inkscape::ObjectSet): the base of the
 * selection, also used for operations on lists of objects. An object and its
 * ancestor are never both in the set.
 *
 * The operations on the set from upstream selection-chemistry.cpp are here
 * too (deleteItems, duplicate, group, ungroup, raise, lower, applyAffine, move, …).
 * TODO: 3D boxes, sibling state (text on path, offsets, flowed text),
 * connectors, transform centers, LPE items, the operations not ported yet
 * (popFromGroup, stackUp/Down, relink, setClipGroup, layers, …).
 */
export class ObjectSet {
  protected _desktop: ObjectSetDesktop | null;
  protected _document: SPDocument | null;
  /** In insertion order (upstream random_access index); the Set is the hashed index. */
  #container: SPObject[] = [];
  #hashed = new Set<SPObject>();
  #releaseConnections = new Map<SPObject, () => void>();
  #lastAffine = Affine.identity();

  constructor(owner: ObjectSetDesktop | SPDocument | null = null) {
    if (owner instanceof SPDocument) {
      this._desktop = null;
      this._document = owner;
    } else {
      this._desktop = owner;
      this._document = owner?.getDocument() ?? null;
    }
  }

  desktop(): ObjectSetDesktop | null {
    return this._desktop;
  }
  document(): SPDocument | null {
    return this._document;
  }
  setDocument(document: SPDocument | null): void {
    this._document = document;
  }

  /** Add an object, unless an ancestor is already in the set; removes its descendants. */
  add(object: SPObject, nosignal = false): boolean {
    // any ancestor is in the set - do nothing
    if (this.#anyAncestorIsInSet(object)) return false;
    // remove all descendants from the set
    this.#removeDescendantsFromSet(object);
    this._add(object);
    if (!nosignal) this._emitChanged();
    return true;
  }

  /** Remove an object. If an ancestor is in the set, replace the ancestor with the other descendants. */
  remove(object: SPObject): boolean {
    // object is the top of subtree
    if (this.includes(object)) {
      this._remove(object);
      this._emitChanged();
      return true;
    }
    // any ancestor of object is in the set
    if (this.#anyAncestorIsInSet(object)) {
      this.#removeAncestorsFromSet(object);
      this._emitChanged();
      return true;
    }
    // no object nor any parent in the set
    return false;
  }

  /** True if object is in the set, or with anyAncestor, if object or an ancestor is. */
  includes(object: SPObject, anyAncestor = false): boolean {
    return anyAncestor ? this.#anyAncestorIsInSet(object) : this.#hashed.has(object);
  }

  /** The object or its ancestor that is in the set. */
  includesAncestor(object: SPObject): SPObject | null {
    for (let o: SPObject | null = object; o; o = o.parent) if (this.includes(o)) return o;
    return null;
  }

  /** Set the selection to a single object. */
  set(object: SPObject, persist_selection_context = false): void {
    this._clear();
    this._add(object);
    this._emitChanged(persist_selection_context);
  }

  /** Select exactly objs. */
  setList(objs: readonly SPObject[]): void {
    this._clear();
    this.addList(objs);
  }

  /** Add objs without deselecting first. */
  addList(objs: readonly SPObject[]): void {
    for (const obj of objs) if (!this.includes(obj)) this.add(obj, true);
    this._emitChanged();
  }

  removeList(objs: readonly SPObject[]): void {
    for (const obj of objs) this.remove(obj);
    this._emitChanged();
  }

  clear(): void {
    this._clear();
    this._emitChanged();
  }

  size(): number {
    return this.#container.length;
  }

  isEmpty(): boolean {
    return this.#container.length === 0;
  }

  /** Remove the object if it is in the set, add it otherwise. */
  toggle(obj: SPObject): void {
    if (this.includes(obj)) this.remove(obj);
    else this.add(obj);
  }

  /** The object, if exactly one is in the set. */
  single(): SPObject | null {
    return this.#container.length === 1 ? (this.#container[0] ?? null) : null;
  }

  singleItem(): SPItem | null {
    const single = this.single();
    return single instanceof SPItem ? single : null;
  }

  firstItem(): SPItem | null {
    const first = this.#container[0];
    return first instanceof SPItem ? first : null;
  }

  lastItem(): SPItem | null {
    const last = this.#container.at(-1);
    return last instanceof SPItem ? last : null;
  }

  /** The objects, in the order they were added. */
  objects(): readonly SPObject[] {
    return this.#container;
  }

  /** The selected items, in the order they were added. */
  items(): SPItem[] {
    return this.#container.filter((o): o is SPItem => o instanceof SPItem);
  }

  /** The smallest item by its document preferred bounds: width, height or area. */
  smallestItem(compare: CompareSize): SPItem | null {
    return this.#sizeistItem(true, compare);
  }

  /** The largest item by its document preferred bounds: width, height or area. */
  largestItem(compare: CompareSize): SPItem | null {
    return this.#sizeistItem(false, compare);
  }

  #sizeistItem(sml: boolean, compare: CompareSize): SPItem | null {
    let max = sml ? 1e18 : 0;
    let ist: SPItem | null = null;
    for (const item of this.items()) {
      const bbox = item.documentPreferredBounds();
      if (!bbox) continue;
      let size =
        compare === CompareSize.AREA
          ? bbox.area()
          : compare === CompareSize.VERTICAL
            ? bbox.height()
            : bbox.width();
      size = sml ? size : size * -1;
      if (size < max) {
        max = size;
        ist = item;
      }
    }
    return ist;
  }

  // Bounds

  bounds(type: BBoxType): OptRect {
    return type === BBoxType.GEOMETRIC_BBOX ? this.geometricBounds() : this.visualBounds();
  }

  /** Union of the geometric bounds of the items, in desktop coordinates. */
  geometricBounds(): OptRect {
    let bbox: OptRect = null;
    for (const item of this.items()) bbox = unify(bbox, item.desktopGeometricBounds());
    return bbox;
  }

  /** Union of the visual bounds of the items, in desktop coordinates. */
  visualBounds(): OptRect {
    let bbox: OptRect = null;
    for (const item of this.items()) bbox = unify(bbox, item.desktopVisualBounds());
    return bbox;
  }

  /** Visual or geometric bounds, as /tools/bounding_box says. */
  preferredBounds(): OptRect {
    return Preferences.get().getInt('/tools/bounding_box', 0) === 0
      ? this.bounds(BBoxType.VISUAL_BBOX)
      : this.bounds(BBoxType.GEOMETRIC_BBOX);
  }

  /** Bounds in document coordinates. */
  documentBounds(type: BBoxType): OptRect {
    let bbox: OptRect = null;
    for (const item of this.items()) bbox = unify(bbox, item.documentBounds(type));
    return bbox;
  }

  documentPreferredBounds(): OptRect {
    return Preferences.get().getInt('/tools/bounding_box', 0) === 0
      ? this.documentBounds(BBoxType.VISUAL_BBOX)
      : this.documentBounds(BBoxType.GEOMETRIC_BBOX);
  }

  /** The rotation and skew center: the one set on the first selected item, else the middle of the bounds. */
  center(): Point | null {
    const first = this.items()[0];
    if (first?.isCenterSet()) return first.getCenter();
    return this.preferredBounds()?.midpoint() ?? null;
  }

  // Operations (upstream selection-chemistry.cpp)

  /** Delete the items, with the undo step "Delete" unless skip_undo. */
  deleteItems(skip_undo = false): void {
    if (this.isEmpty() && !skip_undo) {
      // TODO: flash "<b>Nothing</b> was deleted." in the message stack.
      return;
    }
    const selected = this.items();
    this.clear();
    for (const item of selected) item.deleteObject(true);
    if (skip_undo) return;

    // TODO: reset the tool (upstream dt->setTool), which may keep references to deleted items.
    this._desktop?.layerManager().currentLayer()?.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    const document = this.document();
    if (document) DocumentUndo.done(document, C_('Undo', 'Delete'), 'edit-delete');
  }

  /** The reprs of the objects, in the order they were added. */
  xmlNodes(): Node[] {
    return this.#container.map((o) => o.getRepr());
  }

  /** The repr of the topmost object in document order, or null for an empty set. */
  topRepr(): Node | null {
    const nodes = this.xmlNodes();
    if (!nodes.length) return null;
    return nodes.reduce((a, b) => (sp_repr_compare_position(a, b) < 0 ? b : a));
  }

  /** The selected groups. */
  groups(): SPGroup[] {
    return this.#container.filter((o): o is SPGroup => o instanceof SPGroup);
  }

  /** Select the objects of the reprs in list (in reverse order, as upstream). */
  setReprList(list: readonly Node[]): void {
    const document = this.document();
    if (!document) return;
    this.clear();
    for (const repr of [...list].reverse()) {
      const obj = document.getObjectById(repr.attribute('id'));
      if (obj) this.add(obj, true);
    }
    this._emitChanged();
  }

  /**
   * Copy the selected objects in place (appended to their parents, so on
   * top) and select the copies, with the undo step "Duplicate" unless
   * suppressDone.
   * TODO: duplicateLayer, LPE satellites and forking, text references,
   * relinking clones (/options/relinkclonesonduplicate/value), tmp successors.
   */
  duplicate(suppressDone = false, includeHidden = false): void {
    const doc = this.document();
    if (!doc) return;
    const xml_doc = doc.getReprDoc();

    // check if something is selected
    if (this.isEmpty()) {
      // TODO: flash "Select <b>object(s)</b> to duplicate."
      return;
    }

    const reprs = this.xmlNodes();
    this.clear();
    // sorting items from different parents sorts each parent's subset without possibly mixing
    // them, just what we need
    reprs.sort(sp_repr_compare_position);

    const copies: Node[] = [];
    for (const old_repr of reprs) {
      const copy = old_repr.duplicate(xml_doc);
      old_repr.parent()?.appendChild(copy);
      copies.push(copy);
    }

    // copies contains def nodes, we don't want that in our selection
    const newsel: Node[] = [];
    for (const node of copies) {
      const itm = doc.getObjectByRepr(node);
      if ((!sp_repr_is_def(node) && includeHidden) || !(itm instanceof SPItem) || !itm.isHidden()) {
        newsel.push(node);
      }
    }
    this.setReprList(newsel);
    if (!suppressDone) DocumentUndo.done(doc, C_('Undo', 'Duplicate'), 'edit-duplicate');
  }

  /**
   * Put the selected objects into a new group (svg:a with is_anchor) at the
   * place of the topmost one and select it. Objects of other parents keep
   * their place on the canvas: their complete transform and inherited style
   * are written to the copies. The caller adds the undo step.
   */
  group(is_anchor = false): Node | null {
    const doc = this.document();
    if (!doc) return null;
    if (this.isEmpty()) {
      // TODO: flash "Select <b>some objects</b> to group."
      return null;
    }
    const xml_doc = doc.getReprDoc();
    const group = xml_doc.createElement(is_anchor ? 'svg:a' : 'svg:g');

    const p = this.xmlNodes().sort(sp_repr_compare_position);
    this.clear();

    // Remember the position and parent of the topmost object.
    const topmost = p.at(-1);
    const topmost_parent = topmost?.parent();
    if (!topmost || !topmost_parent) return null;

    // Add as close to the top as we can get it
    topmost_parent.addChild(group, topmost);

    for (const current of p) {
      if (current.parent() === topmost_parent) {
        const spnew = current.duplicate(xml_doc);
        current.parent()?.removeChild(current);
        group.appendChild(spnew);
      } else {
        // move it to topmost_parent first
        const temp_clip: Node[] = [];

        // At this point, current may already have no item, due to its being a clone whose original is already moved away
        // So we copy it artificially calculating the transform from its repr->attr("transform") and the parent transform
        const t_str = current.attribute('transform');
        let item_t = (t_str && sp_svg_transform_read(t_str)) || Affine.identity();
        const parent_item = doc.getObjectByRepr(current.parent());
        if (!(parent_item instanceof SPItem)) throw new Error('group: parent is no item');
        item_t = item_t.multiply(parent_item.i2docAffine());

        sp_selection_copy_one(current, item_t, temp_clip, xml_doc);
        current.parent()?.removeChild(current);

        // paste into topmost_parent (temporarily)
        const parent_obj = doc.getObjectByRepr(topmost_parent);
        const copied = parent_obj ? sp_selection_paste_impl(doc, parent_obj, temp_clip) : [];
        const in_topmost = copied.at(-1);
        if (in_topmost) {
          // take pasted object (now in topmost_parent)
          // make a copy
          const spnew = in_topmost.duplicate(xml_doc);
          // remove pasted
          in_topmost.parent()?.removeChild(in_topmost);
          // put its copy into group
          group.appendChild(spnew);
        }
      }
    }

    const object = doc.getObjectByRepr(group);
    if (object) this.set(object);
    return group;
  }

  /**
   * Ungroup the selected groups (not recursive) and add their children to
   * the set, with the undo step "Ungroup" unless skip_undo.
   * TODO: unlink clones of the groups (find_clone_to_group).
   */
  ungroup(skip_undo = false): void {
    if (this.isEmpty()) {
      // TODO: flash "Select a <b>group</b> to ungroup."
      return;
    }
    const groups = this.groups();
    if (!groups.length) {
      // TODO: flash "<b>No groups</b> to ungroup in the selection."
      return;
    }
    const children: SPItem[] = [];
    for (const group of groups) sp_item_group_ungroup(group, children);
    this.addList(children);

    const document = this.document();
    if (document && !skip_undo) DocumentUndo.done(document, C_('Undo', 'Ungroup'), 'object-ungroup');
  }

  /**
   * Raise each selected object above the next sibling that overlaps the
   * selection, with the undo step "Raise" unless skip_undo.
   */
  raise(skip_undo = false): void {
    if (this.isEmpty()) {
      // TODO: flash "Select <b>object(s)</b> to raise."
      return;
    }
    const items_copy = this.items();
    const grepr = sp_item_list_common_parent_group(items_copy)?.getRepr();
    if (!grepr) {
      // TODO: flash "You cannot raise/lower objects from <b>different groups</b> or <b>layers</b>."
      return;
    }

    /* Construct reverse-ordered list of selected children. */
    const rev = [...items_copy].sort(sp_object_compare_position);

    // Determine the common bbox of the selected items.
    const selected = enclose_items(items_copy);

    // Iterate over all objects in the selection (starting from top).
    if (selected) {
      for (const child of rev) {
        // for each selected object, find the next sibling
        for (let newref = child.getNext(); newref; newref = newref.getNext()) {
          // if the sibling is an item AND overlaps our selection,
          if (!(newref instanceof SPItem)) continue;
          const newref_bbox = newref.documentVisualBounds();
          if (newref_bbox && selected.intersects(newref_bbox)) {
            // AND if it's not one of our selected objects,
            if (!items_copy.includes(newref)) {
              // move the selected object after that sibling
              grepr.changeOrder(child.getRepr(), newref.getRepr());
            }
            break;
          }
        }
      }
    }
    const document = this.document();
    if (document && !skip_undo) DocumentUndo.done(document, C_('Undo', 'Raise'), 'selection-raise');
  }

  /** Move the selected objects to the top of their parent, with the undo step "Raise to top". */
  raiseToTop(skip_undo = false): void {
    if (this.isEmpty()) {
      // TODO: flash "Select <b>object(s)</b> to raise."
      return;
    }
    if (!sp_item_list_common_parent_group(this.items())) {
      // TODO: flash "You cannot raise/lower objects from <b>different groups</b> or <b>layers</b>."
      return;
    }
    const rl = this.xmlNodes().sort(sp_repr_compare_position);
    for (const repr of rl) repr.setPosition(-1);
    const document = this.document();
    if (document && !skip_undo) DocumentUndo.done(document, C_('Undo', 'Raise to top'), 'selection-top');
  }

  /**
   * Lower each selected object below the previous sibling that overlaps the
   * selection, with the undo step "Lower" unless skip_undo.
   */
  lower(skip_undo = false): void {
    if (this.isEmpty()) {
      // TODO: flash "Select <b>object(s)</b> to lower."
      return;
    }
    const items_copy = this.items();
    const grepr = sp_item_list_common_parent_group(items_copy)?.getRepr();
    if (!grepr) {
      // TODO: flash "You cannot raise/lower objects from <b>different groups</b> or <b>layers</b>."
      return;
    }

    // Determine the common bbox of the selected items.
    const selected = enclose_items(items_copy);

    /* Construct direct-ordered list of selected children. */
    const rev = [...items_copy].sort(sp_object_compare_position);

    // Iterate over all objects in the selection (starting from top).
    if (selected) {
      for (const child of rev.reverse()) {
        // for each selected object, find the prev sibling
        for (let newref = prev_sibling(child); newref; newref = prev_sibling(newref)) {
          // if the sibling is an item AND overlaps our selection,
          if (!(newref instanceof SPItem)) continue;
          const ref_bbox = newref.documentVisualBounds();
          if (ref_bbox && selected.intersects(ref_bbox)) {
            // AND if it's not one of our selected objects,
            if (!items_copy.includes(newref)) {
              // move the selected object before that sibling
              const put_after = prev_sibling(newref);
              if (put_after) grepr.changeOrder(child.getRepr(), put_after.getRepr());
              else child.getRepr().setPosition(0);
            }
            break;
          }
        }
      }
    }
    const document = this.document();
    if (document && !skip_undo) DocumentUndo.done(document, C_('Undo', 'Lower'), 'selection-lower');
  }

  /**
   * Move the selected objects to the bottom of their parent (above the
   * non-items like defs), with the undo step "Lower to bottom".
   */
  lowerToBottom(skip_undo = false): void {
    const document = this.document();
    if (!document) return;
    if (this.isEmpty()) {
      // TODO: flash "Select <b>object(s)</b> to lower to bottom."
      return;
    }
    if (!sp_item_list_common_parent_group(this.items())) {
      // TODO: flash "You cannot raise/lower objects from <b>different groups</b> or <b>layers</b>."
      return;
    }
    const rl = this.xmlNodes().sort(sp_repr_compare_position);
    for (const repr of rl.reverse()) {
      let minpos = 0;
      const pp = document.getObjectByRepr(repr.parent());
      for (const pc of pp?.children ?? []) {
        if (pc instanceof SPItem) break;
        minpos++;
      }
      repr.setPosition(minpos);
    }
    if (!skip_undo) DocumentUndo.done(document, C_('Undo', 'Lower to bottom'), 'selection-bottom');
  }

  /** Give the selected items that have no id a unique id. */
  enforceIds(): void {
    let idAssigned = false;
    for (const item of this.items()) {
      if (!item.getId()) {
        // Selected object does not have an ID, so assign it a unique ID
        item.setAttribute('id', item.generateUniqueId());
        idAssigned = true;
      }
    }
    if (idAssigned) this.document()?.setModifiedSinceSave(true);
  }

  /**
   * Create a clone (svg:use) of each selected object on top of its parent and
   * select the clones, with the undo step "Clone" unless skip_undo.
   */
  clone(skip_undo = false): void {
    const doc = this.document();
    if (!doc) return;
    const xml_doc = doc.getReprDoc();

    // check if something is selected
    if (this.isEmpty()) {
      // TODO: flash "Select an <b>object</b> to clone."
      return;
    }

    // Assign IDs to selected objects that don't have an ID attribute
    this.enforceIds();

    const reprs = this.xmlNodes();
    this.clear();

    // sorting items from different parents sorts each parent's subset without possibly mixing them, just what we need
    reprs.sort(sp_repr_compare_position);

    const newsel: Node[] = [];
    for (const sel_repr of reprs) {
      const parent = sel_repr.parent();
      if (!parent) continue;
      const clone = xml_doc.createElement('svg:use');
      clone.setAttribute('x', '0');
      clone.setAttribute('y', '0');
      clone.setAttribute('xlink:href', `#${sel_repr.attribute('id')}`);
      clone.setAttribute('inkscape:transform-center-x', sel_repr.attribute('inkscape:transform-center-x'));
      clone.setAttribute('inkscape:transform-center-y', sel_repr.attribute('inkscape:transform-center-y'));

      // add the new clone to the top of the original's parent
      parent.appendChild(clone);
      newsel.push(clone);
    }
    if (!skip_undo) DocumentUndo.done(doc, C_('Undo', 'Clone'), 'edit-clone');
    this.setReprList(newsel);
  }

  /**
   * Replace the selected clones by copies of their originals and select them
   * (with the other selected items), with the undo step "Unlink clone" unless
   * skip_undo. Returns whether a clone was unlinked.
   * TODO: clipped and masked items, text references (tref), the messages.
   */
  unlink(skip_undo = false, _silent = false): boolean {
    if (this.isEmpty()) {
      // TODO: flash "Select <b>clones</b> to unlink." unless silent
      return false;
    }

    // Get a copy of current selection.
    const new_select: SPItem[] = [];
    let unlinked = false;

    for (const item of this.items().reverse()) {
      if (!(item instanceof SPUse)) {
        // keep the non-use item in the new selection
        new_select.push(item);
        continue;
      }
      const unlink = item.unlink();
      // Unable to unlink use (external or invalid href?)
      if (!unlink) {
        new_select.push(item);
        continue;
      }
      unlinked = true;
      // Add ungrouped items to the new selection.
      new_select.push(unlink);
    }

    if (new_select.length) {
      // set new selection
      this.clear();
      this.setList(new_select);
    }
    // TODO: flash "<b>No clones to unlink</b> in the selection." unless unlinked or silent

    const document = this.document();
    if (document && !skip_undo) DocumentUndo.done(document, C_('Undo', 'Unlink clone'), 'edit-clone-unlink');
    return unlinked;
  }

  /**
   * Unlink the selected clones and the clones in the selected groups, with the
   * undo step "Unlink clone recursively" unless skip_undo. Does nothing unless
   * force or /options/pathoperationsunlink/value.
   */
  unlinkRecursive(skip_undo = false, force = false, silent = false): boolean {
    if (this.isEmpty()) {
      // TODO: flash "Select <b>clones</b> to unlink." unless silent
      return false;
    }
    const pathoperationsunlink = Preferences.get().getBool('/options/pathoperationsunlink/value', true);
    if (!force && !pathoperationsunlink) {
      // TODO: flash "Unable to unlink. Check the setting for 'Unlinking Clones' in your preferences."
      return false;
    }
    let unlinked = false;
    const tmp_set = new ObjectSet(this.document());
    const items_vec = this.items();
    for (let i = 0; i < items_vec.length; i++) {
      tmp_set.set(items_vec[i] as SPItem);
      unlinked = tmp_set.unlink(true, silent) || unlinked;
      const item = tmp_set.singleItem();
      if (!item) continue;
      items_vec[i] = item;
      if (item instanceof SPGroup) {
        tmp_set.setList(item.childList());
        unlinked = tmp_set.unlinkRecursive(skip_undo, force, silent) || unlinked;
      }
    }
    // TODO: flash "<b>No clones to unlink</b> in the selection." unless unlinked or silent
    const document = this.document();
    if (document && !skip_undo) {
      DocumentUndo.done(document, C_('Undo', 'Unlink clone recursively'), 'edit-clone-unlink');
    }
    this.setList(items_vec);
    return unlinked;
  }

  /**
   * Select the original of the single selected clone.
   * TODO: linked offsets, text on path, flowed text, the highlight line
   * (/options/highlightoriginal/value), scrolling to the original, the messages.
   */
  cloneOriginal(): void {
    const item = this.singleItem();
    // TODO: flash "Select a <b>clone</b> to go to its original. ..." for these returns.
    if (!(item instanceof SPUse)) return;
    const original = item.get_original();
    if (!original) return;

    for (let o: SPObject | null = original; o && !(o instanceof SPRoot); o = o.parent) {
      // TODO: flash "The object you're trying to select is <b>not visible</b> (it is in &lt;defs&gt;)"
      if (o.getRepr().name() === 'svg:defs') return;
    }
    this.clear();
    this.set(original);
  }

  /** Apply the last affine again. */
  reapplyAffine(): void {
    const cached = this.#lastAffine;
    this.applyAffine(this.#lastAffine);
    this.#lastAffine = cached;
  }

  clearLastAffine(): void {
    this.#lastAffine = Affine.identity();
  }

  /**
   * Apply affine (in desktop coordinates) to the items. set_i2d is normally
   * true: the items jump to the new transform. SelTrans passes false after a
   * live drag, when the items already show the new transform and only the
   * reprs need the update.
   */
  applyAffine(affine: Affine, set_i2d = true, compensate = true, adjust_transf_center = true): void {
    if (this.isEmpty()) return;
    this.#lastAffine = affine;
    for (const item of this.items()) {
      if (item instanceof SPRoot) {
        // An SVG element cannot have a transform. We could change 'x' and 'y' in response
        // to a translation... but leave that for another day.
        // TODO: flash "Cannot transform an embedded SVG." in the message stack.
        break;
      }
      // TODO: connectors, offsets, text on path, flowed text, 3D box perspectives.
      const old_center = item.isCenterSet() ? item.getCenter() : null;

      // "clones are unmoved when original is moved" preference
      const compensation = Preferences.get().getInt(
        '/options/clonecompensation/value',
        SPCloneCompensation.SP_CLONE_COMPENSATION_UNMOVED,
      );
      const prefs_unmoved = compensation === SPCloneCompensation.SP_CLONE_COMPENSATION_UNMOVED;
      const prefs_parallel = compensation === SPCloneCompensation.SP_CLONE_COMPENSATION_PARALLEL;

      /* If this is a clone and it's selected along with its original, do not move it;
       * it will feel the transform of its original and respond to it itself.
       * Without this, a clone is doubly transformed, very unintuitive. */
      if (item instanceof SPUse && object_set_contains_original(item, this)) {
        // We are transforming a clone along with its original. The below matrix juggling is
        // necessary to ensure that they transform as a whole, i.e. the clone's induced
        // transform and its move compensation are both cancelled out.

        // restore item->transform field from the repr, in case it was changed by seltrans
        item.readAttr(SPAttr.TRANSFORM);

        // calculate the matrix we need to apply to the clone to cancel its induced transform from its original
        const parent2dt = item.parent instanceof SPItem ? item.parent.i2dtAffine() : Affine.identity();
        const t = parent2dt.multiply(affine).multiply(parent2dt.inverse());
        const t_inv = t.inverse();
        const result = t_inv.multiply(item.transform).multiply(t);

        if ((prefs_parallel || prefs_unmoved) && affine.isTranslation()) {
          // we need to cancel out the move compensation, too

          // find out the clone move, same as in sp_use_move_compensate
          const parent = item.get_parent_transform();
          const clone_move = parent.inverse().multiply(t).multiply(parent);

          if (prefs_parallel) {
            const move = result.multiply(clone_move).multiply(t_inv);
            item.doWriteTransform(move, move, compensate);
          } else {
            const move = result.multiply(clone_move);
            item.doWriteTransform(move, t, compensate);
          }
        } else {
          // just apply the result
          item.doWriteTransform(result, t, compensate);
        }
      } else {
        if (set_i2d) item.setI2dAffine(item.i2dtAffine().multiply(affine));
        item.doWriteTransform(item.transform, null, compensate);
      }
      // The transformation center follows the object, unless the transformation is a translation
      // (then the center is relative to the bounding box anyway).
      if (adjust_transf_center && set_i2d && old_center && !(affine.isTranslation() || affine.isIdentity())) {
        item.setCenter(old_center.transformed(affine));
        item.updateRepr();
      }
    }
  }

  /** Scale the visual bounds to (x0, y0)–(x1, y1). */
  setScaleAbsolute(x0: number, x1: number, y0: number, y1: number): void {
    if (this.isEmpty()) return;
    const bbox = this.visualBounds();
    if (!bbox) return;
    const p2o = Translate(bbox.min().neg());
    const scale = Scale((x1 - x0) / bbox.width(), (y1 - y0) / bbox.height());
    const o2n = Translate(x0, y0);
    this.applyAffine(p2o.multiply(scale).multiply(o2n));
  }

  /** Scale around align. */
  scaleRelative(align: Point, sx: number, sy: number): void {
    if (this.isEmpty()) return;
    const bbox = this.visualBounds();
    if (!bbox) return;
    // FIXME: ARBITRARY LIMIT: don't try to scale above 1 Mpx, it won't display properly and will crash sooner or later anyway
    if (bbox.width() * sx > 1e6 || bbox.height() * sy > 1e6) return;
    const n2d = Translate(align.neg());
    const d2n = Translate(align);
    this.applyAffine(n2d.multiply(Scale(sx, sy)).multiply(d2n));
  }

  /** Rotate by angle_degrees around center (desktop coordinates). */
  rotateRelative(center: Point, angle_degrees: number): void {
    const d2n = Translate(center);
    const n2d = Translate(center.neg());
    const rotate = Rotate.from_degrees(angle_degrees);
    this.applyAffine(n2d.multiply(rotate).multiply(d2n));
  }

  /**
   * Convert the selection to an svg:symbol in the defs and replace it by an
   * svg:use of the symbol. A single group becomes the symbol (its translation
   * moves to the use; a group with another transform stays as a group in the
   * symbol, as a symbol cannot have a transform). Undo step "Group to symbol".
   * Upstream: ObjectSet::toSymbol.
   */
  toSymbol(): void {
    const doc = this.document();
    if (!doc) return;
    const xml_doc = doc.getReprDoc();
    // TODO: flash "Select <b>objects</b> to convert to symbol." if nothing is selected.
    if (this.isEmpty()) return;
    doc.ensureUpToDate();

    let items_: SPObject[] = [...this.objects()].sort(sp_object_compare_position);
    const the_first_repr = items_[0]?.getRepr();
    const the_parent_repr = the_first_repr?.parent();
    if (!the_parent_repr) return;

    // Find out if we have a single group.
    let single_group = false;
    let the_group: SPGroup | null = null;
    let transform = Affine.identity();
    const only = items_.length === 1 ? items_[0] : undefined;
    if (only instanceof SPGroup) {
      the_group = only;
      single_group = true;
      transform = sp_svg_transform_read(only.getAttribute('transform') ?? '') ?? Affine.identity();
      if (transform.isTranslation()) {
        // Create a new list from the children of the group.
        items_ = only.children.slice();
        // Hack: temporarily set clone compensation to unmoved, so that we can move clone-originals
        // without disturbing clones.
        const prefs = Preferences.get();
        const saved = prefs.getInt(
          '/options/clonecompensation/value',
          SPCloneCompensation.SP_CLONE_COMPENSATION_UNMOVED,
        );
        prefs.setInt('/options/clonecompensation/value', SPCloneCompensation.SP_CLONE_COMPENSATION_UNMOVED);
        // Remove the transform of the group, updating clones.
        only.doWriteTransform(Affine.identity());
        prefs.setInt('/options/clonecompensation/value', saved);
      }
    }

    // Create the new svg:symbol.
    const defsrepr = doc.getDefs()?.getRepr();
    if (!defsrepr) return;
    const symbol_repr = xml_doc.createElement('svg:symbol');
    defsrepr.appendChild(symbol_repr);
    let settitle = false;
    // For a single group, copy the relevant attributes.
    if (single_group && the_group) {
      const id = the_group.getAttribute('id');
      symbol_repr.setAttribute('style', the_group.getAttribute('style'));
      symbol_repr.setAttribute('class', the_group.getAttribute('class'));
      the_group.setAttribute('id', `${id}_transform`);
      symbol_repr.setAttribute('id', id);
      // This should eventually be replaced by 'refX' and 'refY' once the SVG WG approves it.
      // It is done here for round-tripping.
      symbol_repr.setAttribute(
        'inkscape:transform-center-x',
        the_group.getAttribute('inkscape:transform-center-x'),
      );
      symbol_repr.setAttribute(
        'inkscape:transform-center-y',
        the_group.getAttribute('inkscape:transform-center-y'),
      );
      the_group.removeAttribute('style');
    }

    // Move the selected items to the new symbol.
    for (const item of [...items_].reverse()) {
      const title = item.title();
      if (!single_group && !settitle && title !== null) {
        const title_repr = xml_doc.createElement('svg:title');
        symbol_repr.addChildAtPos(title_repr, 0);
        title_repr.appendChild(xml_doc.createTextNode(title));
        const desc = item.desc();
        if (desc !== null) {
          const desc_repr = xml_doc.createElement('svg:desc');
          symbol_repr.addChildAtPos(desc_repr, 1);
          desc_repr.appendChild(xml_doc.createTextNode(desc));
        }
        settitle = true;
      }
      const repr = item.getRepr();
      repr.parent()?.removeChild(repr);
      symbol_repr.addChild(repr, null);
    }

    if (single_group && transform.isTranslation()) the_group?.deleteObject(true);

    // Create a use of the new symbol (to replace the moved objects).
    const clone = xml_doc.createElement('svg:use');
    clone.setAttribute('xlink:href', `#${symbol_repr.attribute('id')}`);
    the_parent_repr.appendChild(clone);
    if (single_group && transform.isTranslation()) {
      clone.setAttributeOrRemoveIfEmpty('transform', sp_svg_transform_write(transform));
    }

    // Change the selection to the new use.
    doc.ensureUpToDate();
    const use = doc.getObjectByRepr(clone);
    if (use) this.set(use);

    DocumentUndo.done(doc, C_('Undo', 'Group to symbol'), '');
  }

  /**
   * Turn the symbols of the selected uses into groups (see SPSymbol.unSymbol).
   * Undo step "unSymbol all selected symbols". Upstream: ObjectSet::unSymbol.
   */
  unSymbol(): void {
    const doc = this.document();
    if (!doc) return;
    for (const item of this.items()) {
      if (item instanceof SPUse) {
        const sym = item.root();
        if (sym instanceof SPSymbol) sym.unSymbol();
      }
    }
    DocumentUndo.done(doc, C_('Undo', 'unSymbol all selected symbols'), '');
  }

  /** Skew around align by dx and dy (tangents, desktop coordinates). */
  skewRelative(align: Point, dx: number, dy: number): void {
    const d2n = Translate(align);
    const n2d = Translate(align.neg());
    const skew = new Affine(1, dy, dx, 1, 0, 0);
    this.applyAffine(n2d.multiply(skew).multiply(d2n));
  }

  moveRelative(dx: number, dy: number, compensate = true): void {
    this.applyAffine(Translate(dx, dy), true, compensate);
  }

  /** Move by (dx, dy) desktop units, with an undo step. Pure horizontal or vertical moves merge. */
  move(dx: number, dy: number): void {
    if (this.isEmpty()) return;
    this.moveRelative(dx, dy);
    const document = this.document();
    if (!document) return;
    if (dx === 0) {
      DocumentUndo.maybeDone(
        document,
        'selector:move:vertical',
        C_('Undo', 'Move vertically'),
        'tool-pointer',
      );
    } else if (dy === 0) {
      DocumentUndo.maybeDone(
        document,
        'selector:move:horizontal',
        C_('Undo', 'Move horizontally'),
        'tool-pointer',
      );
    } else {
      DocumentUndo.done(document, C_('Undo', 'Move'), 'tool-pointer');
    }
  }

  /** Like move(), but by screen pixels. TODO: rotated canvas (upstream move(dx, dy, rotated)). */
  moveScreen(dx: number, dy: number): void {
    const desktop = this.desktop();
    const document = this.document();
    if (this.isEmpty() || !desktop || !document) return;
    // same as ObjectSet::move but divide deltas by zoom factor
    const zoom = desktop.current_zoom();
    this.moveRelative(dx / zoom, dy / zoom);
    if (dx === 0) {
      DocumentUndo.maybeDone(
        document,
        'selector:move:vertical',
        C_('Undo', 'Move vertically by pixels'),
        'tool-pointer',
      );
    } else if (dy === 0) {
      DocumentUndo.maybeDone(
        document,
        'selector:move:horizontal',
        C_('Undo', 'Move horizontally by pixels'),
        'tool-pointer',
      );
    } else {
      DocumentUndo.done(document, C_('Undo', 'Move'), 'tool-pointer');
    }
  }

  // Internals

  /** Called after each change of the set. Selection overrides it to emit its signal. */
  protected _emitChanged(_persist_selection_context = false): void {}

  /** Selection overrides these to follow the objects' modified signals. */
  protected _connectSignals(_object: SPObject): void {}
  protected _releaseSignals(_object: SPObject): void {}

  /**
   * Creates a mask or clipPath from selection.
   * Two different modes:
   *  if applyToLayer, all selection is moved to DEFS as mask/clippath
   *       and is applied to current layer
   *  otherwise, topmost object is used as mask for other objects
   * If apply_clip_path parameter is true, clipPath is created, otherwise mask
   */
  setMask(apply_clip_path: boolean, apply_to_layer: boolean, remove_original: boolean): void {
    const desktop = this.desktop();
    if (!desktop && apply_to_layer) return;
    const doc = this.document();
    if (!doc) return;
    const xml_doc = doc.getReprDoc();

    // check if something is selected
    const is_empty = this.isEmpty();
    if (apply_to_layer && is_empty) {
      // TODO: flash "Select <b>object(s)</b> to create clippath or mask from."
      return;
    } else if (!apply_to_layer && (is_empty || this.items().length === 1)) {
      // TODO: flash "Select mask object and <b>object(s)</b> to apply clippath or mask to."
      return;
    }

    // FIXME: temporary patch to prevent crash!
    // Remove this when bboxes are fixed to not blow up on an item clipped/masked with its own clone
    if (this.items().some((item) => item instanceof SPUse && object_set_contains_original(item, this))) {
      console.warn('Unable to clip/mask an object with its own clone');
      return; // in this version, you cannot clip/mask an object with its own clone
    }
    // /END FIXME

    doc.ensureUpToDate();

    const items_vec = [...this.items()].sort(sp_object_compare_position);

    // See lp bug #542004
    this.clear();

    // create a list of duplicates
    const mask_items: [Node, Affine][] = [];
    let apply_to_items: SPItem[] = [];
    const items_to_delete: SPItem[] = [];
    let items_to_select: SPItem[] = [];

    const prefs = Preferences.get();
    const topmost = prefs.getBool('/options/maskobject/topmost', true);
    const grouping = prefs.getInt(
      '/options/maskobject/grouping',
      PrefsMaskobjectGrouping.PREFS_MASKOBJECT_GROUPING_NONE,
    );

    if (apply_to_layer) {
      // all selected items are used for mask, which is applied to a layer
      const layer = desktop?.layerManager().currentLayer();
      if (layer) apply_to_items.push(layer);
    }

    for (const i of items_vec) {
      if (
        (!topmost && !apply_to_layer && i === items_vec[0]) ||
        (topmost && !apply_to_layer && i === items_vec[items_vec.length - 1]) ||
        apply_to_layer
      ) {
        const dup = i.getRepr().duplicate(xml_doc);
        mask_items.push([dup, i.i2docAffine()]);
        if (remove_original) items_to_delete.push(i);
        else items_to_select.push(i);
      } else {
        apply_to_items.push(i);
        items_to_select.push(i);
      }
    }

    if (grouping === PrefsMaskobjectGrouping.PREFS_MASKOBJECT_GROUPING_ALL) {
      // group all those objects into one group
      // and apply mask to that
      const set = new ObjectSet(doc);
      set.addList(apply_to_items);
      items_to_select = [];
      const group = set.group();
      if (group) {
        group.setAttribute('inkscape:groupmode', 'maskhelper');
        // apply clip/mask only to newly created group
        const group_item = doc.getObjectByRepr(group);
        apply_to_items = group_item instanceof SPItem ? [group_item] : [];
        items_to_select.push(...apply_to_items);
      }
    }
    if (grouping === PrefsMaskobjectGrouping.PREFS_MASKOBJECT_GROUPING_SEPARATE) items_to_select = [];

    const attributeName = apply_clip_path ? 'clip-path' : 'mask';
    for (let item of [...apply_to_items].reverse()) {
      const mask_items_dup: Node[] = [];
      const dup_transf = new Map<Node, Affine>();
      for (const [repr, transform] of mask_items) {
        const dup = repr.duplicate(xml_doc);
        mask_items_dup.push(dup);
        dup_transf.set(dup, transform);
      }

      const current = item.getRepr();
      // Node to apply mask to
      let apply_mask_to = current;

      if (grouping === PrefsMaskobjectGrouping.PREFS_MASKOBJECT_GROUPING_SEPARATE) {
        // enclose current node in group, and apply crop/mask on that
        const group = xml_doc.createElement('svg:g');
        // make a note we should ungroup this when unsetting mask
        group.setAttribute('inkscape:groupmode', 'maskhelper');
        const spnew = current.duplicate(xml_doc);
        current.parent()?.addChild(group, current);
        current.parent()?.removeChild(current);
        group.appendChild(spnew);
        // Apply clip/mask to group instead
        apply_mask_to = group;
        const group_item = doc.getObjectByRepr(group);
        if (!(group_item instanceof SPItem)) continue;
        item = group_item;
        items_to_select.push(item);
      }

      const mask_id = apply_clip_path
        ? SPClipPath.create(mask_items_dup, doc)
        : SPMask.create(mask_items_dup, doc);

      // inverted object transform should be applied to a mask object,
      // as mask is calculated in user space (after applying transform)
      for (const it of mask_items_dup) {
        const clip_item = doc.getObjectByRepr(it);
        if (!(clip_item instanceof SPItem)) continue;
        clip_item.doWriteTransform(dup_transf.get(it) ?? Affine.identity());
        clip_item.doWriteTransform(clip_item.transform.multiply(item.i2docAffine().inverse()));
      }

      apply_mask_to.setAttribute(attributeName, `url(#${mask_id})`);
    }

    for (const item of items_to_delete) {
      item.deleteObject(false);
      items_to_select = items_to_select.filter((i) => i !== item);
    }

    this.addList(items_to_select);
  }

  /**
   * Remove the clip path (apply_clip_path) or mask from the selected items. With
   * remove_original, the clip or mask objects come back into the document; with
   * delete_helper_group, the groups that setMask() made (maskhelper) are ungrouped.
   */
  unsetMask(apply_clip_path: boolean, delete_helper_group: boolean, remove_original: boolean): void {
    const doc = this.document();
    if (!doc) return;
    const xml_doc = doc.getReprDoc();

    // check if something is selected
    if (this.isEmpty()) {
      // TODO: flash "Select <b>object(s)</b> to remove clippath or mask from."
      return;
    }

    const ungroup_masked = Preferences.get().getBool('/options/maskobject/ungrouping', true);
    doc.ensureUpToDate();

    const attributeName = apply_clip_path ? 'clip-path' : 'mask';
    const referenced_objects = new Map<SPObject, SPItem>();

    const items_vec = this.items();
    this.clear();

    const items_to_ungroup: SPGroup[] = [];
    let items_to_select: SPItem[] = [...items_vec];

    // SPObject refers to a group containing the clipped path or mask itself,
    // whereas SPItem refers to the item being clipped or masked
    for (const i of items_vec) {
      if (remove_original) {
        // remember referenced mask/clippath, so orphaned masks can be moved back to document
        const obj_ref = apply_clip_path ? i.getClipObject() : i.getMaskObject();
        // collect distinct mask object (and associate with item to apply transform)
        if (obj_ref) referenced_objects.set(obj_ref, i);
      }

      i.setAttribute(attributeName, 'none');

      // if we had previously enclosed masked object in group,
      // add it to list so we can ungroup it later
      // ungroup only groups we created when setting clip/mask
      if (
        ungroup_masked &&
        i instanceof SPGroup &&
        delete_helper_group &&
        i.layerMode() === LayerMode.MASK_HELPER
      ) {
        items_to_ungroup.push(i);
      }
    }

    // restore mask objects into a document
    for (const [obj, item] of referenced_objects) {
      // obj: Group containing the clipped paths or masks
      const items_to_move: Node[] = [];
      for (const child of obj.children) {
        // Collect all clipped paths and masks within a single group
        const copy = child.getRepr().duplicate(xml_doc);
        const original_d = copy.attribute('inkscape:original-d');
        if (original_d && copy.attribute('inkscape:path-effect')) {
          copy.setAttribute('d', original_d);
        } else if (original_d) {
          copy.setAttribute('d', original_d);
          copy.removeAttribute('inkscape:original-d');
        } else if (!copy.attribute('inkscape:path-effect') && !(child instanceof SPPath)) {
          copy.removeAttribute('d');
          copy.removeAttribute('inkscape:original-d');
        }
        items_to_move.push(copy);
      }

      // delete from defs if no other object references this mask
      if (!obj.isReferenced()) obj.deleteObject(false);

      // remember parent and position of the item to which the clippath/mask was applied
      const parent = item.getRepr().parent();
      const ref_repr = item.getRepr();

      // Iterate through all clipped paths / masks
      for (const repr of [...items_to_move].reverse()) {
        // insert into parent, restore pos
        parent?.addChild(repr, ref_repr);
        const mask_item = doc.getObjectByRepr(repr);
        if (!(mask_item instanceof SPItem)) continue;
        items_to_select.push(mask_item);
        // transform mask, so it is moved the same spot where mask was applied
        mask_item.doWriteTransform(mask_item.transform.multiply(item.transform));
      }
    }

    // ungroup marked groups added when setting mask
    for (const group of [...items_to_ungroup].reverse()) {
      items_to_select = items_to_select.filter((i) => i !== group);
      const children: SPItem[] = [];
      sp_item_group_ungroup(group, children);
      items_to_select.push(...[...children].reverse());
    }

    // rebuild selection
    this.addList(items_to_select);
  }

  protected _add(object: SPObject): void {
    this.#releaseConnections.set(
      object,
      object.releaseSignal.connect(() => this.remove(object)),
    );
    this.#container.push(object);
    this.#hashed.add(object);
    this._connectSignals(object);
  }

  protected _remove(object: SPObject): void {
    this.#disconnect(object);
    this.#hashed.delete(object);
    this.#container.splice(this.#container.indexOf(object), 1);
  }

  protected _clear(): void {
    for (const object of this.#container) this.#disconnect(object);
    this.#container = [];
    this.#hashed.clear();
  }

  #disconnect(object: SPObject): void {
    this.#releaseConnections.get(object)?.();
    this.#releaseConnections.delete(object);
    this._releaseSignals(object);
  }

  #anyAncestorIsInSet(object: SPObject): boolean {
    for (let o: SPObject | null = object; o; o = o.parent) if (this.includes(o)) return true;
    return false;
  }

  #removeDescendantsFromSet(object: SPObject): void {
    for (const child of object.children) {
      if (this.includes(child)) {
        this._remove(child);
        // there is certainly no children of this child in the set
        continue;
      }
      this.#removeDescendantsFromSet(child);
    }
  }

  /** Replace the selected ancestor of object with all its descendants except object. */
  #removeAncestorsFromSet(object: SPObject): void {
    let o = object;
    while (o.parent) {
      for (const child of o.parent.children) if (child !== o) this._add(child);
      if (this.includes(o.parent)) {
        this._remove(o.parent);
        break;
      }
      o = o.parent;
    }
  }
}

/** True if the set contains an original (or an original of an original, …) of the clone item. */
function object_set_contains_original(item: SPItem, set: ObjectSet): boolean {
  let contains_original = false;
  let item_use: SPItem | null = item;
  while (item_use instanceof SPUse && !contains_original) {
    item_use = item_use.get_original();
    contains_original = !!item_use && set.includes(item_use);
    if (item_use === item) break;
  }
  // TODO: text references (tref)
  return contains_original;
}

/** Compare the document order of two objects (upstream sp_object_compare_position). */
export function sp_object_compare_position(first: SPObject, second: SPObject): number {
  return sp_repr_compare_position(first.getRepr(), second.getRepr());
}

/**
 * Copy repr with its complete inherited style and the accumulated transform
 * full_t, and prepend the copy to clip.
 */
function sp_selection_copy_one(repr: Node, full_t: Affine, clip: Node[], xml_doc: XmlDocument): void {
  const copy = repr.duplicate(xml_doc);

  // copy complete inherited style
  const css = spReprCssAttrInherited(repr, 'style');
  spReprCssSet(copy, css, 'style');

  // write the complete accumulated transform passed to us
  // (we're dealing with unattached repr, so we write to its attr
  // instead of using sp_item_set_transform)
  copy.setAttribute('transform', sp_svg_transform_write(full_t) || null);

  clip.unshift(copy);
}

/** Add copies of the reprs in clip to parent (after `after`), with the parent transform compensated. */
function sp_selection_paste_impl(
  doc: SPDocument,
  parent: SPObject,
  clip: readonly Node[],
  after: Node | null = null,
): Node[] {
  const xml_doc = doc.getReprDoc();
  if (!(parent instanceof SPItem)) throw new Error('sp_selection_paste_impl: parent is no item');

  const copied: Node[] = [];
  // add objects to document
  for (const repr of clip) {
    const copy = repr.duplicate(xml_doc);

    // premultiply the item transform by the accumulated parent transform in the paste layer
    const local = parent.i2docAffine();
    if (!local.isIdentity()) {
      const t_str = copy.attribute('transform');
      let item_t = (t_str && sp_svg_transform_read(t_str)) || Affine.identity();
      item_t = item_t.multiply(local.inverse());
      // (we're dealing with unattached repr, so we write to its attr instead of using sp_item_set_transform)
      copy.setAttribute('transform', sp_svg_transform_write(item_t) || null);
      const original_d = copy.attribute('inkscape:original-d');
      if (original_d) copy.setAttribute('d', original_d);
    }

    parent.getRepr().addChild(copy, after);
    after = copy;
    copied.push(copy);
  }
  return copied;
}

/** If items in the list have a common parent, return it, otherwise return null. */
function sp_item_list_common_parent_group(items: readonly SPItem[]): SPGroup | null {
  const first = items[0];
  if (!first) return null;
  const parent = first.parent;
  // Strictly speaking this CAN happen, if user selects <svg> from Inkscape::XML editor
  if (!(parent instanceof SPGroup)) return null;
  for (const item of items) if (item.parent !== parent) return null;
  return parent;
}

/** Finds out the minimum common bbox of the selected items. */
function enclose_items(items: readonly SPItem[]): OptRect {
  let r: OptRect = null;
  for (const item of items) r = unify(r, item.documentVisualBounds());
  return r;
}

function prev_sibling(child: SPObject): SPObject | null {
  return child.parent instanceof SPGroup ? child.getPrev() : null;
}
