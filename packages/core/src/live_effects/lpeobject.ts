// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpeobject.cpp, src/live_effects/lpeobject.h
/*
 * Copyright (C) Johan Engelen 2007-2008 <j.b.c.engelen@utwente.nl>
 *   Abhishek Sharma
 */
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_ALL,
  SP_OBJECT_WRITE_BUILD,
  SPObject,
} from '../object/sp-object.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { sp_repr_lookup_name } from '../xml/repr-util.ts';
import { Effect } from './effect.ts';
import { EffectType, LPETypeConverter } from './effect-enum.ts';

/**
 * The inkscape:path-effect element in defs (upstream LivePathEffectObject). Its "effect"
 * attribute is the key of the effect; the other attributes are the parameters, which it passes
 * to the effect when they change (upstream LPENodeObserver).
 */
export class LivePathEffectObject extends SPObject {
  effecttype = EffectType.INVALID_LPE;
  effecttype_set = false;
  // dont check values only structure and ID
  deleted = false;
  #lpe: Effect | null = null; // this can be NULL in a valid LivePathEffectObject
  #isOnClipboard = false;

  get_lpe(): Effect | null {
    return this.#lpe;
  }

  isOnClipboard(): boolean {
    return this.#isOnClipboard;
  }

  /** Virtual build: set livepatheffect attributes from its associated XML node. */
  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.PATH_EFFECT);
    this.setOnClipboard();
    /* Register ourselves, is this necessary? */
    // document->addResource("path-effect", object);
  }

  /** Virtual release of livepatheffect members before destruction. */
  protected override release(): void {
    this.#lpe?.destroy();
    this.#lpe = null;
    this.effecttype = EffectType.INVALID_LPE;
    super.release();
  }

  /** Virtual set: set attribute to value. */
  override set(key: SPAttr, value: string | null): void {
    if (key === SPAttr.PATH_EFFECT) {
      this.#lpe?.destroy();
      this.#lpe = null;
      if (value && LPETypeConverter.is_valid_key(value)) {
        this.effecttype = LPETypeConverter.get_id_from_key(value);
        this.#lpe = Effect.New(this.effecttype, this);
        this.effecttype_set = true;
        this.deleted = false;
      } else {
        this.effecttype = EffectType.INVALID_LPE;
        this.#lpe = null;
        this.effecttype_set = false;
      }
      this.requestModified(SP_OBJECT_MODIFIED_FLAG);
    }
    super.set(key, value);
  }

  /** Virtual write: write object attributes to repr. */
  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('inkscape:path-effect');
    if (repr && (flags & SP_OBJECT_WRITE_ALL || this.#lpe)) {
      repr.setAttributeOrRemoveIfEmpty('effect', LPETypeConverter.get_key(this.effecttype));
      this.#lpe?.writeParamsToSVG();
    }
    return super.write(xmlDoc, repr, flags);
  }

  // Caution using this function, just compare id and same type of
  // effect, we use on clipboard to do not fork in same doc on pastepatheffect
  is_similar(that: LivePathEffectObject | null): boolean {
    if (that) {
      const thisid = this.getId();
      const thatid = that.getId();
      if (!thisid || !thatid || thisid !== thatid) return false;
      const thislpe = this.get_lpe();
      const thatlpe = that.get_lpe();
      if (thatlpe && thislpe && thislpe.getName() !== thatlpe.getName()) return false;
    }
    return true;
  }

  /** Set lpeobject is on clipboard */
  setOnClipboard(): void {
    // when no document we are intermedite state between clipboard
    if (!this.document) {
      this.#isOnClipboard = true;
      return;
    }
    const root = this.document.getReprRoot();
    this.#isOnClipboard = sp_repr_lookup_name(root, 'inkscape:clipboard', 1) !== null;
  }

  /**
   * If this has other users, create a new private duplicate and return it
   * returns 'this' when no forking was necessary (and therefore no duplicate was made)
   * Check out SPLPEItem::forkPathEffectsIfNecessary !
   */
  fork_private_if_necessary(nr_of_allowed_users = 1): LivePathEffectObject {
    if (this.hrefcount > nr_of_allowed_users) {
      const doc = this.document;
      const xml_doc = doc.getReprDoc();
      const dup_repr = this.getRepr().duplicate(xml_doc);
      // The duplicate gets a new unique id when its object is built.
      dup_repr.removeAttribute('id');
      doc.getDefs()?.getRepr().appendChild(dup_repr);
      const lpeobj_new = doc.getObjectByRepr(dup_repr);
      if (lpeobj_new instanceof LivePathEffectObject) return lpeobj_new;
    }
    return this;
  }

  /** Upstream LPENodeObserver::notifyAttributeChanged: a parameter changed. */
  override notifyAttributeChanged(node: Node, name: string): void {
    super.notifyAttributeChanged(node, name);
    const lpe = this.get_lpe();
    if (!lpe) return;
    lpe.setParameter(name, node.attribute(name));
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }
}
