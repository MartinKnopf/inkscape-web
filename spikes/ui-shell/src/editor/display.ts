// Upstream: src/display/drawing*.cpp (role only)
// Spike: mirror the repr tree into a live SVG DOM. One observer per node keeps
// the DOM in sync, so edits, undo and redo update the drawing incrementally.
import type { XmlNode, NodeObserver } from '../core/xml/node';

const NS: Record<string, string> = {
  xlink: 'http://www.w3.org/1999/xlink',
  xml: 'http://www.w3.org/XML/1998/namespace',
};

export class DisplayMirror implements NodeObserver {
  private readonly dom = new Map<XmlNode, Node>();
  /** DOM element → repr node, for hit testing. */
  readonly reprOf = new WeakMap<Node, XmlNode>();
  readonly rootElement: SVGSVGElement;

  constructor(root: XmlNode) {
    this.rootElement = this.build(root) as SVGSVGElement;
  }

  domOf(node: XmlNode): Node | undefined {
    return this.dom.get(node);
  }

  private build(node: XmlNode): Node {
    let out: Node;
    if (node.type === 'text') {
      out = document.createTextNode(node.content);
    } else {
      const el = document.createElementNS(node.namespace ?? 'http://www.w3.org/2000/svg', node.name);
      for (const [k, v] of node.attributeList()) setAttr(el, k, v);
      for (const c of node.children) el.appendChild(this.build(c));
      out = el;
    }
    this.dom.set(node, out);
    this.reprOf.set(out, node);
    node.addObserver(this);
    return out;
  }

  private drop(node: XmlNode): void {
    node.removeObserver(this);
    this.dom.delete(node);
    for (const c of node.children) this.drop(c);
  }

  notifyChildAdded(node: XmlNode, child: XmlNode, prev: XmlNode | null): void {
    const parent = this.dom.get(node)!;
    const before = prev ? this.dom.get(prev)!.nextSibling : parent.firstChild;
    parent.insertBefore(this.build(child), before);
  }

  notifyChildRemoved(_node: XmlNode, child: XmlNode): void {
    (this.dom.get(child) as ChildNode).remove();
    this.drop(child);
  }

  notifyAttributeChanged(node: XmlNode, name: string, _old: string | null, value: string | null): void {
    const el = this.dom.get(node) as Element;
    if (value === null) el.removeAttribute(name);
    else setAttr(el, name, value);
  }

  notifyContentChanged(node: XmlNode, _old: string, value: string): void {
    this.dom.get(node)!.nodeValue = value;
  }
}

function setAttr(el: Element, name: string, value: string): void {
  const i = name.indexOf(':');
  const ns = i > 0 ? NS[name.slice(0, i)] : undefined;
  try {
    if (ns) el.setAttributeNS(ns, name, value);
    else el.setAttribute(name, value);
  } catch {
    // Attributes with unknown prefixes (sodipodi:, inkscape:) are not needed for display.
  }
}
