// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-root.cpp, src/object/sp-root.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2002 authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import type { SPDocument } from '../document.ts';
import type { Node } from '../xml/node.ts';
import { SPDefs } from './sp-defs.ts';
import { SPGroup } from './sp-item-group.ts';

const SVG_VERSION = '1.1';

/**
 * The svg:svg root element (upstream SPRoot).
 * TODO: x/y/width/height, viewBox, preserveAspectRatio, versions, viewport update.
 */
export class SPRoot extends SPGroup {
  /** Primary svg:defs, where new defs (gradients, patterns, …) go: the first defs child. */
  defs: SPDefs | null = null;

  protected override build(document: SPDocument, repr: Node): void {
    if (!repr.attribute('version')) repr.setAttribute('version', SVG_VERSION);
    super.build(document, repr);
    this.#findDefs();
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    if (this.document.getObjectByRepr(child) instanceof SPDefs) this.#findDefs();
  }

  protected override removeChild(child: Node): void {
    const removed = this.getChildByRepr(child);
    super.removeChild(child);
    if (removed === this.defs) this.#findDefs();
  }

  #findDefs(): void {
    this.defs = (this.children.find((c) => c instanceof SPDefs) as SPDefs | undefined) ?? null;
  }
}
