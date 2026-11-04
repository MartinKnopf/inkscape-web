// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-tref.cpp, src/object/sp-tref.h
/*
 * SVG <tref> implementation - All character data within the referenced
 * element, including character data enclosed within additional markup,
 * will be rendered.
 *
 * Authors:
 *   Gail Banaszkiewicz <Gail.Banaszkiewicz@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007 Gail Banaszkiewicz
 */
import type { Affine, OptRect } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { sp_text_get_length_upto } from '../text-editing.ts';
import type { XmlDocument } from '../xml/document.ts';
import { setHrefAttribute } from '../xml/href-attribute-helper.ts';
import type { Node } from '../xml/node.ts';
import { BBoxType, SPItem } from './sp-item.ts';
import {
  cascadeFlags,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
  type SPObject,
} from './sp-object.ts';
import { SPString } from './sp-string.ts';
import { SPTRefReference } from './sp-tref-reference.ts';
import { textRootOf } from './sp-tspan.ts';
import { TextTagAttributes } from './text-tag-attributes.ts';

/**
 * svg:tref (upstream SPTRef): shows the character data of the element that
 * xlink:href refers to, as a child string that is not in the XML tree.
 */
export class SPTRef extends SPItem {
  // Attributes that are used in the same way they would be in a tspan
  readonly attributes = new TextTagAttributes();
  // Text stored in the xlink:href attribute
  href: string | null = null;
  // URI reference to original object
  readonly uriOriginalRef = new SPTRefReference(this);
  // Shortcut pointer to the child of the tref (which is a copy
  // of the character data stored at and/or below the node
  // referenced by uriOriginalRef)
  stringChild: SPString | null = null;
  #delete_connection: (() => void) | null = null;

  constructor() {
    super();
    this.uriOriginalRef.changedSignal.connect(() => sp_tref_href_changed(this));
    this.uriOriginalRef.onTextChanged = () => sp_tref_update_text(this);
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.XLINK_HREF);
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.DX);
    this.readAttr(SPAttr.DY);
    this.readAttr(SPAttr.ROTATE);
  }

  protected override release(): void {
    this.#delete_connection?.();
    this.#delete_connection = null;
    this.href = null;
    this.uriOriginalRef.removeObserver();
    this.uriOriginalRef.detach();
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    if (this.attributes.readSingleAttribute(key, value, this.style, this.viewport)) {
      // x, y, dx, dy, rotate
      this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    } else if (key === SPAttr.XLINK_HREF) {
      if (!value) {
        // No value
        this.href = null;
        this.uriOriginalRef.detach();
      } else if (value !== this.href) {
        // Value has changed
        this.href = value;
        if (this.uriOriginalRef.try_attach(value)) this.uriOriginalRef.updateObserver();
        else console.warn(`Bad URI: ${value}`);
        // No matter what happened, an update should be in order
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
      }
    } else {
      super.set(key, value);
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    const childflags = cascadeFlags(flags);
    const child = this.stringChild;
    if (child && (childflags || child.uflags & SP_OBJECT_MODIFIED_FLAG)) child.updateDisplay(ctx, childflags);
    super.update(ctx, flags);
  }

  protected override modified(flags: number): void {
    const cflags = cascadeFlags(flags);
    const child = this.stringChild;
    if (child && (cflags || child.mflags & SP_OBJECT_MODIFIED_FLAG)) child.emitModified(cflags);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:tref');
    if (!repr) return null;
    this.attributes.writeTo(repr);
    const uri = this.uriOriginalRef.getURI();
    if (uri) setHrefAttribute(repr, uri);
    return super.write(xmlDoc, repr, flags);
  }

  override bbox(transform: Affine, type: BBoxType): OptRect {
    // find out the ancestor text which holds our layout
    const parent_text = textRootOf(this.parent);
    if (!parent_text) return null;
    // get the bbox of our portion of the layout
    return parent_text.layout.bounds(
      transform,
      type === BBoxType.VISUAL_BBOX,
      sp_text_get_length_upto(parent_text, this),
      sp_text_get_length_upto(this, null) - 1,
    );
  }

  override typeName(): string {
    return 'text-data';
  }

  override displayName(): string {
    return _('Cloned Character Data');
  }

  override description(): string {
    const referred = this.getObjectReferredTo();
    if (referred) {
      const child_desc = referred instanceof SPItem ? referred.detailedDescription() : '';
      return `${referred instanceof SPItem ? _(' from ') : ''}${child_desc}`;
    }
    return _('[orphaned]');
  }

  /** Return the object referred to via the URI reference. */
  getObjectReferredTo(): SPObject | null {
    return this.uriOriginalRef.getObject();
  }

  /** Watch the deletion of the referred object (upstream _delete_connection). */
  _connectDelete(refRoot: SPObject | null): void {
    this.#delete_connection?.();
    this.#delete_connection = refRoot ? refRoot.deleteSignal.connect(() => sp_tref_delete_self(this)) : null;
  }
}

