// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/text-editing.cpp
import { describe, expect, it } from 'vitest';
import { SPDocument } from './document.ts';
import { SPText } from './object/sp-text.ts';
import {
  sp_te_delete,
  sp_te_get_string_multiline,
  sp_te_insert,
  sp_te_insert_line,
  sp_te_set_repr_text_multiline,
} from './text-editing.ts';
import type { Node } from './xml/node.ts';

SPDocument.scheduleIdle = () => {};

/** Compact XML of node, without the ids and the x/y that the layout writes. */
function compact(node: Node): string {
  if (node.type() === 'text') return node.content() ?? '';
  const name = node.name().replace('svg:', '');
  const attrs = node
    .attributeList()
    .filter(([k]) => !['id', 'x', 'y'].includes(k))
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  return `<${name}${attrs}>${[...node.children()].map(compact).join('')}</${name}>`;
}

function open(content: string) {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">' +
      `<text id="t" xml:space="preserve" x="0" y="10" style="font-size:10px">${content}</text></svg>`,
  );
  doc?.ensureUpToDate();
  const t = doc?.getObjectById('t');
  if (!doc || !(t instanceof SPText)) throw new Error('no text');
  const xml = () => [...t.getRepr().children()].map(compact).join('');
  return { doc, t, layout: t.layout, xml };
}

describe('text editing', () => {
  it('inserts into the string at the cursor', () => {
    const { t, layout, xml } = open('<tspan sodipodi:role="line">ad</tspan>');
    const it = sp_te_insert(t, layout.charIndexToIterator(1), 'bc');
    expect(it.charIndex()).toBe(3);
    expect(xml()).toBe('<tspan sodipodi:role="line">abcd</tspan>');
  });

  it('splits the line tspan at a new line and joins it again on delete', () => {
    const { t, layout, xml } = open('<tspan sodipodi:role="line">abcd</tspan>');
    const it = sp_te_insert_line(t, layout.charIndexToIterator(2));
    expect(it.charIndex()).toBe(3);
    expect(xml()).toBe('<tspan sodipodi:role="line">ab</tspan><tspan sodipodi:role="line">cd</tspan>');
    expect(sp_te_get_string_multiline(t)).toBe('ab\ncd');

    // Delete the line break (Backspace at the start of the second line).
    const r = sp_te_delete(t, layout.charIndexToIterator(2), layout.charIndexToIterator(3));
    expect(r.success).toBe(true);
    expect(r.first.charIndex()).toBe(2);
    expect(xml()).toBe('<tspan sodipodi:role="line">abcd</tspan>');
  });

  it('types into a new empty line at the end', () => {
    const { t, layout, xml } = open('<tspan sodipodi:role="line">ab</tspan>');
    let it = sp_te_insert_line(t, layout.end());
    expect(it.equals(layout.end())).toBe(true);
    it = sp_te_insert(t, it, 'c');
    expect(xml()).toBe('<tspan sodipodi:role="line">ab</tspan><tspan sodipodi:role="line">c</tspan>');
  });

  it('wraps plain text in a line tspan before breaking it', () => {
    const { t, layout, xml } = open('abc');
    sp_te_insert_line(t, layout.charIndexToIterator(1));
    expect(xml()).toBe('<tspan sodipodi:role="line">a</tspan><tspan sodipodi:role="line">bc</tspan>');
  });

  it('deletes across lines and removes the emptied spans', () => {
    const { t, layout, xml } = open(
      '<tspan sodipodi:role="line">ab</tspan><tspan sodipodi:role="line">cd</tspan><tspan sodipodi:role="line">ef</tspan>',
    );
    sp_te_delete(t, layout.charIndexToIterator(1), layout.charIndexToIterator(7));
    expect(xml()).toBe('<tspan sodipodi:role="line">af</tspan>');
  });

  it('sets the text from a string with new lines', () => {
    const { t, xml } = open('old');
    sp_te_set_repr_text_multiline(t, 'one\ntwo');
    expect(xml()).toBe('<tspan sodipodi:role="line">one</tspan><tspan sodipodi:role="line">two</tspan>');
  });
});
