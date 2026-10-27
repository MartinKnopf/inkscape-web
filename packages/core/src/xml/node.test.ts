// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { XmlDocument } from './document.ts';
import type { Node } from './node.ts';
import type { NodeObserver } from './node-observer.ts';

/** Records observer calls as short strings. */
function recorder(calls: string[]): NodeObserver {
  const n = (node: Node | null) => (node ? (node.attribute('id') ?? node.name()) : 'null');
  return {
    notifyChildAdded: (node, child, prev) => calls.push(`add ${n(node)} ${n(child)} after ${n(prev)}`),
    notifyChildRemoved: (node, child, prev) => calls.push(`del ${n(node)} ${n(child)} after ${n(prev)}`),
    notifyChildOrderChanged: (node, child, oldPrev, newPrev) =>
      calls.push(`order ${n(node)} ${n(child)} ${n(oldPrev)}→${n(newPrev)}`),
    notifyContentChanged: (node, oldContent, newContent) =>
      calls.push(`content ${n(node)} ${oldContent}→${newContent}`),
    notifyAttributeChanged: (node, key, oldValue, newValue) =>
      calls.push(`attr ${n(node)} ${key} ${oldValue}→${newValue}`),
    notifyElementNameChanged: (_node, oldName, newName) => calls.push(`name ${oldName}→${newName}`),
  };
}

function tree() {
  const doc = new XmlDocument();
  const root = doc.createElement('svg:svg');
  doc.appendChild(root);
  const [a, b, c] = ['a', 'b', 'c'].map((id) => {
    const el = doc.createElement('svg:rect');
    el.setAttribute('id', id);
    root.appendChild(el);
    return el;
  }) as [Node, Node, Node];
  return { doc, root, a, b, c };
}

const ids = (parent: Node) => [...parent.children()].map((c) => c.attribute('id'));

describe('Node', () => {
  it('links children in order', () => {
    const { root, a, b, c } = tree();
    expect(ids(root)).toEqual(['a', 'b', 'c']);
    expect(root.firstChild()).toBe(a);
    expect(root.lastChild()).toBe(c);
    expect(b.prev()).toBe(a);
    expect(b.next()).toBe(c);
    expect(c.position()).toBe(2);
    expect(root.nthChild(1)).toBe(b);
    expect(root.childCount()).toBe(3);
  });

  it('adds after a reference node, or first when the reference is null', () => {
    const { doc, root, a } = tree();
    const x = doc.createElement('svg:g');
    x.setAttribute('id', 'x');
    root.addChild(x, a);
    const y = doc.createElement('svg:g');
    y.setAttribute('id', 'y');
    root.addChild(y, null);
    expect(ids(root)).toEqual(['y', 'a', 'x', 'b', 'c']);
  });

  it('changes order and position', () => {
    const { root, a, c } = tree();
    root.changeOrder(a, c);
    expect(ids(root)).toEqual(['b', 'c', 'a']);
    c.setPosition(0);
    expect(ids(root)).toEqual(['c', 'b', 'a']);
    c.setPosition(-1);
    expect(ids(root)).toEqual(['b', 'a', 'c']);
  });

  it('removes attributes with null and keeps insertion order', () => {
    const { a } = tree();
    a.setAttribute('width', '10');
    a.setAttribute('height', '5');
    a.setAttribute('width', '20');
    expect(a.attributeList().map(([k, v]) => `${k}=${v}`)).toEqual(['id=a', 'width=20', 'height=5']);
    a.setAttribute('width', null);
    expect(a.attribute('width')).toBeNull();
    expect(a.attributeList()).toHaveLength(2);
  });

  it('notifies observers only on real changes', () => {
    const { root, a, b } = tree();
    const calls: string[] = [];
    a.addObserver(recorder(calls));
    root.addObserver(recorder(calls));
    a.setAttribute('x', '1');
    a.setAttribute('x', '1');
    a.removeAttribute('nothing');
    root.removeChild(b);
    root.changeOrder(a, a.prev());
    expect(calls).toEqual(['attr a x null→1', 'del svg:svg b after a']);
  });

  it('notifies subtree observers for changes below the node', () => {
    const { root, a } = tree();
    const calls: string[] = [];
    root.addSubtreeObserver(recorder(calls));
    a.setAttribute('x', '1');
    a.setCodeUnsafe('svg:circle');
    expect(calls).toEqual(['attr a x null→1', 'name svg:rect→svg:circle']);
  });

  it('duplicates a subtree into another document', () => {
    const { a } = tree();
    a.appendChild(a.document().createTextNode('hi'));
    const other = new XmlDocument();
    const copy = a.duplicate(other);
    expect(copy.document()).toBe(other);
    expect(copy.parent()).toBeNull();
    expect(copy.attribute('id')).toBe('a');
    expect(copy.firstChild()?.content()).toBe('hi');
  });

  it('returns the root element', () => {
    const { doc, root, b } = tree();
    expect(b.root()).toBe(root);
    expect(doc.root()).toBe(root);
  });
});
