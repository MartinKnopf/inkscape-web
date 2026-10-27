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

import { Affine } from '@inkscape-web/geom';
import { DocumentUndo, type UndoStack } from './document-undo.ts';
import { createObject } from './object/sp-factory.ts';
import type { SPItemCtx } from './object/sp-item.ts';
import { getTypeString, type SPObject } from './object/sp-object.ts';
import { SPRoot } from './object/sp-root.ts';
import { Signal } from './util/signal.ts';
import type { XmlDocument } from './xml/document.ts';
import type { Node } from './xml/node.ts';
import { readMem } from './xml/repr-io.ts';
import { SVG_NS_URI } from './xml/repr-util.ts';

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

  /** Root update context. TODO: viewport from the root size. */
  setupViewport(): SPItemCtx {
    return { flags: 0, i2doc: Affine.identity(), i2vp: Affine.identity() };
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
