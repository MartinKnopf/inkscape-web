// SPDX-License-Identifier: LGPL-2.1-only
// Upstream: src/3rdparty/libcroco/src/cr-stylesheet.c, src/3rdparty/libcroco/src/cr-parser.c, src/3rdparty/libcroco/src/cr-sel-eng.c, src/3rdparty/libcroco/src/cr-cascade.c
/*
 * This file is part of The Croco Library
 *
 * Copyright (C) 2002-2004 Dodji Seketeli
 */
import {
  type CssSelector,
  parseSelectorList,
  selectorMatches,
  selectorSpecificity,
} from '../../xml/css-selector.ts';
import type { Node } from '../../xml/node.ts';
import { type CRDeclaration, parseDeclarationList } from './cr-declaration.ts';

/** A ruleset statement: selectors and declarations (libcroco CRStatement of type RULESET_STMT). */
export interface CRRuleset {
  /** The selector list as written. */
  selectorText: string;
  /** The selectors that are supported (see css-selector.ts). */
  selectors: CssSelector[];
  declarations: CRDeclaration[];
}

/** A style sheet: its rulesets in order (libcroco CRStyleSheet). At-rules are not kept. */
export interface CRStyleSheet {
  statements: CRRuleset[];
}

/** Parse the text of a style sheet (cr_parser_parse_buf with the SAC handlers of sp-style-elem.cpp). */
export function cr_stylesheet_parse(text: string): CRStyleSheet {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const statements: CRRuleset[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    const semicolon = css.indexOf(';', i);
    const head_end = open < 0 ? css.length : open;
    if (semicolon >= 0 && semicolon < head_end && css.slice(i, semicolon).trimStart().startsWith('@')) {
      // An at-rule without a block (@import, @charset): not supported.
      i = semicolon + 1;
      continue;
    }
    if (open < 0) break;
    // The block ends at the brace that closes the first one.
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    const head = css.slice(i, open).trim();
    const body = css.slice(open + 1, end);
    i = end + 1;
    // @media, @font-face, ... blocks are not applied.
    if (!head || head.startsWith('@')) continue;
    statements.push({
      selectorText: head.replace(/\s+/g, ' '),
      selectors: parseSelectorList(head),
      declarations: parseDeclarationList(body),
    });
  }
  return { statements };
}

/**
 * The declarations of the sheets that apply to node, one per property: the one of the most
 * specific selector, the later one for equal specificity, !important before the others
 * (cr_sel_eng_get_matched_properties_from_cascade with put_css_properties_in_props_list).
 */
export function cr_sel_eng_get_matched_properties(
  sheets: readonly CRStyleSheet[],
  node: Node,
): CRDeclaration[] {
  const props = new Map<string, { decl: CRDeclaration; specificity: number }>();
  for (const sheet of sheets) {
    for (const rule of sheet.statements) {
      let specificity = -1;
      for (const sel of rule.selectors) {
        if (selectorMatches(sel, node)) specificity = Math.max(specificity, selectorSpecificity(sel));
      }
      if (specificity < 0) continue;
      for (const decl of rule.declarations) {
        const old = props.get(decl.property);
        if (
          !old ||
          (decl.important && !old.decl.important) ||
          (decl.important === old.decl.important && specificity >= old.specificity)
        ) {
          props.set(decl.property, { decl, specificity });
        }
      }
    }
  }
  return [...props.values()].map((p) => p.decl);
}
