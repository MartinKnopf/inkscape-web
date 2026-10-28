// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/xml/node.h, src/xml/simple-node.cpp, src/xml/simple-node.h, src/xml/element-node.h, src/xml/text-node.h, src/xml/comment-node.h, src/xml/pi-node.h
/*
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *   bulia byak <buliabyak@users.sf.net>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright 2003-2008 Authors
 */

import { Point } from '@inkscape-web/geom';
import { svgNumber } from '../svg/stringstream.ts';
import type { SVGLength } from '../svg/svg-length.ts';
import type { XmlDocument } from './document.ts';
import type { NodeObserver } from './node-observer.ts';

export type NodeType = 'document' | 'element' | 'text' | 'comment' | 'pi';

/**
 * A node of the XML repr tree (upstream Inkscape::XML::SimpleNode).
 *
 * Element and attribute names carry the normalized namespace prefix
 * ("svg:rect", "inkscape:label"), see repr-util.ts. Children form a linked
 * list. All changes notify the observers of the node, the subtree observers
 * of the node and its ancestors, and the document's transaction log.
 */
export class Node {
  #type: NodeType;
  #name: string;
  #content: string | null;
  #cdata: boolean;
  #document: XmlDocument;
  #attributes: [string, string][] = [];
  #parent: Node | null = null;
  #next: Node | null = null;
  #prev: Node | null = null;
  #firstChild: Node | null = null;
  #lastChild: Node | null = null;
  #childCount = 0;
  #observers: NodeObserver[] = [];
  #subtreeObservers: NodeObserver[] = [];

  /** Use the XmlDocument create* methods instead. */
  constructor(
    type: NodeType,
    name: string,
    content: string | null,
    document: XmlDocument | null,
    cdata = false,
  ) {
    this.#type = type;
    this.#name = name;
    this.#content = content;
    this.#cdata = cdata;
    this.#document = document ?? (this as unknown as XmlDocument);
  }

  type(): NodeType {
    return this.#type;
  }
  /** Qualified element name ("svg:rect"), PI target, or "string"/"comment"/"xml" for other nodes. */
  name(): string {
    return this.#name;
  }
  content(): string | null {
    return this.#content;
  }
  /** True for a text node that came from (and is written as) a CDATA section. */
  isCData(): boolean {
    return this.#cdata;
  }
  document(): XmlDocument {
    return this.#document;
  }

