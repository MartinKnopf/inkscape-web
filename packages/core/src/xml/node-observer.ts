// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/xml/node-observer.h
/*
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com> (documentation)
 *
 * Copyright 2005-2008 Authors
 */
import type { Node } from './node.ts';

/**
 * Receives notifications about changes of an XML node. Register with
 * Node.addObserver() (changes of the node) or Node.addSubtreeObserver()
 * (changes of the node and all its descendants). All methods are optional.
 * `prev` arguments are the sibling before the child, or null for the first position.
 */
export interface NodeObserver {
  notifyChildAdded?(node: Node, child: Node, prev: Node | null): void;
  notifyChildRemoved?(node: Node, child: Node, prev: Node | null): void;
  notifyChildOrderChanged?(node: Node, child: Node, oldPrev: Node | null, newPrev: Node | null): void;
  notifyContentChanged?(node: Node, oldContent: string | null, newContent: string | null): void;
  notifyAttributeChanged?(node: Node, name: string, oldValue: string | null, newValue: string | null): void;
  notifyElementNameChanged?(node: Node, oldName: string, newName: string): void;
}
