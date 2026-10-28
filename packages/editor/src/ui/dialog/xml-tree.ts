// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/xml-tree.cpp, src/ui/dialog/xml-tree.h
/*
 * Authors:
 *   Lauris Kaplinski
 *   Jon A. Cruz
 *   Abhishek Sharma
 *   Martin Owens
 *
 * Copyright (C) 1999-2006 Authors
 */
import {
  C_,
  DocumentUndo,
  LayerMode,
  type Node,
  SPGroup,
  SPItem,
  type SPObject,
  SPRoot,
} from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';

const ICON = 'dialog-xml-editor';
const CTX = 'Undo/XML Editor';

/** A visible row of the node tree. */
export interface XmlTreeRow {
  node: Node;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** Flat list of the rows below root (root included), in display order; only children of expanded nodes are listed. */
export function xmlTreeRows(root: Node, expanded: ReadonlySet<Node>): XmlTreeRow[] {
  const rows: XmlTreeRow[] = [];
  const walk = (node: Node, depth: number) => {
    const hasChildren = node.childCount() > 0;
    const isExpanded = hasChildren && expanded.has(node);
    rows.push({ node, depth, hasChildren, expanded: isExpanded });
    if (!isExpanded) return;
    for (let c = node.firstChild(); c; c = c.next()) walk(c, depth + 1);
  };
  walk(root, 0);
  return rows;
}

/** The text shown for a node in the tree. */
export function xmlNodeLabel(node: Node): string {
  switch (node.type()) {
    case 'element': {
      const id = node.attribute('id');
      return id ? `${node.name()} id="${id}"` : node.name();
    }
    case 'text':
      return `"${(node.content() ?? '').replace(/\s+/g, ' ').trim()}"`;
    case 'comment':
      return `<!--${(node.content() ?? '').replace(/\s+/g, ' ').trim()}-->`;
    case 'pi':
      return `<?${node.name()}?>`;
    default:
      return node.name();
  }
}

/** Ancestors of node, nearest first (to expand a node in the tree). */
export function xmlAncestors(node: Node): Node[] {
  const list: Node[] = [];
  for (let p = node.parent(); p; p = p.parent()) list.push(p);
  return list;
}

/** Whether object has a bounding box in desktop coordinates, which excludes defs content (upstream XmlTree::in_dt_coordsys). */
function inDtCoordsys(object: SPObject): boolean {
  let child: SPObject = object;
  while (child instanceof SPItem) {
    const parent = child.parent;
    if (!parent) return child instanceof SPRoot && child !== object;
    child = parent;
  }
  return false;
}

/**
 * Select the object of repr on the canvas (upstream XmlTree::set_dt_select):
 * a layer becomes the current layer, any other item is selected. Non-element
 * nodes use their parent element.
 */
export function setDtSelect(desktop: SPDesktop, repr: Node | null): void {
  let node = repr;
  while (node && node.type() !== 'element' && node.parent()) node = node.parent();
  const object = node ? desktop.doc.getObjectByRepr(node) : null;
  if (!object || !inDtCoordsys(object)) return;
  if (object instanceof SPGroup && object.layerMode() === LayerMode.LAYER) {
    desktop.layerManager().setCurrentLayer(object);
  } else if (object instanceof SPItem) {
    if (object.parent instanceof SPGroup) desktop.layerManager().setCurrentLayer(object.parent);
    desktop.getSelection().set(object);
  }
}

// The commands return the node to select afterwards, or null if nothing was done.
// They record one undo step each, with the msgids of upstream.

/** Create an element node as the last child of parent (upstream cmd_new_element_node). The name gets "svg:" if it has no namespace. */
export function cmdNewElementNode(desktop: SPDesktop, parent: Node, name: string): Node | null {
  const m = /^<?\s*(\w[\w:\-\d]*)/.exec(name);
  if (!m?.[1] || parent.type() !== 'element') return null;
  const full = m[1].includes(':') ? m[1] : `svg:${m[1]}`;
  const repr = desktop.doc.rdoc.createElement(full);
  parent.appendChild(repr);
  DocumentUndo.done(desktop.doc, C_(CTX, 'Create new element node'), ICON);
  return repr;
}

/** Create an empty text node in node (upstream cmd_new_text_node). */
export function cmdNewTextNode(desktop: SPDesktop, node: Node): Node | null {
  if (node.type() !== 'element') return null;
  const text = desktop.doc.rdoc.createTextNode('');
  node.appendChild(text);
  DocumentUndo.done(desktop.doc, C_(CTX, 'Create new text node'), ICON);
  return text;
}

export function cmdDuplicateNode(desktop: SPDesktop, node: Node): Node | null {
  const parent = node.parent();
  if (!parent) return null;
  const dup = node.duplicate(parent.document());
  parent.addChild(dup, node);
  DocumentUndo.done(desktop.doc, C_(CTX, 'Duplicate node'), ICON);
  return dup;
}

/** Delete node, but not the root (upstream cmd_delete_node). Returns the parent to select. */
export function cmdDeleteNode(desktop: SPDesktop, node: Node): Node | null {
  const parent = node.parent();
  if (!parent?.parent()) return null;
  parent.removeChild(node);
  DocumentUndo.done(desktop.doc, C_(CTX, 'Delete node'), ICON);
  return parent;
}

export function cmdRaiseNode(desktop: SPDesktop, node: Node): Node | null {
  const parent = node.parent();
  const prev = node.prev();
  if (!parent || !prev) return null;
  parent.changeOrder(node, prev.prev());
  DocumentUndo.done(desktop.doc, C_(CTX, 'Raise node'), ICON);
  return node;
}

export function cmdLowerNode(desktop: SPDesktop, node: Node): Node | null {
  const parent = node.parent();
  const next = node.next();
  if (!parent || !next) return null;
  parent.changeOrder(node, next);
  DocumentUndo.done(desktop.doc, C_(CTX, 'Lower node'), ICON);
  return node;
}

/** Make node the last child of its previous sibling, which must be an element (upstream cmd_indent_node). */
export function cmdIndentNode(desktop: SPDesktop, node: Node): Node | null {
  const parent = node.parent();
  const prev = node.prev();
  if (!parent || !prev || prev.type() !== 'element') return null;
  parent.removeChild(node);
  prev.addChild(node, prev.lastChild());
  DocumentUndo.done(desktop.doc, C_(CTX, 'Indent node'), ICON);
  return node;
}

/** Move node after its parent in the grandparent (upstream cmd_unindent_node). */
export function cmdUnindentNode(desktop: SPDesktop, node: Node): Node | null {
  const parent = node.parent();
  const grandparent = parent?.parent();
  if (!parent || !grandparent) return null;
  parent.removeChild(node);
  grandparent.addChild(node, parent);
  DocumentUndo.done(desktop.doc, C_(CTX, 'Unindent node'), ICON);
  return node;
}