  parent(): Node | null {
    return this.#parent;
  }
  next(): Node | null {
    return this.#next;
  }
  prev(): Node | null {
    return this.#prev;
  }
  firstChild(): Node | null {
    return this.#firstChild;
  }
  lastChild(): Node | null {
    return this.#lastChild;
  }
  childCount(): number {
    return this.#childCount;
  }
  *children(): Generator<Node> {
    for (let c = this.#firstChild; c; c = c.#next) yield c;
  }
  nthChild(index: number): Node | null {
    let c = this.#firstChild;
    for (let i = 0; c && i < index; i++) c = c.#next;
    return c;
  }
  /** Index of this node among its siblings. */
  position(): number {
    let i = 0;
    for (let c = this.#prev; c; c = c.#prev) i++;
    return i;
  }

  /** The root element of the tree, or null if the top node is not an element or document. */
  root(): Node | null {
    let top: Node = this;
    while (top.#parent) top = top.#parent;
    if (top.#type === 'document') {
      for (const c of top.children()) if (c.#type === 'element') return c;
      return null;
    }
    return top.#type === 'element' ? top : null;
  }

  attribute(name: string): string | null {
    return this.#attributes.find(([k]) => k === name)?.[1] ?? null;
  }
  /** Attributes as [name, value] pairs, in insertion order. Do not modify. */
  attributeList(): readonly (readonly [string, string])[] {
    return this.#attributes;
  }
  /** Set an attribute, or remove it if value is null. */
  setAttribute(name: string, value: string | null): void {
    if (!name || /\s/.test(name)) throw new Error(`invalid attribute name "${name}"`);
    const index = this.#attributes.findIndex(([k]) => k === name);
    const old = index >= 0 ? this.#attributes[index]![1] : null;
    if (value === null) {
      if (index >= 0) this.#attributes.splice(index, 1);
    } else if (index >= 0) {
      this.#attributes[index]![1] = value;
    } else {
      this.#attributes.push([name, value]);
    }
    if (old !== value) this.#notify((o) => o.notifyAttributeChanged?.(this, name, old, value));
  }
  /** Set the attribute, or remove it if value is null or empty. */
  setAttributeOrRemoveIfEmpty(name: string, value: string | null): void {
    this.setAttribute(name, value ? value : null);
  }

  removeAttribute(name: string): void {
    this.setAttribute(name, null);
  }

  setAttributeBoolean(name: string, val: boolean): void {
    this.setAttribute(name, val ? 'true' : 'false');
  }
  setAttributeInt(name: string, val: number): void {
    this.setAttribute(name, String(Math.trunc(val)));
  }
  /** For attributes where an exponent is allowed; not for CSS properties. NaN is ignored. */
  setAttributeSvgDouble(name: string, val: number): void {
    if (Number.isNaN(val)) return;
    this.setAttribute(name, svgNumber(val));
  }
  /** Remove the attribute if val is the default, otherwise set it like setAttributeSvgDouble. */
  setAttributeSvgNonDefaultDouble(name: string, val: number, defaultValue: number): void {
    if (val === defaultValue) this.removeAttribute(name);
    else this.setAttributeSvgDouble(name, val);
  }
  setAttributeSvgLength(name: string, val: SVGLength): void {
    this.setAttribute(name, val.write());
  }
  /** Set the attribute to "x,y". */
  setAttributePoint(name: string, val: Point): void {
    this.setAttribute(name, `${svgNumber(val.x)},${svgNumber(val.y)}`);
  }
  /** The point of an "x,y" attribute, or defaultValue if it is missing or invalid. */
  getAttributePoint(name: string, defaultValue: Point = new Point(0, 0)): Point {
    const parts = this.attribute(name)?.split(',');
    if (parts?.length !== 2) return defaultValue;
    const x = Number.parseFloat(parts[0] ?? '');
    const y = Number.parseFloat(parts[1] ?? '');
    return Number.isNaN(x) || Number.isNaN(y) ? defaultValue : new Point(x, y);
  }

  setContent(content: string | null): void {
    const old = this.#content;
    this.#content = content;
    if (old !== content) this.#notify((o) => o.notifyContentChanged?.(this, old, content));
  }

  /** Rename the element. Unsafe because SPObjects do not follow the change. */
  setCodeUnsafe(name: string): void {
    const old = this.#name;
    this.#name = name;
    if (old !== name) this.#notify((o) => o.notifyElementNameChanged?.(this, old, name));
  }

  /** Insert child after ref, or as the first child if ref is null. */
  addChild(child: Node, ref: Node | null): void {
    if (child.#document !== this.#document) throw new Error('child belongs to another document');
    if (child.#parent) throw new Error('child already has a parent');
    if (ref && ref.#parent !== this) throw new Error('ref is not a child of this node');
    const next = ref ? ref.#next : this.#firstChild;
    child.#prev = ref;
    child.#next = next;
    if (ref) ref.#next = child;
    else this.#firstChild = child;
    if (next) next.#prev = child;
    else this.#lastChild = child;
    child.#parent = this;
    this.#childCount++;
    this.#notify((o) => o.notifyChildAdded?.(this, child, ref));
  }
  appendChild(child: Node): void {
    this.addChild(child, this.#lastChild);
  }

  /** Insert child so that it becomes the child at index pos. */
  addChildAtPos(child: Node, pos: number): void {
    this.addChild(child, pos > 0 ? this.nthChild(pos - 1) : null);
  }

  removeChild(child: Node): void {
    if (child.#parent !== this) throw new Error('not a child of this node');
    const ref = child.#prev;
    this.#unlink(child);
    child.#parent = null;
    this.#childCount--;
    this.#notify((o) => o.notifyChildRemoved?.(this, child, ref));
  }

  /** Move child after ref, or to the first position if ref is null. */
  changeOrder(child: Node, ref: Node | null): void {
    if (child.#parent !== this || child === ref || (ref && ref.#parent !== this)) {
      throw new Error('changeOrder: invalid child or ref');
    }
    const prev = child.#prev;
    if (prev === ref) return;
    this.#unlink(child);
    const next = ref ? ref.#next : this.#firstChild;
    child.#prev = ref;
    child.#next = next;
    if (ref) ref.#next = child;
    else this.#firstChild = child;
    if (next) next.#prev = child;
    else this.#lastChild = child;
    this.#notify((o) => o.notifyChildOrderChanged?.(this, child, prev, ref));
  }

  /** Move this node to index pos among its siblings. A negative pos means the end. */
  setPosition(pos: number): void {
    const parent = this.#parent;
    if (!parent) throw new Error('setPosition: node has no parent');
    if (pos < 0) pos = Number.POSITIVE_INFINITY;
    let ref: Node | null = null;
    for (let s = parent.#firstChild; s && pos; s = s.#next) {
      if (s !== this) {
        ref = s;
        pos--;
      }
    }
    parent.changeOrder(this, ref);
  }

  /** Deep copy of this node for doc. The copy has no parent. */
  duplicate(doc: XmlDocument): Node {
    const copy = new Node(this.#type, this.#name, this.#content, doc, this.#cdata);
    copy.#attributes = this.#attributes.map(([k, v]) => [k, v]);
    for (const c of this.children()) copy.appendChild(c.duplicate(doc));
    return copy;
  }

  /**
   * Merge the content, children and attributes of src into this node. A child of src with an
   * attribute `key` is merged into the child of this node with the same value of `key`.
   * TODO: the `extension` and `clean` options, the position of this node.
   */
  mergeFrom(src: Node, key: string): void {
    if (src === this) throw new Error('mergeFrom: src is this');
    this.setContent(src.content());
    for (const child of src.children()) {
      const id = child.attribute(key);
      if (id) {
        const existing = [...this.children()].find((c) => c.attribute(key) === id);
        if (existing) {
          existing.mergeFrom(child, key);
          continue;
        }
      }
      this.appendChild(child.duplicate(this.#document));
    }
    for (const [k, v] of src.attributeList()) this.setAttribute(k, v);
  }

  addObserver(observer: NodeObserver): void {
    this.#observers.push(observer);
  }
  removeObserver(observer: NodeObserver): void {
    const i = this.#observers.indexOf(observer);
    if (i >= 0) this.#observers.splice(i, 1);
  }
  /** Observe this node and all its descendants. */
  addSubtreeObserver(observer: NodeObserver): void {
    this.#subtreeObservers.push(observer);
  }
  removeSubtreeObserver(observer: NodeObserver): void {
    const i = this.#subtreeObservers.indexOf(observer);
    if (i >= 0) this.#subtreeObservers.splice(i, 1);
  }

  /** Send the current state to observer as if the node was built (attributes, children, content). */
  synthesizeEvents(observer: NodeObserver): void {
    for (const [k, v] of this.#attributes) observer.notifyAttributeChanged?.(this, k, null, v);
    let ref: Node | null = null;
    for (const c of this.children()) {
      observer.notifyChildAdded?.(this, c, ref);
      ref = c;
    }
    observer.notifyContentChanged?.(this, null, this.#content);
  }

  #unlink(child: Node): void {
    const { prev, next } = { prev: child.#prev, next: child.#next };
    if (prev) prev.#next = next;
    else this.#firstChild = next;
    if (next) next.#prev = prev;
    else this.#lastChild = prev;
    child.#prev = null;
    child.#next = null;
  }

  #notify(call: (o: NodeObserver) => void): void {
    call(this.#document.logger());
    // Copy: an observer may remove itself while it is called.
    for (const o of [...this.#observers]) call(o);
    for (let n: Node | null = this; n; n = n.#parent) for (const o of [...n.#subtreeObservers]) call(o);
  }
}
