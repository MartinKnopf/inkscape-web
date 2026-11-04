// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-tref-reference.cpp, src/object/sp-tref-reference.h
/*
 * The reference corresponding to href of <tref> element.
 *
 * This file was created based on sp-use-reference.cpp
 *
 * Copyright (C) 2007 Gail Banaszkiewicz
 */
import type { Node } from '../xml/node.ts';
import type { NodeObserver } from '../xml/node-observer.ts';
import type { SPObject } from './sp-object.ts';
import { URIReference } from './uri-references.ts';

/**
 * The reference of a tref to the element whose character data it shows
 * (upstream SPTRefReference). It observes the subtree of the referred
 * element and calls onTextChanged when its text content changes.
 */
export class SPTRefReference extends URIReference implements NodeObserver {
  /** Set by the owner tref: rebuild its text (upstream: sp_tref_update_text(owner)). */
  onTextChanged: (() => void) | null = null;
  #subtreeObserved: Node | null = null;

  constructor(owner: SPObject) {
    super(owner);
    this.updateObserver();
  }

  /** Observe the subtree of the referred object. */
  updateObserver(): void {
    const referred = this.getObject();
    if (referred) {
      this.#subtreeObserved?.removeSubtreeObserver(this);
      this.#subtreeObserved = referred.getRepr();
      this.#subtreeObserved.addSubtreeObserver(this);
    }
  }

  /** Stop observing (upstream: the destructor). */
  removeObserver(): void {
    this.#subtreeObserved?.removeSubtreeObserver(this);
    this.#subtreeObserved = null;
  }

  // Node Observer Functions
  notifyChildAdded(): void {
    this.onTextChanged?.();
  }
  notifyChildRemoved(): void {
    this.onTextChanged?.();
  }
  notifyChildOrderChanged(): void {
    this.onTextChanged?.();
  }
  notifyContentChanged(): void {
    this.onTextChanged?.();
  }
  notifyAttributeChanged(): void {
    // Do nothing - tref only cares about textual content
  }
}
