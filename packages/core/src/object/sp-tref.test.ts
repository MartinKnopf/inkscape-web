// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-tref.cpp, src/object/sp-tref-reference.cpp
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { ObjectSet } from './object-set.ts';
import type { SPItem } from './sp-item.ts';
import type { SPText } from './sp-text.ts';
import { SPTRef } from './sp-tref.ts';
import { SPTSpan } from './sp-tspan.ts';

SPDocument.scheduleIdle = () => {};

// Without the text module every character is a glyph of 0.5 em.
const open = () => {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      '<defs><text id="src">Hello <tspan>world</tspan></text></defs>' +
      '<text id="t" x="10" y="50" style="font-size:20px">[<tref id="r" xlink:href="#src" style="fill:red"/>]</text></svg>',
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return { doc, text: doc.getObjectById('t') as SPText, tref: doc.getObjectById('r') as SPTRef };
};

describe('SPTRef', () => {
  it('lays out the character data of the referred element', () => {
    const { text, tref } = open();
    expect(tref).toBeInstanceOf(SPTRef);
    expect(tref.stringChild?.string).toBe('Hello world');
    // "[" + 11 characters + "]" of 10px each.
    expect(text.layout.iteratorToCharIndex(text.layout.end())).toBe(13);
    const box = tref.geometricBounds();
    expect([box?.left(), box?.right()]).toEqual([20, 130]);
    expect(tref.displayName()).toBe('Cloned Character Data');
  });

  it('follows changes of the referred text and deletes itself with the referred element', () => {
    const { doc, text, tref } = open();
    const src = doc.getObjectById('src')!;
    src.getRepr().firstChild()!.setContent('Bye ');
    doc.ensureUpToDate();
    expect(tref.stringChild?.string).toBe('Bye world');
    expect(text.layout.iteratorToCharIndex(text.layout.end())).toBe(11);

    src.deleteObject();
    doc.ensureUpToDate();
    expect(doc.getObjectById('r')).toBeNull();
  });

  it('becomes a tspan with its text and style when the text is unlinked', () => {
    const { doc, text } = open();
    const set = new ObjectSet(doc);
    set.set(text as SPItem);
    expect(set.unlink(true)).toBe(true);
    doc.ensureUpToDate();
    const tspan = doc.getObjectById('r');
    expect(tspan).toBeInstanceOf(SPTSpan);
    expect(tspan?.getRepr().firstChild()?.content()).toBe('Hello world');
    expect(tspan?.getRepr().attribute('style')).toContain('fill:red');
  });
});
