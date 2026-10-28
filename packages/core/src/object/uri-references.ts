// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/uri-references.cpp, src/object/uri-references.h
/*
 * Helper methods for resolving URI References
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Marc Jeanmougin
 *
 * Copyright (C) 2001-2002 Lauris Kaplinski
 * Copyright (C) 2001 Ximian, Inc.
 */
import type { SPDocument } from '../document.ts';
import { Signal } from '../util/signal.ts';
import type { SPObject } from './sp-object.ts';

/** Upstream Inkscape::UnsupportedURIException and MalformedURIException. */
export class BadURIException extends Error {}

/**
 * The id that a same-document URI ("#id" or "#xpointer(id(id))") points to.
 * Throws BadURIException for other URIs.
 * TODO: references into other documents (upstream createChildDoc).
 */
function uriFragmentId(uri: string): string {
  if (!uri.startsWith('#')) throw new BadURIException(`Unsupported URI: ${uri}`);
  const fragment = uri.slice(1);
  /* FIXME !!! real xpointer support should be delegated to document */
  /* for now this handles the minimal xpointer form that SVG 1.0
   * requires of us
   */
  if (fragment.startsWith('xpointer(')) {
    const m = /^xpointer\(id\((.+)\)\)$/.exec(fragment);
    if (!m?.[1]) throw new BadURIException(`Malformed URI: ${uri}`);
    return m[1];
  }
  if (!fragment) throw new BadURIException(`Unsupported URI: ${uri}`);
  return fragment;
}

/**
 * A reference from an owner object to the object that a URI points to
 * (upstream Inkscape::URIReference). It follows id changes in the document:
 * changedSignal is emitted with the old and the new object.
 *
 * The reference increments the hrefcount of the object (SPObject.hrefObject). Upstream does this
 * also for references owned by a document (desktop and query styles); here these do not count,
 * because JS has no destructor that would release the count of a style that is no longer used.
 */
export class URIReference {
  readonly #owner: SPObject | null;
  readonly #ownerDocument: SPDocument | null;
  #obj: SPObject | null = null;
  #uri: string | null = null;
  #connection: (() => void) | null = null;
  #releaseConnection: (() => void) | null = null;
  readonly changedSignal = new Signal<[SPObject | null, SPObject | null]>();

  constructor(owner: SPObject | SPDocument) {
    if ('getRepr' in owner) {
      this.#owner = owner;
      this.#ownerDocument = null;
    } else {
      this.#owner = null;
      this.#ownerDocument = owner;
    }
  }

  getObject(): SPObject | null {
    return this.#obj;
  }
  getOwner(): SPObject | null {
    return this.#owner;
  }
  getOwnerObject(): SPObject | null {
    return this.#owner;
  }
  /** The document of the owner (upstream returns null for object owners; callers here want the document). */
  getOwnerDocument(): SPDocument | null {
    return this.#owner ? this.#owner.document : this.#ownerDocument;
  }
  getURI(): string | null {
    return this.#uri;
  }
  /** The URI in CSS form, "url(#id)" (upstream Inkscape::URI::cssStr). */
  cssStr(): string | null {
    return this.#uri === null ? null : `url(${this.#uri})`;
  }
  isAttached(): boolean {
    return this.#uri !== null;
  }

  /** Attach to the object of uri. Throws BadURIException for unsupported URIs. */
  attach(uri: string): void {
    const document = this.#owner ? this.#owner.document : this.#ownerDocument;
    if (!document) {
      console.warn(`Can't get document for referenced URI: ${uri}`);
      return;
    }
    const id = uriFragmentId(uri);

    this.#connection?.();
    this.#uri = uri;

    this.#setObject(document.getObjectById(id));
    this.#connection = document.connectIdChanged(id, (obj) => this.#setObject(obj));
  }

