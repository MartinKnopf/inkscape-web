// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/selectorsdialog.cpp
// @vitest-environment happy-dom
import { SPDocument } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import {
  add_selector,
  delete_statement,
  is_valid_selector,
  objects_of_rule,
  parse_stylesheet,
  read_style_element,
  set_declarations,
  write_stylesheet,
} from './selectorsdialog.ts';

SPDocument.scheduleIdle = () => {};

const CSS = `/* the rules */
rect.a, circle { fill: #f00; stroke : blue }
@import url(x.css);
@media print { rect { fill: none } }
#r2 { }`;

const open = (style = '') => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${style}` +
      '<rect id="r1" class="a" width="5" height="5"/><rect id="r2" width="5" height="5"/><circle id="c" r="2"/></svg>',
  ) as SPDocument;
  doc.ensureUpToDate();
  return doc;
};

describe('style sheets', () => {
  it('parses rules and keeps at-rules whole', () => {
    expect(parse_stylesheet(CSS)).toEqual([
      {
        kind: 'rule',
        selectors: 'rect.a, circle',
        declarations: [
          { name: 'fill', value: '#f00' },
          { name: 'stroke', value: 'blue' },
        ],
      },
      { kind: 'other', text: '@import url(x.css);' },
      { kind: 'other', text: '@media print { rect { fill: none } }' },
      { kind: 'rule', selectors: '#r2', declarations: [] },
    ]);
  });

  it('writes the rules in a form that parses back to them', () => {
    const statements = parse_stylesheet(CSS);
    expect(parse_stylesheet(write_stylesheet(statements))).toEqual(statements);
    expect(write_stylesheet(statements.slice(0, 1))).toBe(
      'rect.a, circle {\n  fill: #f00;\n  stroke: blue;\n}',
    );
  });

  it('checks that a selector is valid', () => {
    expect(['rect', '.a, #b', 'g > rect[x]'].map(is_valid_selector)).toEqual([true, true, true]);
    expect(['', 'rect,', '#', 'a:hover'].map(is_valid_selector)).toEqual([false, false, false, false]);
  });
});

describe('the style element of the document', () => {
  it('adds a selector, creating the style element, and writes one undo step', () => {
    const doc = open();
    expect(add_selector(doc, 'rect.a')).toBe(true);
    expect(add_selector(doc, 'rect,')).toBe(false);
    const { statements, element } = read_style_element(doc);
    expect(element?.attribute('type')).toBe('text/css');
    expect(statements).toEqual([{ kind: 'rule', selectors: 'rect.a', declarations: [] }]);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Edited style element.']);
  });

  it('edits and deletes rules, and finds the objects of a rule', () => {
    const doc = open('<style>rect { fill: #f00 }\ncircle { }</style>');
    set_declarations(doc, 0, [{ name: 'stroke', value: 'blue' }]);
    expect(read_style_element(doc).statements[0]).toEqual({
      kind: 'rule',
      selectors: 'rect',
      declarations: [{ name: 'stroke', value: 'blue' }],
    });
    const [rect, circle] = read_style_element(doc).statements;
    expect(objects_of_rule(doc, rect as never).map((o) => o.getId())).toEqual(['r1', 'r2']);
    expect(objects_of_rule(doc, circle as never).map((o) => o.getId())).toEqual(['c']);
    delete_statement(doc, 0);
    expect(read_style_element(doc).statements.map((s) => s.kind === 'rule' && s.selectors)).toEqual([
      'circle',
    ]);
  });
});
