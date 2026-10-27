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
import { SPDocument } from '../document.ts';
import { DocumentUndo } from '../document-undo.ts';
import { C_ } from '../i18n.ts';
import { Preferences } from '../preferences.ts';
import { sp_svg_transform_read, sp_svg_transform_write } from '../svg/svg-affine.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { spReprCssAttrInherited, spReprCssSet } from '../xml/repr-css.ts';
import { sp_repr_compare_position, sp_repr_is_def } from '../xml/repr-util.ts';
import { BBoxType, SPItem } from './sp-item.ts';
import { SPGroup, sp_item_group_ungroup } from './sp-item-group.ts';
import { SP_OBJECT_MODIFIED_FLAG, type SPObject } from './sp-object.ts';
import { SPRoot } from './sp-root.ts';

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
 * TODO: 3D boxes, sibling state (clones with originals, text on path),
 * connectors, transform centers, LPE items, the operations not ported yet
 * (popFromGroup, stackUp/Down, clipboard, clones, masks, layers, …).
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
      // TODO: connectors, clones with originals, offsets, text on path, flowed text,
      // 3D box perspectives.
      const old_center = item.isCenterSet() ? item.getCenter() : null;
      if (set_i2d) item.setI2dAffine(item.i2dtAffine().multiply(affine));
      item.doWriteTransform(item.transform, null, compensate);
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
