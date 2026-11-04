// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/3rdparty/libcroco/cr-sel-eng.c, src/3rdparty/libcroco/cr-selector.c, src/xml/croco-node-iface.cpp
/*
 * Matching CSS selectors against XML nodes (the part of libcroco that SPDocument::getObjectsBySelector
 * and the Selectors dialog use): type, universal, #id, .class, [attribute] selectors with = ~= |= ^= $= *=,
 * :first-child, and the descendant, child and adjacent sibling combinators, in comma separated lists.
 */
import type { Node } from './node.ts';

type Combinator = ' ' | '>' | '+';

interface AttrTest {
  name: string;
  op: string;
  value: string;
}

/** A compound selector, like "rect.a#b[x=1]". */
interface Compound {
  /** The element name without prefix, or null for any. */
  type: string | null;
  id: string | null;
  classes: string[];
  attrs: AttrTest[];
  firstChild: boolean;
  /** How this compound relates to the one before it. */
  combinator: Combinator;
}

/** A selector: compounds from left to right. */
export type CssSelector = Compound[];

const IDENT = /^-?[_a-zA-Z -￿][-_a-zA-Z0-9 -￿]*/;

/** Parse a comma separated list of selectors; selectors that are not supported are left out. */
export function parseSelectorList(text: string): CssSelector[] {
  const out: CssSelector[] = [];
  for (const part of splitTopLevel(text)) {
    const s = parseSelector(part.trim());
    if (s) out.push(s);
  }
  return out;
}

/** Split at commas that are not inside brackets or quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function parseSelector(text: string): CssSelector | null {
  if (!text) return null;
  const compounds: Compound[] = [];
  let i = 0;
  let combinator: Combinator = ' ';
  while (i < text.length) {
    const c: Compound = { type: null, id: null, classes: [], attrs: [], firstChild: false, combinator };
    let any = false;
    if (text[i] === '*') {
      i++;
      any = true;
    } else {
      const m = IDENT.exec(text.slice(i));
      if (m) {
        c.type = m[0];
        i += m[0].length;
        any = true;
      }
    }
    for (;;) {
      const ch = text[i];
      if (ch === '#' || ch === '.') {
        const m = IDENT.exec(text.slice(i + 1));
        if (!m) return null;
        if (ch === '#') c.id = m[0];
        else c.classes.push(m[0]);
        i += 1 + m[0].length;
      } else if (ch === '[') {
        const end = text.indexOf(']', i);
        if (end < 0) return null;
        const m = /^\s*([^\s~|^$*=\]]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?\s*$/.exec(
          text.slice(i + 1, end),
        );
        if (!m) return null;
        c.attrs.push({ name: m[1] as string, op: m[2] ?? '', value: m[3] ?? m[4] ?? m[5] ?? '' });
        i = end + 1;
      } else if (ch === ':') {
        if (text.startsWith(':first-child', i)) {
          c.firstChild = true;
          i += ':first-child'.length;
        } else return null; // other pseudo classes are not supported
      } else break;
      any = true;
    }
    if (!any) return null;
    compounds.push(c);
    // The combinator before the next compound.
    const rest = /^\s*([>+])?\s*/.exec(text.slice(i)) as RegExpExecArray;
    i += rest[0].length;
    combinator = (rest[1] as Combinator | undefined) ?? (rest[0].length ? ' ' : ' ');
    if (i < text.length && !rest[0].length) return null;
  }
  return compounds.length ? compounds : null;
}

const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

function matchesCompound(c: Compound, node: Node): boolean {
  if (node.type() !== 'element') return false;
  if (c.type !== null && localName(node.name()) !== c.type) return false;
  if (c.id !== null && node.attribute('id') !== c.id) return false;
  if (c.classes.length) {
    const have = (node.attribute('class') ?? '').split(/\s+/);
    if (!c.classes.every((k) => have.includes(k))) return false;
  }
  for (const a of c.attrs) {
    const v = node.attribute(a.name);
    if (v === null) return false;
    switch (a.op) {
      case '':
        break;
      case '=':
        if (v !== a.value) return false;
        break;
      case '~=':
        if (!v.split(/\s+/).includes(a.value)) return false;
        break;
      case '|=':
        if (v !== a.value && !v.startsWith(`${a.value}-`)) return false;
        break;
      case '^=':
        if (!a.value || !v.startsWith(a.value)) return false;
        break;
      case '$=':
        if (!a.value || !v.endsWith(a.value)) return false;
        break;
      case '*=':
        if (!a.value || !v.includes(a.value)) return false;
        break;
    }
  }
  if (c.firstChild) {
    let prev = node.prev();
    while (prev && prev.type() !== 'element') prev = prev.prev();
    if (prev) return false;
  }
  return true;
}

/** Whether the selector matches the node (the last compound is the subject). */
export function selectorMatches(selector: CssSelector, node: Node, index = selector.length - 1): boolean {
  const c = selector[index];
  if (!c || !matchesCompound(c, node)) return false;
  if (index === 0) return true;
  switch (c.combinator) {
    case '>': {
      const p = node.parent();
      return !!p && selectorMatches(selector, p, index - 1);
    }
    case '+': {
      let prev = node.prev();
      while (prev && prev.type() !== 'element') prev = prev.prev();
      return !!prev && selectorMatches(selector, prev, index - 1);
    }
    default:
      for (let p = node.parent(); p; p = p.parent()) if (selectorMatches(selector, p, index - 1)) return true;
      return false;
  }
}

/** Whether any selector of the list matches the node. */
export function selectorListMatches(selectors: readonly CssSelector[], node: Node): boolean {
  return selectors.some((s) => selectorMatches(s, node));
}