  /** Attach to uri if it is supported, else detach. Returns whether attached. */
  try_attach(uri: string | null): boolean {
    if (uri) {
      try {
        this.attach(uri);
        return true;
      } catch (e) {
        if (!(e instanceof BadURIException)) throw e;
      }
    }
    this.detach();
    return false;
  }

  detach(): void {
    this.#connection?.();
    this.#connection = null;
    this.#uri = null;
    this.#setObject(null);
  }

  /*
   * The main ideas here are:
   * (1) "If we are inside a clone, then we can accept if and only if our "original thing" can accept the reference"
   * (this caused problems when there are clones because a change in ids triggers signals for the object hrefing this id,
   * but also its cloned reprs(descendants of <use> referencing an ancestor of the href'ing object)).
   *
   * (2) Once we have an (potential owner) object, it can accept a href to obj, iff the graph of objects where directed
   * edges are
   * either parent->child relations , *** or href'ing to href'ed *** relations, stays acyclic.
   * We can go either from owner and up in the tree, or from obj and down, in either case this will be in the worst case
   * linear in the number of objects.
   * There are no easy objects allowing to do the second proposition, while "hrefList" is a "list of objects href'ing us",
   * so we'll take this.
   * Then we keep a set of already visited elements, and do a DFS on this graph. if we find obj, then BOOM.
   */
  protected _acceptObject(obj: SPObject): boolean {
    // we go back following hrefList and parent to find if the object already references ourselves indirectly
    const done = new Set<SPObject>();
    let owner = this.#owner;
    // TODO: allow LPE objects (LivePathEffectObject) as owner has any URI attached
    if (!owner) return true;

    while (owner.cloned) {
      // happens when the clone is existing and linking to something, even before the original objects exists.
      if (!owner.cloneOriginal) {
        if (!owner.parent) break;
        owner = owner.parent;
      } else {
        owner = owner.cloneOriginal;
      }
    }
    // once we have the "original" object (hopefully) we look at who is referencing it
    if (obj === owner) return false;
    const todo: (SPObject | null)[] = [owner.parent, ...owner.hrefList];
    while (todo.length) {
      const e = todo.shift();
      if (!e) continue;
      if (!done.has(e)) {
        done.add(e);
        if (e === obj) return false;
        todo.unshift(e.parent, ...e.hrefList);
      }
    }
    return true;
  }

  #setObject(obj: SPObject | null): void {
    if (obj && !this._acceptObject(obj)) obj = null;
    if (obj === this.#obj) return;

    const old_obj = this.#obj;
    this.#obj = obj;

    this.#releaseConnection?.();
    this.#releaseConnection = null;
    const owner = this.#owner;
    // Document owners do not count, see the class comment.
    const counts = owner !== null && !owner.cloned;
    if (obj) {
      if (counts) obj.hrefObject(owner);
      this.#releaseConnection = obj.releaseSignal.connect(() => this.#release(obj));
    }
    this.changedSignal.emit(old_obj, obj);
    if (old_obj && counts) {
      /* release the old object _after_ the signal emission */
      old_obj.unhrefObject(owner);
    }
  }

  /* If an object is deleted, current semantics require that we release
   * it on its "release" signal, rather than later, when its ID is actually
   * unregistered from the document.
   */
  #release(obj: SPObject): void {
    if (this.#obj === obj) this.#setObject(null);
  }
}

/** The object of a "url(#id)" value, or null. */
export function sp_css_uri_reference_resolve(document: SPDocument, uri: string | null): SPObject | null {
  const m = uri ? /^url\(\s*['"]?([^'")]*)['"]?\s*\)/.exec(uri) : null;
  return m?.[1] ? sp_uri_reference_resolve(document, m[1]) : null;
}

/** The object of a "#id" reference, or null. */
export function sp_uri_reference_resolve(document: SPDocument, uri: string | null): SPObject | null {
  return uri?.startsWith('#') ? document.getObjectById(uri.slice(1)) : null;
}
