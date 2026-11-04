// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/selectorsdialog.cpp, src/ui/dialog/selectorsdialog.h
/*
 * A dialog for CSS selectors.
 *
 * Authors:
 *   Kamalpreet Kaur Grewal
 *   Tavmjong Bah
 *   Martin Owens
 *
 * Copyright (C) Kamalpreet Kaur Grewal 2016
 * Copyright (C) Tavmjong Bah 2017
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  C_,
  DocumentUndo,
  type Node,
  parseSelectorList,
  type SPDocument,
  type SPObject,
} from '@inkscape-web/core';

/** A statement of a style sheet. */
export type CssStatement =
  /** A rule: its selectors (a comma separated list) and the declarations between the braces. */
  | { kind: 'rule'; selectors: string; declarations: CssDeclaration[] }
  /** Any other statement (an at-rule): kept as it is. */
  | { kind: 'other'; text: string };

/** A property of a rule. */
export interface CssDeclaration {
  name: string;
  value: string;
}

/** Remove the comments of a style sheet. */
const strip_comments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the body of a rule, "name: value; ...". */
export function parse_declarations(body: string): CssDeclaration[] {
  const out: CssDeclaration[] = [];
  for (const part of strip_comments(body).split(';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const name = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (name) out.push({ name, value });
  }
  return out;
}

/** Parse the text of a style element into rules and other statements (at-rules with blocks stay whole). */
export function parse_stylesheet(css: string): CssStatement[] {
  const text = strip_comments(css);
  const out: CssStatement[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    const semicolon = text.indexOf(';', i);
    const head_end = open < 0 ? text.length : open;
    if (semicolon >= 0 && semicolon < head_end && text.slice(i, semicolon).trimStart().startsWith('@')) {
      // An at-rule without a block, like @import.
      out.push({ kind: 'other', text: text.slice(i, semicolon + 1).trim() });
      i = semicolon + 1;
      continue;
    }
    if (open < 0) break;
    // The block ends at the brace that closes the first one.
    let depth = 0;
    let end = open;
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++;
      else if (text[end] === '}' && --depth === 0) break;
    }
    const head = text.slice(i, open).trim();
    const body = text.slice(open + 1, end);
    if (head.startsWith('@')) out.push({ kind: 'other', text: `${head} {${body}}` });
    else if (head)
      out.push({
        kind: 'rule',
        selectors: head.replace(/\s+/g, ' '),
        declarations: parse_declarations(body),
      });
    i = end + 1;
  }
  return out;
}

/** The text of the style sheet (upstream _writeStyleElement). */
export function write_stylesheet(statements: readonly CssStatement[]): string {
  return statements
    .map((s) =>
      s.kind === 'other'
        ? s.text
        : `${s.selectors} {${s.declarations.map((d) => `\n  ${d.name}: ${d.value};`).join('')}\n}`,
    )
    .join('\n');
}

/** Whether the text is a list of CSS selectors that can be matched ("Invalid CSS selector." otherwise). */
export function is_valid_selector(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const parts = trimmed.split(',').map((p) => p.trim());
  return !parts.some((p) => !p) && parseSelectorList(trimmed).length === parts.length;
}

/** The style elements of the document, in document order. */
export function style_elements(doc: SPDocument): Node[] {
  const found: Node[] = [];
  const visit = (node: Node) => {
    if (node.name() === 'svg:style') found.push(node);
    for (const child of node.children()) visit(child);
  };
  visit(doc.getReprRoot());
  return found;
}

/** The text of the style element (its text nodes). */
const element_text = (style: Node): string =>
  [...style.children()]
    .filter((c) => c.type() === 'text')
    .map((c) => c.content() ?? '')
    .join('');

/**
 * The statements of the style sheet of the document: those of all style elements; and the first
 * style element, where changes go (upstream _readStyleElement uses the first one).
 */
export function read_style_element(doc: SPDocument): { statements: CssStatement[]; element: Node | null } {
  const [element] = style_elements(doc);
  return { statements: element ? parse_stylesheet(element_text(element)) : [], element: element ?? null };
}

/** Write the statements to the first style element, which is created at the top of the document if needed. */
export function write_style_element(doc: SPDocument, statements: readonly CssStatement[]): void {
  let { element } = read_style_element(doc);
  const text = write_stylesheet(statements);
  if (!element) {
    element = doc.getReprDoc().createElement('svg:style');
    element.setAttribute('type', 'text/css');
    doc.getReprRoot().addChild(element, null);
  }
  const existing = [...element.children()].find((c) => c.type() === 'text');
  if (existing) existing.setContent(text);
  else element.appendChild(doc.getReprDoc().createTextNode(text));
  DocumentUndo.done(doc, C_('Undo', 'Edited style element.'), 'dialog-selectors');
}

/** Add a rule with the selector (upstream _addSelector); false if the selector is not valid. */
export function add_selector(doc: SPDocument, selector: string): boolean {
  if (!is_valid_selector(selector)) return false;
  const { statements } = read_style_element(doc);
  write_style_element(doc, [...statements, { kind: 'rule', selectors: selector.trim(), declarations: [] }]);
  return true;
}

/** Remove the statement at index (upstream _delSelector). */
export function delete_statement(doc: SPDocument, index: number): void {
  const { statements } = read_style_element(doc);
  if (index < 0 || index >= statements.length) return;
  write_style_element(
    doc,
    statements.filter((_s, i) => i !== index),
  );
}

/** Replace the declarations of the rule at index. */
export function set_declarations(
  doc: SPDocument,
  index: number,
  declarations: readonly CssDeclaration[],
): void {
  const { statements } = read_style_element(doc);
  const rule = statements[index];
  if (rule?.kind !== 'rule') return;
  write_style_element(
    doc,
    statements.map((s, i) => (i === index ? { ...rule, declarations: [...declarations] } : s)),
  );
}

/** The objects that the rule matches, in document order (upstream: the children of a selector row). */
export function objects_of_rule(doc: SPDocument, statement: CssStatement): SPObject[] {
  return statement.kind === 'rule' ? doc.getObjectsBySelector(statement.selectors) : [];
}
