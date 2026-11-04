// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-style-elem.cpp, src/style.cpp
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import type { SPObject } from './sp-object.ts';

SPDocument.scheduleIdle = () => {};

function open(body: string) {
  const doc = SPDocument.createNewDocFromMem(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const fill = (id: string) => (doc.getObjectById(id) as SPObject).style.fill.getValue();
  return { doc, fill };
}

describe('svg:style', () => {
  it('applies element, class, id and attribute selectors with specificity', () => {
    const { fill } = open(
      '<style>rect { fill: red } .a { fill: blue } #c { fill: green } [data-x="1"] { fill: yellow }' +
        ' rect.a { fill: #00ffff }</style>' +
        '<rect id="r"/><rect id="b" class="a"/><circle id="c2" class="a"/><rect id="c" class="a"/>' +
        '<circle id="d" data-x="1"/>',
    );
    expect(fill('r')).toBe('red');
    expect(fill('b')).toBe('#00ffff'); // rect.a is more specific than .a
    expect(fill('c2')).toBe('blue');
    expect(fill('c')).toBe('green'); // the id wins
    expect(fill('d')).toBe('yellow');
  });

  it('gives the style attribute precedence unless the rule is !important', () => {
    const { fill } = open(
      '<style>.a { fill: blue } .b { fill: green !important }</style>' +
        '<rect id="a" class="a" style="fill:red"/><rect id="b" class="b" style="fill:red"/>',
    );
    expect(fill('a')).toBe('red');
    expect(fill('b')).toBe('green');
  });

  it('is applied before the presentation attributes and inherited by children', () => {
    const { fill } = open('<style>g { fill: blue }</style><g id="g" fill="red"><rect id="r"/></g>');
    expect(fill('g')).toBe('blue');
    expect(fill('r')).toBe('blue');
  });

  it('restyles the document when the style element changes', () => {
    const { doc, fill } = open('<style id="s">rect { fill: red }</style><rect id="r"/>');
    const text = doc.getObjectById('s')!.getRepr().firstChild()!;
    text.setContent('rect { fill: blue }');
    doc.ensureUpToDate();
    expect(fill('r')).toBe('blue');
    doc.getObjectById('s')!.deleteObject();
    doc.ensureUpToDate();
    expect((doc.getObjectById('r') as SPObject).style.fill.set).toBe(false);
  });

  it('does not write style sheet properties into the style attribute', () => {
    const { doc } = open('<style>rect { fill: red }</style><rect id="r" style="stroke:blue"/>');
    const r = doc.getObjectById('r')!;
    r.updateRepr();
    expect(r.getRepr().attribute('style')).toBe('stroke:blue');
  });
});
