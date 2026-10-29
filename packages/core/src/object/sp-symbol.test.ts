// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-symbol.cpp
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { SPSymbol } from './sp-symbol.ts';
import type { SPUse } from './sp-use.ts';

SPDocument.scheduleIdle = () => {};

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

function open(symbolAttrs: string, useAttrs = '') {
  const doc = SPDocument.createNewDocFromMem(
    `<svg ${NS} width="400" height="300"><defs>` +
      `<symbol id="s" ${symbolAttrs}><rect id="r" x="0" y="0" width="10" height="10"/></symbol></defs>` +
      `<use id="u" xlink:href="#s" ${useAttrs}/></svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
}

describe('SPSymbol', () => {
  it('reads viewBox, refX and refY, and writes them back', () => {
    const doc = open('viewBox="0 0 10 10" refX="5" refY="center"');
    const symbol = doc.getObjectById('s');
    expect(symbol).toBeInstanceOf(SPSymbol);
    const s = symbol as SPSymbol;
    expect(s.vb.viewBox_set).toBe(true);
    expect(s.refX.computed).toBe(5);
    expect(s.refY.unit).toBeDefined();
    const repr = s.write(doc.getReprDoc(), s.getRepr(), 0);
    expect(repr?.attribute('viewBox')).toBe('0 0 10 10');
  });

  it('does not render itself, but as the child of a use, scaled to the use size', () => {
    const doc = open('viewBox="0 0 10 10"', 'width="40" height="40"');
    const use = doc.getObjectById('u') as SPUse;
    const clone = use.child as SPSymbol;
    expect(clone).toBeInstanceOf(SPSymbol);
    expect(clone.cloned).toBe(true);
    // The 10 x 10 content fills the 40 x 40 viewport.
    expect(clone.c2p.c0).toBeCloseTo(4);
    expect(use.bbox(use.transform, 0)?.width()).toBeCloseTo(40);
    // The original in defs has no scaling and does not take part in the drawing.
    const original = doc.getObjectById('s') as SPSymbol;
    expect(original.cloned).toBe(false);
    expect(original.bbox(original.transform, 0)?.width()).toBeCloseTo(10);
  });

  it('shifts the content by the reference point', () => {
    const doc = open('refX="5" refY="5"');
    const use = doc.getObjectById('u') as SPUse;
    const clone = use.child as SPSymbol;
    expect(clone.c2p.c4).toBeCloseTo(-5);
    expect(clone.c2p.c5).toBeCloseTo(-5);
  });

  it('unSymbol makes a group with the id of the symbol that the uses follow', () => {
    const doc = open('');
    const symbol = doc.getObjectById('s') as SPSymbol;
    symbol.unSymbol();
    doc.ensureUpToDate();
    const group = doc.getObjectById('s');
    expect(group?.getTagName()).toBe('svg:g');
    expect(group?.children.map((c) => c.getId())).toEqual(['r']);
  });
});
