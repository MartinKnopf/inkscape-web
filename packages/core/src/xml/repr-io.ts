// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/xml/repr-io.cpp
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 */
import { SaxesParser } from 'saxes';
import { XmlDocument } from './document.ts';
import type { Node } from './node.ts';
import { nsPrefixUri, nsUriPrefix, qnameLocalName, qnamePrefix } from './repr-util.ts';

const XMLNS_NS_URI = 'http://www.w3.org/2000/xmlns/';

/**
 * Parse XML into a repr document (upstream sp_repr_read_mem). Names get the
 * normalized namespace prefixes of repr-util.ts. If defaultNs is the SVG
 * namespace, elements of a document without namespaces are moved into it.
 * Returns null for malformed XML.
 */
export function readMem(text: string, defaultNs: string | null): XmlDocument | null {
  const doc = new XmlDocument();
  const parser = new SaxesParser({ xmlns: true });
  /** Open elements, with their xml:space="preserve" state. */
  const stack: { node: Node; preserve: boolean }[] = [];
  let rootCount = 0;
  const append = (node: Node) => (stack.at(-1)?.node ?? doc).appendChild(node);
  const qualified = (uri: string, prefix: string, local: string) =>
    uri ? `${nsUriPrefix(uri, prefix || null)}:${local}` : local;

  parser.on('doctype', (doctype) => {
    // Internal entities, as libxml2 XML_PARSE_NOENT does.
    for (const m of doctype.matchAll(/<!ENTITY\s+([^\s%]+)\s+(["'])([\s\S]*?)\2\s*>/g)) {
      parser.ENTITIES[m[1]!] = m[3]!;
    }
  });
  parser.on('opentag', (tag) => {
    const node = doc.createElement(qualified(tag.uri, tag.prefix, tag.local));
    for (const a of Object.values(tag.attributes)) {
      // Namespace declarations are not attributes; the writer adds them again.
      // An empty value has no content node in libxml2, and upstream skips it.
      if (a.uri === XMLNS_NS_URI || a.name === 'xmlns' || a.value === '') continue;
      node.setAttribute(qualified(a.uri, a.prefix, a.local), a.value);
    }
    if (!stack.length) rootCount++;
    append(node);
    const space = node.attribute('xml:space');
    stack.push({ node, preserve: space ? space === 'preserve' : (stack.at(-1)?.preserve ?? false) });
  });
  parser.on('closetag', () => stack.pop());
  parser.on('text', (text) => {
    const top = stack.at(-1);
    // Whitespace-only text is dropped unless xml:space="preserve".
    if (top && text && (top.preserve || /\S/.test(text))) append(doc.createTextNode(text));
  });
  parser.on('cdata', (text) => {
    if (stack.length && text) append(doc.createTextNode(text, true));
  });
  parser.on('comment', (text) => append(doc.createComment(text)));
  parser.on('processinginstruction', ({ target, body }) => append(doc.createPI(target, body)));

  try {
    parser.write(text).close();
  } catch {
    return null;
  }
  const root = doc.root();
  if (!root || rootCount !== 1) return null;
  if (defaultNs && !root.name().includes(':') && nsUriPrefix(defaultNs, null) === 'svg') {
    promoteToNamespace(root, 'svg');
  }
  return doc;
}

function promoteToNamespace(repr: Node, prefix: string): void {
  if (repr.type() !== 'element') return;
  if (!qnamePrefix(repr.name())) repr.setCodeUnsafe(`${prefix}:${repr.name()}`);
  for (const c of repr.children()) promoteToNamespace(c, prefix);
}

/** Options of the writer (upstream preferences /options/svgoutput/inlineattrs and indent). */
export interface WriteOptions {
  inlineAttributes?: boolean;
  indent?: number;
}

/**
 * Write a document as XML (upstream sp_repr_save_buf/sp_repr_save_writer).
 * Elements in defaultNs are written without prefix; namespace declarations
 * for all used prefixes are added to the root element.
 */
export function saveBuf(doc: XmlDocument, defaultNs: string | null, options: WriteOptions = {}): string {
  const w = new Writer(options);
  w.out += '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n';
  const doctype = doc.attribute('doctype');
  if (doctype) w.out += doctype;
  for (const repr of doc.children()) {
    if (repr.type() === 'element') {
      w.rootElement(repr, defaultNs);
    } else {
      w.node(repr, 0, true, null);
      if (repr.type() === 'comment') w.out += '\n';
    }
  }
  return w.out;
}

/** Write one node and its subtree, without whitespace and namespace declarations (upstream sp_repr_write_buf). */
export function writeBuf(repr: Node, options: WriteOptions = {}): string {
  const w = new Writer(options);
  w.node(repr, 0, false, null);
  return w.out;
}

/**
 * Upstream writes namespace declarations sorted by GQuark id, which is the
 * order in which the prefix strings were first used. In practice this order.
 */
const NS_DECLARATION_ORDER = ['inkscape', 'sodipodi', 'xlink', 'svg', 'rdf', 'cc', 'dc'];

class Writer {
  out = '';
  readonly #inline: boolean;
  readonly #indent: number;

  constructor({ inlineAttributes = false, indent = 2 }: WriteOptions) {
    this.#inline = inlineAttributes;
    this.#indent = indent;
  }

  rootElement(repr: Node, defaultNs: string | null): void {
    // Prefixes in use; null stands for names without prefix.
    const used = new Set<string | null>();
    const collect = (n: Node) => {
      if (n.type() !== 'element') return;
      used.add(qnamePrefix(n.name()));
      for (const [k] of n.attributeList()) {
        const p = qnamePrefix(k);
        if (p) used.add(p);
      }
      for (const c of n.children()) collect(c);
    };
    collect(repr);

    const elide = defaultNs && !used.has(null) ? nsUriPrefix(defaultNs, null) : null;
    const rank = (p: string) => {
      const i = NS_DECLARATION_ORDER.indexOf(p);
      return i < 0 ? NS_DECLARATION_ORDER.length : i;
    };
    const prefixes = [...used].filter((p): p is string => p !== null).sort((a, b) => rank(a) - rank(b));
    const attributes: [string, string][] = repr.attributeList().map(([k, v]) => [k, v]);
    for (const prefix of prefixes) {
      if (prefix === 'xml') continue;
      const uri = nsPrefixUri(prefix);
      if (!uri) {
        console.warn(`No namespace known for normalized prefix ${prefix}`);
        continue;
      }
      if (prefix === elide) attributes.push(['xmlns', uri]);
      attributes.push([`xmlns:${prefix}`, uri]);
    }
    this.element(repr, 0, true, elide, attributes);
  }

  node(repr: Node, level: number, whitespace: boolean, elide: string | null): void {
    switch (repr.type()) {
      case 'text':
        this.out += repr.isCData() ? `<![CDATA[${repr.content()}]]>` : quote(repr.content() ?? '', false);
        break;
      case 'comment':
        this.#indentTo(whitespace ? level : 0);
        this.out += `<!--${repr.content()}-->`;
        if (whitespace) this.out += '\n';
        break;
      case 'pi':
        this.out += `<?${repr.name()} ${repr.content()}?>`;
        break;
      case 'element':
        this.element(repr, level, whitespace, elide, repr.attributeList());
        break;
      case 'document':
        throw new Error('cannot write a document node as a child');
    }
  }

  element(
    repr: Node,
    level: number,
    whitespace: boolean,
    elide: string | null,
    attributes: readonly (readonly [string, string])[],
  ): void {
    const parentWhitespace = whitespace;
    level = Math.min(level, 16);
    if (whitespace) this.#indentTo(level);
    const qname = repr.name();
    const name = elide !== null && qnamePrefix(qname) === elide ? qnameLocalName(qname) : qname;
    this.out += `<${name}`;

    if (qname === 'svg:text' || qname === 'svg:flowRoot') {
      whitespace = false;
    } else {
      const space = repr.attribute('xml:space');
      if (space === 'preserve') whitespace = false;
      else if (space === 'default') whitespace = true;
    }

    for (const [k, v] of attributes) {
      if (!this.#inline) {
        this.out += '\n';
        this.#indentTo(level + 1);
      }
      this.out += ` ${k}="${quote(v, true)}"`;
    }

    // "Loose" elements have no text children; their children go on separate lines.
    const loose = ![...repr.children()].some((c) => c.type() === 'text');
    if (repr.firstChild()) {
      this.out += '>';
      if (loose && whitespace) this.out += '\n';
      for (const c of repr.children()) this.node(c, loose ? level + 1 : 0, whitespace, elide);
      if (loose && whitespace) this.#indentTo(level);
      this.out += `</${name}>`;
    } else {
      this.out += ' />';
    }
    if (parentWhitespace) this.out += '\n';
  }

  #indentTo(level: number): void {
    this.out += ' '.repeat(Math.min(level, 16) * this.#indent);
  }
}

const ESCAPES: Record<string, string> = { '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' };

function quote(value: string, attribute: boolean): string {
  return value.replace(/["&<>\n]/g, (c) => ESCAPES[c] ?? (attribute ? '&#10;' : '\n'));
}
