// Upstream: src/xml/repr-io.cpp
// Spike: uses the browser DOMParser. The real core must parse without a DOM
// (to run in Node tests and workers), e.g. with a small SAX parser.
import { XmlNode } from './node';

export function parseSvg(text: string): XmlNode {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return convert(doc.documentElement);
}

function convert(el: Element): XmlNode {
  const node = new XmlNode('element', el.localName, el.namespaceURI);
  for (const a of el.attributes) node.setAttribute(a.name, a.value);
  let prev: XmlNode | null = null;
  for (const c of el.childNodes) {
    let child: XmlNode | null = null;
    if (c.nodeType === Node.ELEMENT_NODE) child = convert(c as Element);
    else if (c.nodeType === Node.TEXT_NODE || c.nodeType === Node.CDATA_SECTION_NODE) {
      child = new XmlNode('text', '#text', null);
      child.content = c.nodeValue ?? '';
    }
    if (child) {
      node.addChild(child, prev);
      prev = child;
    }
  }
  return node;
}