/* For the changes of the reference (i.e. when the object being referred to changes) */
function sp_tref_href_changed(tref: SPTRef): void {
  // Save a pointer to the original object being referred to
  const refRoot = tref.getObjectReferredTo();
  tref._connectDelete(null);
  if (tref.stringChild) {
    tref.detach(tref.stringChild);
    tref.stringChild = null;
  }
  // Ensure that we are referring to a legitimate object
  if (tref.href && refRoot && sp_tref_reference_allowed(tref, refRoot)) {
    // Update the text being referred to (will create a new string child)
    sp_tref_update_text(tref);
    // Restore the delete connection now that we're done messing with stuff
    tref._connectDelete(refRoot);
  }
  tref.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
}

/** Delete the tref object. */
function sp_tref_delete_self(self: SPTRef): void {
  self.deleteObject();
}

/** Returns true when the given tref is allowed to refer to a particular object. */
export function sp_tref_reference_allowed(tref: SPTRef | null, possible_ref: SPObject | null): boolean {
  if (!tref || !possible_ref || tref === possible_ref) return false;
  for (let obj: SPObject | null = tref; obj; obj = obj.parent) {
    if (possible_ref === obj) return false;
  }
  return true;
}

/** Rebuild the string child from the character data of the referred object. */
export function sp_tref_update_text(tref: SPTRef | null): void {
  const referred = tref?.getObjectReferredTo();
  if (!tref || !referred) return;
  // Get the character data that will be used with this tref
  const charData = build_string_from_root(referred.getRepr());

  if (tref.stringChild) {
    tref.detach(tref.stringChild);
    tref.stringChild = null;
  }

  // Create the node and SPString to be the tref's child
  const newStringRepr = tref.document.getReprDoc().createTextNode(charData);
  const child = new SPString();
  tref.stringChild = child;
  // Add this SPString as a child of the tref
  tref.attach(child, tref.lastChild());
  child.invokeBuild(tref.document, newStringRepr, false);
  child.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
}

/**
 * Using depth-first search, build up a string by concatenating all SPStrings
 * found in the tree starting at the root
 */
function build_string_from_root(root: Node): string {
  // Stop and concatenate when a SPString is found
  if (root.type() === 'text') return root.content() ?? '';
  // Otherwise, continue searching down the tree (with the assumption that no children nodes
  // of a SPString are actually legal)
  let s = '';
  for (const child of root.children()) s += build_string_from_root(child);
  return s;
}

/**
 * This function will create a new tspan element with the same attributes as
 * the tref had and add the same text as a child. The tref is replaced in the
 * tree with the new tspan. The code is based partially on sp_use_unlink.
 */
export function sp_tref_convert_to_tspan(obj: SPObject): SPObject | null {
  let new_tspan: SPObject | null = null;
  // BASE CASE
  if (obj instanceof SPTRef) {
    const tref = obj;
    if (tref.stringChild) {
      const tref_repr = tref.getRepr();
      const tref_parent = tref_repr.parent();
      if (!tref_parent) return null;
      const document = tref.document;
      const xml_doc = document.getReprDoc();
      const new_tspan_repr = xml_doc.createElement('svg:tspan');
      // Add the new tspan element just after the current tref
      tref_parent.addChild(new_tspan_repr, tref_repr);
      new_tspan = document.getObjectByRepr(new_tspan_repr);
      // Create a new string child for the tspan
      new_tspan_repr.addChild(xml_doc.createTextNode(tref.stringChild.getRepr().content() ?? ''), null);
      if (new_tspan) {
        // Merge style from the tref
        new_tspan.style.merge(tref.style);
        if (new_tspan.parent) new_tspan.style.cascade(new_tspan.parent.style);
        new_tspan.updateRepr();
      }
      // Remove ourselves, not propagating delete events to avoid a
      // chain-reaction with other elements that might reference us.
      const id = tref_repr.attribute('id');
      tref.deleteObject(false);
      // Give the copy our old id.
      new_tspan_repr.setAttribute('id', id);
    }
  }
  // RECURSIVE CASE
  else {
    for (const child of [...obj.children]) {
      // Note that there may be more than one conversion happening here, so if it's not a
      // tref being passed into this function, the returned value can't be specifically known
      new_tspan = sp_tref_convert_to_tspan(child);
    }
  }
  return new_tspan;
}
