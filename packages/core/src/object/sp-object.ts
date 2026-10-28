// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-object.cpp, src/object/sp-object.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Stephen Silver <sasilver@users.sourceforge.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Adrian Boguszewski
 *
 * Copyright (C) 1999-2016 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { attributeIsCss, attributeLookup, attributeName, SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { Preferences } from '../preferences.ts';
import { SP_STYLE_FLAG_IFSET, SP_STYLE_FLAG_IFSRC, SPStyle, SPStyleSrc } from '../style.ts';
import { Signal } from '../util/signal.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import type { NodeObserver } from '../xml/node-observer.ts';

export const SP_OBJECT_MODIFIED_FLAG = 1 << 0;
export const SP_OBJECT_CHILD_MODIFIED_FLAG = 1 << 1;
export const SP_OBJECT_PARENT_MODIFIED_FLAG = 1 << 2;
export const SP_OBJECT_STYLE_MODIFIED_FLAG = 1 << 3;
export const SP_OBJECT_VIEWPORT_MODIFIED_FLAG = 1 << 4;
export const SP_OBJECT_USER_MODIFIED_FLAG_A = 1 << 5;
export const SP_OBJECT_USER_MODIFIED_FLAG_B = 1 << 6;
export const SP_OBJECT_STYLESHEET_MODIFIED_FLAG = 1 << 7;
export const SP_OBJECT_FLAGS_ALL = 0xff;
export const SP_OBJECT_USER_TAGS_ALL = 0xff00;
/** Flags that mark an object as modified: object, child, style, viewport, user. */
export const SP_OBJECT_MODIFIED_STATE = SP_OBJECT_FLAGS_ALL & ~SP_OBJECT_PARENT_MODIFIED_FLAG;
/** Flags that propagate down: parent, style, viewport, user. */
export const SP_OBJECT_MODIFIED_CASCADE =
  (SP_OBJECT_FLAGS_ALL | SP_OBJECT_USER_TAGS_ALL) &
  ~(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG);

/** Flags for children: unset object- and child-modified, set parent-modified if object-modified. */
export function cascadeFlags(flags: number): number {
  return (flags & SP_OBJECT_MODIFIED_CASCADE) | ((flags & SP_OBJECT_MODIFIED_FLAG) << 2);
}

export const SP_OBJECT_WRITE_BUILD = 1 << 0;
export const SP_OBJECT_WRITE_EXT = 1 << 1;
export const SP_OBJECT_WRITE_ALL = 1 << 2;
export const SP_OBJECT_WRITE_NO_CHILDREN = 1 << 3;

/** Update context, extended by subclasses (SPItemCtx). */
export interface SPCtx {
  flags: number;
}

export enum CollectionPolicy {
  COLLECT_WITH_PARENT,
  ALWAYS_COLLECT,
}

export enum SPXMLSpace {
  DEFAULT,
  PRESERVE,
}

/** Creates the object for a repr type string; installed by sp-factory.ts (avoids an import cycle). */
let createObject: (typeString: string) => SPObject | null = () => {
  throw new Error('import sp-factory.ts before building objects');
};
export function setObjectFactory(factory: (typeString: string) => SPObject | null): void {
  createObject = factory;
}
/** The object for a type string, from the factory (upstream SPFactory::createObject). */
export function factoryCreateObject(typeString: string): SPObject | null {
  return createObject(typeString);
}

/** Type string of a repr for the factory (upstream NodeTraits::get_type_string). */
export function getTypeString(node: Node): string {
  switch (node.type()) {
    case 'text':
      return 'string';
    case 'element':
      return node.attribute('sodipodi:type') ?? node.name();
    default:
      return '';
  }
}

/** Upstream id_permitted(): only svg:, sodipodi: and inkscape: elements get ids. */
function idPermitted(repr: Node): boolean {
  return repr.type() === 'element' && /^(svg|sodipodi|inkscape):/.test(repr.name());
}

/**
 * Base class of the object tree (upstream SPObject). Each object is bound to
 * one repr node and follows its changes through the NodeObserver methods.
 *
 * Life cycle: the parent creates the object with the factory, attaches it and
 * calls invokeBuild(). Attribute changes call set(). Changes request an update;
 * SPDocument.ensureUpToDate() then calls updateDisplay() (→ update()) and
 * emitModified() (→ modified() and the modified signal) down the tree.
 */
export class SPObject implements NodeObserver {
  document!: SPDocument;
  repr!: Node;
  parent: SPObject | null = null;
  children: SPObject[] = [];
  cloned = false;
  cloneOriginal: SPObject | null = null;
  /** Pending update flags. */
  uflags = 0;
  /** Pending modified flags. */
  mflags = 0;
  /** Number of references (xlink:href, url()) to this object, see URIReference. */
  hrefcount = 0;
  /** hrefcount of this object and all its descendants. */
  _total_hrefcount = 0;
  /** The objects that reference this object (owners of the URIReferences). */
  hrefList: SPObject[] = [];
  xmlSpace = { set: false, value: SPXMLSpace.DEFAULT };

  #id: string | null = null;
  #label: string | null = null;
  #lang: string | null = null;
  #collectionPolicy = CollectionPolicy.COLLECT_WITH_PARENT;

  readonly modifiedSignal = new Signal<[SPObject, number]>();
  readonly releaseSignal = new Signal<[SPObject]>();
  readonly deleteSignal = new Signal<[SPObject]>();

  /**
   * The style of the object, with the cascade of the parent.
   * FIXME: upstream creates a style for all objects, but per SVG only some elements can have a style attribute.
   */
  readonly style: SPStyle = new SPStyle(null, this);
  /** Style that resolves context-fill and context-stroke (markers, clones). */
  context_style: SPStyle | null = null;

  getId(): string | null {
    return this.#id;
  }
  getRepr(): Node {
    return this.repr;
  }
  label(): string | null {
    return this.#label;
  }
  getLanguage(): string | null {
    for (let o: SPObject | null = this; o; o = o.parent) if (o.#lang) return o.#lang;
    return null;
  }
  collectionPolicy(): CollectionPolicy {
    return this.#collectionPolicy;
  }
  setCollectionPolicy(policy: CollectionPolicy): void {
    this.#collectionPolicy = policy;
  }

  // References and orphan collection

  /** Increase the hrefcount; owner is the referencing object (upstream hrefObject). */
  hrefObject(owner: SPObject | null = null): void {
    // If owner is a clone, do not increase hrefcount, it's already href'ed by original.
    if (!owner?.cloned) {
      this.hrefcount++;
      this.#updateTotalHRefCount(1);
    }
    if (owner) this.hrefList.unshift(owner);
  }

  /** Decrease the hrefcount; the object is collected when it drops to zero and its policy allows it. */
  unhrefObject(owner: SPObject | null = null): void {
    if (!owner?.cloned) {
      if (this.hrefcount <= 0) {
        console.error('unhrefObject: hrefcount is already 0');
        return;
      }
      this.hrefcount--;
      this.#updateTotalHRefCount(-1);
    }
    if (owner) {
      const i = this.hrefList.indexOf(owner);
      if (i >= 0) this.hrefList.splice(i, 1);
    }
  }

  #updateTotalHRefCount(increment: number): void {
    let topmost_collectable: SPObject | null = null;
    for (let iter: SPObject | null = this; iter; iter = iter.parent) {
      iter._total_hrefcount += increment;
      if (iter._total_hrefcount < iter.hrefcount) console.error('HRefs overcounted');
      if (iter._total_hrefcount === 0 && iter.#collectionPolicy !== CollectionPolicy.COLLECT_WITH_PARENT) {
        topmost_collectable = iter;
      }
    }
    topmost_collectable?.requestOrphanCollection();
  }

  /** Whether another object references this object or a descendant. */
  isReferenced(): boolean {
    return this._total_hrefcount > 0;
  }

  /**
   * Queue the object for collectOrphan() in the next document commit (SPDocument.collectOrphans).
   * Swatches are kept unless /options/cleanupswatches/value is set.
   * TODO: style, script, font, color profile and page elements are kept (not ported yet).
   */
  requestOrphanCollection(): void {
    const swatch = 'isSwatch' in this && typeof this.isSwatch === 'function' && this.isSwatch();
    if (swatch && !Preferences.get().getBool('/options/cleanupswatches/value', false)) return;
    this.document.queueForOrphanCollection(this);
  }

  /** Delete the object if nothing references it (no notification at the SPObject level). */
  collectOrphan(): void {
    if (this._total_hrefcount === 0) this.deleteObject(false);
  }

  // Tree navigation

  firstChild(): SPObject | null {
    return this.children[0] ?? null;
  }
  lastChild(): SPObject | null {
    return this.children.at(-1) ?? null;
  }
  hasChildren(): boolean {
    return this.children.length > 0;
  }
  nthChild(index: number): SPObject | null {
    return this.children[index] ?? null;
  }
  getNext(): SPObject | null {
    const siblings = this.parent?.children;
    return siblings?.[siblings.indexOf(this) + 1] ?? null;
  }
  getPrev(): SPObject | null {
    const siblings = this.parent?.children;
    if (!siblings) return null;
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }
  childList(): SPObject[] {
    return [...this.children];
  }
  /** Ancestors, nearest first, or root first if rootToTip. */
  ancestorList(rootToTip: boolean): SPObject[] {
    const list: SPObject[] = [];
    for (let o = this.parent; o; o = o.parent) list.push(o);
    return rootToTip ? list.reverse() : list;
  }
  isAncestorOf(object: SPObject): boolean {
    for (let o = object.parent; o; o = o.parent) if (o === this) return true;
    return false;
  }
  nearestCommonAncestor(object: SPObject): SPObject | null {
    const mine = new Set<SPObject>([this, ...this.ancestorList(false)]);
    for (let o: SPObject | null = object; o; o = o.parent) if (mine.has(o)) return o;
    return null;
  }
  getChildByRepr(repr: Node): SPObject | null {
    const last = this.children.at(-1);
    if (last?.repr === repr) return last;
    return this.children.find((c) => c.repr === repr) ?? null;
  }

  // Repr access

  getAttribute(name: string): string | null {
    return this.repr.attribute(name);
  }
  setAttribute(name: string, value: string | null): void {
    this.repr.setAttribute(name, value);
  }
  setAttributeOrRemoveIfEmpty(name: string, value: string | null): void {
    this.repr.setAttribute(name, value ? value : null);
  }
  removeAttribute(name: string): void {
    this.repr.removeAttribute(name);
  }
  getTagName(): string {
    return this.repr.name();
  }
  /** Read an attribute from the repr and pass it to set(). */
  readAttr(key: SPAttr | string): void {
    const id = typeof key === 'string' ? attributeLookup(key) : key;
    if (id === SPAttr.INVALID) return;
    const name = attributeName(id);
    if (name === null) throw new Error(`no attribute name for ${id}`);
    // Upstream getHrefAttribute(): SVG 2 href, else xlink:href.
    const value =
      id === SPAttr.XLINK_HREF
        ? (this.repr.attribute('href') ?? this.repr.attribute('xlink:href'))
        : this.repr.attribute(name);
    this.setKeyValue(id, value);
  }
  setKeyValue(key: SPAttr, value: string | null): void {
    this.set(key, value);
  }

  /** Create a repr for child and append it to our repr; the object follows by observation. */
  appendChildRepr(repr: Node): SPObject | null {
    if (this.cloned) return null;
    this.repr.appendChild(repr);
    return this.document.getObjectByRepr(repr);
  }

  // Building and release

  /** Bind this object to repr and build it and its children. */
  invokeBuild(document: SPDocument, repr: Node, cloned: boolean): void {
    this.document = document;
    this.repr = repr;
    this.cloned = cloned;
    this.build(document, repr);
    if (!cloned) {
      document.bindObjectToRepr(repr, this);
      if (idPermitted(repr)) {
        const id = repr.attribute('id');
        if (!document.isSeeking()) {
          const realId = this.generateUniqueId(id);
          document.bindObjectToId(realId, this);
          this.#id = realId;
          if (id !== realId) repr.setAttribute('id', realId);
        } else if (id && !document.getObjectById(id)) {
          document.bindObjectToId(id, this);
          this.#id = id;
        }
      }
    }
    repr.addObserver(this);
  }

  /** Release the object and its children from the document. */
  releaseReferences(): void {
    this.repr.removeObserver(this);
    this.releaseSignal.emit(this);
    this.release();
    if (!this.cloned) {
      if (this.#id) this.document.bindObjectToId(this.#id, null);
      this.#id = null;
      this.document.bindObjectToRepr(this.repr, null);
    }
  }

  /** Delete the object by removing its repr. */
  deleteObject(propagate = true): void {
    if (propagate) this.deleteSignal.emit(this);
    this.repr.parent()?.removeChild(this.repr);
  }

  generateUniqueId(defaultId: string | null = null): string {
    if (defaultId && !this.document.getObjectById(defaultId)) return defaultId;
    const name = this.repr.name();
    return this.document.generateUniqueId(name.slice(name.indexOf(':') + 1));
  }

  attach(object: SPObject, prev: SPObject | null): void {
    object.parent = this;
    const index = prev ? this.children.indexOf(prev) + 1 : 0;
    this.children.splice(index, 0, object);
  }
  reorder(object: SPObject, prev: SPObject | null): void {
    this.children.splice(this.children.indexOf(object), 1);
    const index = prev ? this.children.indexOf(prev) + 1 : 0;
    this.children.splice(index, 0, object);
  }
  detach(object: SPObject): void {
    object.releaseReferences();
    this.children.splice(this.children.indexOf(object), 1);
    object.parent = null;
  }

  // Virtual methods for subclasses

  protected build(document: SPDocument, repr: Node): void {
    // Upstream reads the style in the build() of the subclasses (SPItem, SPDefs, ...). It is read
    // here too, so that write() does not remove the style attribute of an object that never read it.
    this.readAttr(SPAttr.STYLE);
    this.readAttr(SPAttr.XML_SPACE);
    this.readAttr(SPAttr.LANG);
    this.readAttr(SPAttr.XML_LANG); // "xml:lang" overrides "lang" per spec, read it last.
    this.readAttr(SPAttr.INKSCAPE_LABEL);
    this.readAttr(SPAttr.INKSCAPE_COLLECT);
    const id = repr.attribute('id');
    if (this.cloned && id) this.cloneOriginal = document.getObjectById(id);
    for (const rchild of repr.children()) {
      const child = createObject(getTypeString(rchild));
      if (!child) continue;
      this.attach(child, this.lastChild());
      child.invokeBuild(document, rchild, this.cloned);
    }
  }

  protected release(): void {
    this.style.filter.clear();
    this.style.fill.dropHref();
    this.style.stroke.dropHref();
    this.style.shape_inside.clear();
    this.style.shape_subtract.clear();

    for (const child of [...this.children]) this.detach(child);
  }

  protected childAdded(child: Node, ref: Node | null): void {
    const object = createObject(getTypeString(child));
    if (!object) return;
    this.attach(object, this.#closestChildByRepr(ref));
    object.invokeBuild(this.document, child, this.cloned);
  }

  protected removeChild(child: Node): void {
    const object = this.getChildByRepr(child);
    if (object) this.detach(object);
  }

  protected orderChanged(child: Node, _oldRef: Node | null, newRef: Node | null): void {
    const object = this.getChildByRepr(child);
    if (!object) return;
    this.reorder(object, this.#closestChildByRepr(newRef));
  }

  /** Called when the attribute key changes (and once per attribute in build). */
  set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.ID: {
        if (this.cloned || this.repr.type() !== 'element') break;
        let newId = value;
        const conflict = newId ? this.document.getObjectById(newId) : null;
        if (conflict && conflict !== this) {
          if (!this.document.isSeeking()) conflict.setAttribute('id', conflict.generateUniqueId());
          else newId = null;
        }
        if (this.#id) {
          this.document.bindObjectToId(this.#id, null);
          this.#id = null;
        }
        if (newId) {
          this.#id = newId;
          this.document.bindObjectToId(newId, this);
        }
        break;
      }
      case SPAttr.INKSCAPE_LABEL:
        this.#label = value;
        break;
      case SPAttr.INKSCAPE_COLLECT:
        this.#collectionPolicy =
          value === 'always' ? CollectionPolicy.ALWAYS_COLLECT : CollectionPolicy.COLLECT_WITH_PARENT;
        break;
      case SPAttr.XML_SPACE:
        if (value === 'preserve' || value === 'default') {
          this.xmlSpace = {
            set: true,
            value: value === 'preserve' ? SPXMLSpace.PRESERVE : SPXMLSpace.DEFAULT,
          };
        } else if (this.parent) {
          this.xmlSpace = { set: false, value: this.parent.xmlSpace.value };
        }
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
        break;
      case SPAttr.LANG:
      case SPAttr.XML_LANG: {
        if (key === SPAttr.LANG && this.getAttribute('xml:lang')) break;
        this.#lang = value ?? (key === SPAttr.XML_LANG ? this.getAttribute('lang') : null);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
        break;
      }
      case SPAttr.STYLE:
        this.style.readFromObject(this);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
        break;
      default:
        // Upstream routes the presentation attributes in the set() of SPItem and some other
        // classes. They are handled here until these classes do it.
        if (attributeIsCss(key)) {
          this.style.readFromObject(this);
          this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
        }
        break;
    }
  }

  /** Recalculate derived data. flags contain the cascade from the parent. */
  protected update(_ctx: SPCtx, _flags: number): void {}

  /** Called after an update, for listeners. */
  protected modified(_flags: number): void {}

  /**
   * Write the object state to repr (or a duplicate for xmlDoc with
   * SP_OBJECT_WRITE_BUILD). Subclasses write their attributes, then call super.
   */
  write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (!repr && flags & SP_OBJECT_WRITE_BUILD) {
      repr = this.repr.duplicate(xmlDoc);
      if (!(flags & SP_OBJECT_WRITE_EXT)) repr.removeAttribute('inkscape:collect');
    } else if (repr) {
      repr.setAttribute('id', this.#id);
      if (this.xmlSpace.set) {
        repr.setAttribute('xml:space', this.xmlSpace.value === SPXMLSpace.PRESERVE ? 'preserve' : 'default');
      }
      if (this.#lang) {
        repr.setAttribute('xml:lang', this.#lang);
      } else {
        repr.removeAttribute('xml:lang');
        repr.removeAttribute('lang');
      }
      if (flags & SP_OBJECT_WRITE_EXT && this.#collectionPolicy === CollectionPolicy.ALWAYS_COLLECT) {
        repr.setAttribute('inkscape:collect', 'always');
      } else {
        repr.removeAttribute('inkscape:collect');
      }

      // Write if property set by style attribute in this object
      const styleProp = this.style.writeSrc(SPStyleSrc.STYLE_PROP);

      // Write style attributes (SPStyleSrc::ATTRIBUTE) back to xml object
      let anyWritten = false;
      for (const prop of this.style.properties()) {
        if (prop.shallWrite(SP_STYLE_FLAG_IFSET | SP_STYLE_FLAG_IFSRC, SPStyleSrc.ATTRIBUTE)) {
          // WARNING: We don't know for sure if the css names are the same as the attribute names
          const val = repr.attribute(prop.name());
          const newVal = prop.getValue();
          if ((newVal === '' && val === null) || newVal !== val) {
            repr.setAttribute(prop.name(), newVal || null);
            anyWritten = true;
          }
        }
      }
      if (anyWritten) {
        // We need to ask the object to update the style and keep things in sync
        // see `case SPAttr::STYLE` above for how the style attr itself does this.
        this.style.readFromObject(this);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
      }

      // TODO: the check_on_editing preference (sp_attribute_clean_style) is not ported.
      repr.setAttribute('style', styleProp || null);
    }
    return repr;
  }

  /** Write the object to its own repr. */
  updateRepr(flags = SP_OBJECT_WRITE_EXT): void {
    if (this.cloned) return;
    this.write(this.repr.document(), this.repr, flags);
  }

  // Update and modified cycle

  /** Request an update (one of MODIFIED or CHILD_MODIFIED, plus optional others). */
  requestDisplayUpdate(flags: number): void {
    if (!this.document) return;
    checkRequestFlags(flags);
    const alreadyPropagated = !(this.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG));
    this.uflags |= flags;
    if (alreadyPropagated) {
      if (this.parent) this.parent.requestDisplayUpdate(SP_OBJECT_CHILD_MODIFIED_FLAG);
      else this.document.requestModified();
    }
  }

  updateDisplay(ctx: SPCtx, flags: number): void {
    if (flags & ~SP_OBJECT_MODIFIED_CASCADE) throw new Error('updateDisplay: invalid flags');
    flags |= this.uflags;
    this.mflags |= this.uflags;
    this.uflags = 0;

    // Merge style if we have good reasons to think that parent style is changed
    // TODO: I am not sure whether we should check only propagated flag. We are currently
    // assuming that style parsing is done immediately. I think this is correct (Lauris).
    this.style.block_filter_bbox_updates = true;
    if (flags & SP_OBJECT_STYLESHEET_MODIFIED_FLAG) {
      this.style.readFromObject(this);
    } else if (
      this.parent &&
      flags & SP_OBJECT_STYLE_MODIFIED_FLAG &&
      flags & SP_OBJECT_PARENT_MODIFIED_FLAG
    ) {
      this.style.cascade(this.parent.style);
    }
    this.style.block_filter_bbox_updates = false;

    this.update(ctx, flags);
  }

  requestModified(flags: number): void {
    if (!this.document) return;
    checkRequestFlags(flags);
    const alreadyPropagated = !(this.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG));
    this.mflags |= flags;
    if (alreadyPropagated) {
      if (this.parent) this.parent.requestModified(SP_OBJECT_CHILD_MODIFIED_FLAG);
      else this.document.requestModified();
    }
  }

  emitModified(flags: number): void {
    if (flags & ~SP_OBJECT_MODIFIED_CASCADE) throw new Error('emitModified: invalid flags');
    flags |= this.mflags;
    // Clear first: listeners may request new modifications.
    this.mflags = 0;
    this.modified(flags);
    this.modifiedSignal.emit(this, flags);
  }

  // NodeObserver: follow the repr

  notifyAttributeChanged(_node: Node, name: string): void {
    const key = attributeLookup(name);
    if (key !== SPAttr.INVALID) this.readAttr(key);
  }
  notifyElementNameChanged(_node: Node, oldName: string, newName: string): void {
    this.tagNameChanged(oldName, newName);
  }
  /** Called when the element name of the repr changes. Rects and ellipses follow it. */
  protected tagNameChanged(_oldName: string, _newName: string): void {}
  notifyChildAdded(_node: Node, child: Node, prev: Node | null): void {
    this.childAdded(child, prev);
  }
  notifyChildRemoved(_node: Node, child: Node): void {
    this.removeChild(child);
  }
  notifyChildOrderChanged(_node: Node, child: Node, oldPrev: Node | null, newPrev: Node | null): void {
    this.orderChanged(child, oldPrev, newPrev);
  }
  notifyContentChanged(): void {
    this.readContent();
  }
  /** Called when the content of the repr changes (text nodes). */
  protected readContent(): void {}

  #closestChildByRepr(ref: Node | null): SPObject | null {
    for (; ref; ref = ref.prev()) {
      const object = this.getChildByRepr(ref);
      if (object) return object;
      // Continue only past reprs without object, e.g. comments.
      if (this.document.getObjectByRepr(ref)) break;
    }
    return null;
  }
}

function checkRequestFlags(flags: number): void {
  const modified = flags & SP_OBJECT_MODIFIED_FLAG;
  const child = flags & SP_OBJECT_CHILD_MODIFIED_FLAG;
  if (flags & SP_OBJECT_PARENT_MODIFIED_FLAG || !(modified || child) || (modified && child)) {
    throw new Error('request flags must contain one of MODIFIED or CHILD_MODIFIED, and not PARENT_MODIFIED');
  }
}
