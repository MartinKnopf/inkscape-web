// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/xml/repr-sorting.cpp, src/xml/repr-sorting.h, src/xml/repr-util.cpp
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import type { Node } from './node.ts';

/** The lowest common ancestor of a and b, or null (also if it is the document node). */
export function lowest_common_ancestor(a: Node, b: Node): Node | null {
  const ancestors = new Set<Node>();
  for (let n: Node | null = a; n; n = n.parent()) ancestors.add(n);
  for (let n: Node | null = b; n; n = n.parent()) {
    if (ancestors.has(n)) return n.type() === 'document' ? null : n;
  }
  return null;
}

/** Whether descendant is ancestor or inside it. */
export function is_descendant_of(descendant: Node | null, ancestor: Node): boolean {
  for (let n = descendant; n; n = n.parent()) if (n === ancestor) return true;
  return false;
}

/** The child of ancestor that contains descendant, or null. */
export function find_containing_child(descendant: Node | null, ancestor: Node): Node | null {
  for (let n = descendant; n; n = n.parent()) if (n.parent() === ancestor) return n;
  return null;
}

/**
 * Compare the positions of two nodes in document order: -1 if first comes
 * first (is lower in z-order), 1 if second comes first, 0 if they are the
 * same. An ancestor comes before its descendants.
 */
export function sp_repr_compare_position(first: Node, second: Node): number {
  let p1: number;
  let p2: number;
  if (first.parent() === second.parent()) {
    /* Basic case - first and second have same parent */
    p1 = first.position();
    p2 = second.position();
  } else {
    /* Special case - the two objects have different parents.  They
       could be in different groups or on different layers for
       instance. */
    const ancestor = lowest_common_ancestor(first, second);
    if (!ancestor) throw new Error('sp_repr_compare_position: nodes in different documents');
    if (ancestor === first) return -1;
    if (ancestor === second) return 1;
    p1 = find_containing_child(first, ancestor)?.position() ?? 0;
    p2 = find_containing_child(second, ancestor)?.position() ?? 0;
  }
  if (p1 > p2) return 1;
  if (p1 < p2) return -1;
  return 0;
}
