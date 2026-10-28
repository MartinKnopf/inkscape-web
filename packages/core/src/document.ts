// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/document.cpp, src/document.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   MenTaLguY <mental@rydia.net>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Tavmjong Bah <tavmjong@free.fr>
 *
 * Copyright (C) 2004-2005 MenTaLguY
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2012 Tavmjong Bah
 */

import { Affine, Point, Rect, Translate } from '@inkscape-web/geom';
import { DocumentUndo, type UndoStack } from './document-undo.ts';
import { prevent_id_clashes } from './id-clash.ts';
import { ObjectSet } from './object/object-set.ts';
import { createObject } from './object/sp-factory.ts';
import { SPItem, type SPItemCtx } from './object/sp-item.ts';
import { LayerMode, SPGroup, sp_item_group_ungroup } from './object/sp-item-group.ts';
import { SPNamedView } from './object/sp-namedview.ts';
import { getTypeString, type SPObject } from './object/sp-object.ts';
import { SPRoot } from './object/sp-root.ts';
import { convertUnit, type SVGLength, SVGLengthUnit, svgUnitOf } from './svg/svg-length.ts';
import { Signal } from './util/signal.ts';
import type { XmlDocument } from './xml/document.ts';
import type { Node } from './xml/node.ts';
import { spReprCssAttrAddFromString, spReprCssAttrNew, spReprCssSet } from './xml/repr-css.ts';
import { readMem } from './xml/repr-io.ts';
import {
  SVG_NS_URI,
  sp_repr_is_layer,
  sp_repr_lookup_name,
  sp_repr_lookup_name_many,
  sp_repr_visit_descendants,
} from './xml/repr-util.ts';

/** How SPDocument.import() treats the layers of the imported document. */
export enum ImportLayersMode {
  None,
  /** convert layers to groups */
  ToGroup,
}

/** How SPDocument.import() treats the root of the imported document. */
export enum ImportRoot {
  None,
  /** always create new group at root */
  AlwaysGroup,
  /** Create group if needed for applying properties */
  WhenNeeded,
  /** Keep single object at root, group when needed */
  Single,
  /** Single+ungroup when possible */
  UngroupSingle,
}

/**
 * Schedules the idle update (upstream: Glib idle handler). The editor can
 * replace it, e.g. to update before the next frame.
 */
export type IdleScheduler = (callback: () => void) => void;

/**
 * An open document: the repr tree, the object tree built from it, the id
 * table, the update cycle and the undo stacks (see document-undo.ts).
 */
export class SPDocument {
  readonly rdoc: XmlDocument;
  readonly rroot: Node;
  readonly root: SPRoot;
  documentFilename: string | null;
  documentName: string | null;

  /** Undo state, managed by DocumentUndo. */
  readonly undoStack: UndoStack = {
    undo: [],
    redo: [],
    partial: [],
    actionKey: null,
    undoTime: null,
    sensitive: false,
    seeking: false,
    virgin: true,
  };
  modifiedSinceSave = false;

  readonly modifiedSignal = new Signal<[number]>();
  readonly commitSignal = new Signal<[]>();
  readonly modifiedSinceSaveSignal = new Signal<[boolean]>();
  readonly idChangedSignals = new Map<string, Signal<[SPObject | null]>>();

  /** Replaceable scheduler for idle updates. */
  static scheduleIdle: IdleScheduler = (callback) => setTimeout(callback, 0);

  #iddef = new Map<string, SPObject>();
  #reprdef = new Map<Node, SPObject>();
  #objectIdCounter = 1;
  #updatePending = false;

  /** Build the object tree for rdoc (upstream SPDocument::createDoc). */
  constructor(rdoc: XmlDocument, filename: string | null = null, name: string | null = null) {
    const rroot = rdoc.root();
    if (!rroot) throw new Error('document has no root element');
    this.rdoc = rdoc;
    this.rroot = rroot;
    this.documentFilename = filename;
    this.documentName = name;
    const root = createObject(getTypeString(rroot));
    if (!(root instanceof SPRoot)) throw new Error(`root element is ${rroot.name()}, not svg:svg`);
    this.root = root;
    root.invokeBuild(this, rroot, false);

    // Eliminate obsolete sodipodi:docbase, for privacy reasons.
    rroot.removeAttribute('sodipodi:docbase');
    // Eliminate any claim to adhere to a profile, as we don't try to.
    rroot.removeAttribute('baseProfile');
    if (!root.defs) {
      rroot.addChild(rdoc.createElement('svg:defs'), null);
    }
    DocumentUndo.setUndoSensitive(this, true);
  }

  /** Parse SVG text into a new document, or return null for malformed XML (upstream createNewDocFromMem). */
  static createNewDocFromMem(text: string, filename: string | null = null): SPDocument | null {
    const rdoc = readMem(text, SVG_NS_URI);
    if (rdoc?.root()?.name() !== 'svg:svg') return null;
    const name = filename ? (filename.split(/[\\/]/).pop() ?? null) : null;
    return new SPDocument(rdoc, filename, name);
  }

  getReprDoc(): XmlDocument {
    return this.rdoc;
  }
  getReprRoot(): Node {
    return this.rroot;
  }
  getRoot(): SPRoot {
    return this.root;
  }
  /** The sodipodi:namedview object; the element is created if the document has none. */
  getNamedView(): SPNamedView {
    let repr = [...this.rroot.children()].find((c) => c.name() === 'sodipodi:namedview');
    if (!repr) {
      repr = this.rdoc.createElement('sodipodi:namedview');
      this.rroot.addChild(repr, null);
    }
    const nv = this.getObjectByRepr(repr);
    if (!(nv instanceof SPNamedView)) throw new Error('namedview object missing');
    return nv;
  }
  getDefs(): SPObject | null {
    return this.root.defs;
  }

  // Id and repr tables

  getObjectById(id: string | null): SPObject | null {
    return id ? (this.#iddef.get(id) ?? null) : null;
  }
  getObjectByRepr(repr: Node | null): SPObject | null {
    return repr ? (this.#reprdef.get(repr) ?? null) : null;
  }
  bindObjectToId(id: string, object: SPObject | null): void {
    if (object) {
      const old = object.getId();
      if (old) this.#iddef.delete(old);
      if (this.#iddef.has(id)) throw new Error(`id "${id}" is already bound`);
      this.#iddef.set(id, object);
    } else {
      this.#iddef.delete(id);
    }
    this.idChangedSignals.get(id)?.emit(object);
  }
  bindObjectToRepr(repr: Node, object: SPObject | null): void {
    if (object) this.#reprdef.set(repr, object);
    else this.#reprdef.delete(repr);
  }
  /** Signal for changes of the object bound to id (used by href references). */
  connectIdChanged(id: string, slot: (object: SPObject | null) => void): () => void {
    let signal = this.idChangedSignals.get(id);
    if (!signal) {
      signal = new Signal();
      this.idChangedSignals.set(id, signal);
    }
    return signal.connect(slot);
  }
  /** prefix + the lowest free number, e.g. "rect12". */
  generateUniqueId(prefix: string): string {
    for (;;) {
      const id = `${prefix}${this.#objectIdCounter}`;
      if (!this.getObjectById(id)) return id;
      this.#objectIdCounter++;
    }
  }

  isSeeking(): boolean {
    return this.undoStack.seeking;
  }

  // Update cycle

  /** Schedule an update of the object tree. */
  requestModified(): void {
    if (this.#updatePending) return;
    this.#updatePending = true;
    SPDocument.scheduleIdle(() => {
      if (this.#updatePending) this.ensureUpToDate();
    });
  }

  /** Run update and modified passes until the tree is up to date. Returns false after 32 passes. */
  ensureUpToDate(objectModifiedTag = 0): boolean {
    let counter = 32;
    while (!this.#updateDocument(0, objectModifiedTag)) {
      if (counter-- === 0) {
        console.warn(`More than 32 iteration while updating document '${this.documentFilename}'`);
        break;
      }
    }
    this.#updatePending = false;
    return counter > 0;
  }

  #updateDocument(updateFlags: number, objectModifiedTag: number): boolean {
    const root = this.root;
    if (root.uflags || root.mflags) {
      if (root.uflags) {
        DocumentUndo.scopedInsensitive(this, () => root.updateDisplay(this.setupViewport(), updateFlags));
      }
      this.#emitModified(objectModifiedTag);
    }
    return !(root.uflags || root.mflags);
  }

  /**
   * Document to desktop transform. Upstream flips the y axis when the preference
   * /options/yaxisdown is false; the default (y down) gives the identity.
   * TODO: the y-axis flip, when there is a desktop with that preference.
   */
  doc2dt(): Affine {
    return Affine.identity();
  }
  dt2doc(): Affine {
    return this.doc2dt().inverse();
  }
  /** 1 if the desktop y axis points down, -1 if it points up. */
  yaxisdir(): number {
    return this.doc2dt().c3;
  }

  /** Root update context. */
  setupViewport(): SPItemCtx {
    // Set up viewport in case svg has it defined as percentages
    const viewport = this.root.viewBox_set
      ? this.root.viewBox // if set, take from viewBox
      : Rect.fromXywh(0, 0, convertUnit(210, 'mm', 'px'), convertUnit(297, 'mm', 'px')); // as a last resort, set size to A4
    return { flags: 0, i2doc: Affine.identity(), viewport, i2vp: Affine.identity() };
  }

  // Document size. Upstream getWidth()/getHeight() return a Quantity; here
  // getDimensions() converts to px directly.

  /** Document width and height in px. */
  getDimensions(): Point {
    return new Point(this.#lengthPx(this.root.width, 'width'), this.#lengthPx(this.root.height, 'height'));
  }

  #lengthPx(length: SVGLength, dim: 'width' | 'height'): number {
    if (length.unit === SVGLengthUnit.PERCENT && this.root.viewBox_set) {
      return this.root.viewBox[dim]();
    }
    // computed is the value in px (no unit is px).
    return length.computed;
  }

  /** The viewBox, or the page area if the root has none (upstream getViewBox). */
  getViewBox(): Rect {
    return this.root.viewBox_set ? this.root.viewBox : this.preferredBounds();
  }

  /** Set the viewBox and write it to the repr (upstream setViewBox). */
  setViewBox(viewBox: Rect): void {
    this.root.vb.viewBox_set = true;
    this.root.vb.viewBox = viewBox;
    this.root.updateRepr();
  }

  /**
   * Document scale: user units to SVG length value (computed false) or to px (computed true),
   * for x and y; (1, 1) without a viewBox (upstream getDocumentScale).
   */
  getDocumentScale(computed = true): Point {
    const { root } = this;
    if (!root.viewBox_set) return new Point(1, 1);
    const vb = root.viewBox;
    const w = computed ? root.width.computed : root.width.value;
    const h = computed ? root.height.computed : root.height.value;
    return new Point(vb.width() > 0 ? w / vb.width() : 1, vb.height() > 0 ? h / vb.height() : 1);
  }

  /**
   * Set the root size in the units of width_unit and height_unit (SVG units: px, pt, pc, mm,
   * cm, in). With changeSize the viewBox changes by the relative size change, which keeps the
   * document scale (upstream setWidthAndHeight).
   */
  setWidthAndHeight(
    width: number,
    width_unit: string,
    height: number,
    height_unit: string,
    changeSize = true,
  ): void {
    const { root } = this;
    const old = (len: SVGLength, to: string) =>
      len.unit === SVGLengthUnit.PERCENT
        ? convertUnit(len.computed, 'px', to)
        : convertUnit(len.value, len.unit ? len.getUnit().abbr : 'px', to);
    const old_width = old(root.width, width_unit);
    const old_height = old(root.height, height_unit);
    root.width.set(svgUnitOf(width_unit), width, convertUnit(width, width_unit, 'px'));
    root.height.set(svgUnitOf(height_unit), height, convertUnit(height, height_unit, 'px'));
    // viewBox scaled by relative change in page size (maintains document scale).
    if (root.viewBox_set && changeSize) {
      const vb = root.viewBox;
      root.vb.viewBox = Rect.fromXywh(
        vb.left(),
        vb.top(),
        (width / old_width) * vb.width(),
        (height / old_height) * vb.height(),
      );
    }
    root.updateRepr();
  }

  /**
   * Resize the page to rect (desktop coordinates) and move the items so that
   * they keep their place on the page.
   * TODO: the unit of the root height, guides, grids, pages, scrolling the desktops.
   */
  fitToRect(rect: Rect, _with_margins = false): void {
    const tr_x = -rect.left();
    const tr_y_items = -rect.top() * this.yaxisdir();
    // Item translation (in desktop coordinates)
    const item_translation = Translate(tr_x, tr_y_items);
    // Resize the document. This changes the SVG origin relative to the drawing.
    this.setWidthAndHeight(rect.width(), 'px', rect.height(), 'px');
    // Translate everything to cancel out the change in the origin position.
    this.root.translateChildItems(item_translation);
  }

  /** The page area in document coordinates: (0,0) to getDimensions(). */
  preferredBounds(): Rect {
    return new Rect(new Point(0, 0), this.getDimensions());
  }

  /** The bounds of the selected page. TODO: pages (the page manager); now preferredBounds(). */
  pageBounds(): Rect {
    return this.preferredBounds();
  }

  // Items in an area

  /**
   * Items whose visual bounds lie inside box (document coordinates). Enters
   * the groups that are layers for display key dkey; with enter_groups also
   * the other groups.
   */
  getItemsInBox(
    dkey: number,
    box: Rect,
    take_hidden = false,
    take_insensitive = false,
    take_groups = true,
    enter_groups = false,
    enter_layers = true,
  ): SPItem[] {
    return find_items_in_area([], this.root, dkey, box, (area, b) => area.contains(b), {
      take_hidden,
      take_insensitive,
      take_groups,
      enter_groups,
      enter_layers,
    });
  }

  /** Items whose visual bounds overlap box (document coordinates), see getItemsInBox(). */
  getItemsPartiallyInBox(
    dkey: number,
    box: Rect,
    take_hidden = false,
    take_insensitive = false,
    take_groups = true,
    enter_groups = false,
    enter_layers = true,
  ): SPItem[] {
    return find_items_in_area([], this.root, dkey, box, (area, b) => area.intersects(b), {
      take_hidden,
      take_insensitive,
      take_groups,
      enter_groups,
      enter_layers,
    });
  }

  /**
   * Import content of a document into current document.
   *
   * @param input_doc warning, this object will be modified
   * @param parent the new partent of the imported objects, must be part of current document
   * @param after_node place of insertion
   * @param transform additional transformation in doc space, in case of identity source and target doc (0, 0) will
   * match
   * @param rootMode how to handle imported object root
   * @param layerMode
   * @returns the newly created objects
   * TODO: rebase_hrefs, LPE items (sp_file_fix_lpe, enabling path effects), svg:style elements.
   */
  import(
    input_doc: SPDocument,
    parent: Node | null,
    after_node: Node | null,
    transform: Affine,
    rootMode = ImportRoot.None,
    layerMode = ImportLayersMode.None,
  ): Node[] {
    prevent_id_clashes(input_doc, this);
    this.importDefs(input_doc);

    if (parent === null) {
      parent = this.getReprRoot();
      after_node = null;
    }
    let place_to_add = parent;
    let newgroup: Node | null = null;
    if (rootMode !== ImportRoot.None) {
      newgroup = this.getReprDoc().createElement('svg:g');
      if (after_node) parent.addChild(newgroup, after_node);
      else parent.appendChild(newgroup);
      place_to_add = newgroup;
      after_node = null;
    }
    const root = input_doc.getReprRoot();

    let has_group_attributes = false;
    const style = spReprCssAttrNew();
    spReprCssAttrAddFromString(style, input_doc.getRoot().style.write());
    if (style.attributeList().length && newgroup) {
      spReprCssSet(newgroup, style, 'style');
      has_group_attributes = true;
    }

    let pasted_objects: Node[] = [];
    for (let obj = root.firstChild(); obj; obj = obj.next()) {
      // Don't copy metadata, defs, named views and internal clipboard contents to the document
      const tag = obj.name();
      if (
        tag === 'svg:defs' || // imported by import_defs
        tag === 'svg:metadata' ||
        tag === 'sodipodi:namedview' ||
        tag === 'inkscape:clipboard'
      ) {
        continue;
      }
      if (tag === 'svg:style') {
        this.getReprRoot().appendChild(obj.duplicate(this.getReprDoc()));
        continue;
      }

      const obj_copy = obj.duplicate(this.getReprDoc());
      if (after_node) {
        place_to_add.addChild(obj_copy, after_node);
        after_node = obj_copy;
      } else {
        place_to_add.appendChild(obj_copy);
      }

      sp_repr_visit_descendants(obj_copy, (node) => {
        if (layerMode === ImportLayersMode.ToGroup && node.name() === 'svg:g') {
          // convert layers to groups, and make sure they are unlocked
          // FIXME: add "preserve layers" mode where each layer from
          //        import is copied to the same-named layer in host
          if (sp_repr_is_layer(node)) {
            node.removeAttribute('inkscape:groupmode');
            node.removeAttribute('sodipodi:insensitive');
          }
        }
        return true;
      });

      if (this.getObjectByRepr(obj_copy) instanceof SPItem) pasted_objects.push(obj_copy);
    }

    // Fixup objects referencing objects that didn't get copied, for example copying <use> without original.
    // When the original gets erased, clones get properly unlinked and replaced by the content of original.
    const pasted_objects_not: Node[] = [];
    const clipboard = sp_repr_lookup_name(root, 'inkscape:clipboard', 1);
    if (clipboard) {
      for (let obj = clipboard.firstChild(); obj; obj = obj.next()) {
        if (this.getObjectById(obj.attribute('id'))) continue;
        const obj_copy = obj.duplicate(this.getReprDoc());
        place_to_add.appendChild(obj_copy);
        pasted_objects_not.push(obj_copy);
      }
    }
    this.ensureUpToDate();
    const object_set = new ObjectSet(this);
    object_set.setReprList(pasted_objects_not);
    object_set.deleteItems(true);

    if (
      newgroup &&
      !has_group_attributes &&
      rootMode !== ImportRoot.AlwaysGroup &&
      (newgroup.childCount() === 1 || rootMode === ImportRoot.WhenNeeded)
    ) {
      // remove unnecessary group
      const group_root = this.getObjectByRepr(newgroup);
      let group_children: SPItem[] = [];
      if (group_root instanceof SPGroup) sp_item_group_ungroup(group_root, group_children);
      newgroup = null;
      // further ungroup, mainly needed only for imported images
      if (rootMode === ImportRoot.UngroupSingle) {
        for (;;) {
          const group = group_children.length === 1 ? group_children[0] : null;
          if (!(group instanceof SPGroup && group.children.length === 1)) break;
          group_children = [];
          sp_item_group_ungroup(group, group_children);
        }
      }
      pasted_objects = group_children.map((item) => item.getRepr());
    } else if (newgroup) {
      pasted_objects = [newgroup];
    }

    this.ensureUpToDate();
    input_doc.ensureUpToDate();

    const sp_parent = this.getObjectByRepr(parent);
    const parent2doc = sp_parent instanceof SPItem ? sp_parent.i2docAffine() : this.getRoot().i2docAffine();

    const final_transform = this.dt2doc() // objectSet operates in dt space, but for following operations it's easier to use doc
      .multiply(parent2doc.inverse()) // cancel out parent transformation
      .multiply(input_doc.getRoot().c2p) // cancel out source doc user scaling and viewport
      .multiply(transform) // addd the new transform
      .multiply(this.doc2dt());

    object_set.setReprList(pasted_objects);
    object_set.applyAffine(final_transform, true, false);
    return pasted_objects;
  }

  /**
   * Paste all defs from the clipboard (or an imported document) into this document.
   * TODO: merge equivalent gradients and path effects (first and second pass of
   * upstream _importDefsNode), symbol duplicates.
   */
  importDefs(source: SPDocument): void {
    const root = source.getReprRoot();
    const target_defs = this.getDefs()?.getRepr();
    if (!target_defs) return;
    prevent_id_clashes(source, this);
    for (const defs of sp_repr_lookup_name_many(root, 'svg:defs')) {
      /* Final pass: copy over those parts which are not duplicates  */
      for (let def = defs.firstChild(); def; def = def.next()) {
        if (def.type() !== 'element') continue;
        target_defs.appendChild(def.duplicate(this.getReprDoc()));
      }
    }
  }

  #emitModified(objectModifiedTag: number): void {
    this.root.emitModified(objectModifiedTag);
    this.modifiedSignal.emit(0b111);
  }

  setModifiedSinceSave(modified = true): void {
    this.modifiedSinceSave = modified;
    this.modifiedSinceSaveSignal.emit(modified);
  }
}

interface FindOptions {
  take_hidden: boolean;
  take_insensitive: boolean;
  take_groups: boolean;
  enter_groups: boolean;
  enter_layers: boolean;
}

/** Collect into s the items of group (recursively, see getItemsInBox) whose visual bounds pass test. */
function find_items_in_area(
  s: SPItem[],
  group: SPGroup,
  dkey: number,
  area: Rect,
  test: (area: Rect, box: Rect) => boolean,
  o: FindOptions,
): SPItem[] {
  for (const item of group.children) {
    if (!(item instanceof SPItem)) continue;
    if (!o.take_insensitive && item.isLocked()) continue;
    if (!o.take_hidden && item.isHidden()) continue;
    if (item instanceof SPGroup) {
      const is_layer = item.effectiveLayerMode(dkey) === LayerMode.LAYER;
      if ((o.enter_layers && is_layer) || o.enter_groups) find_items_in_area(s, item, dkey, area, test, o);
      if (!o.take_groups || (o.enter_layers && is_layer)) continue;
    }
    const box = item.documentVisualBounds();
    if (box && test(area, box)) s.push(item);
  }
  return s;
}
