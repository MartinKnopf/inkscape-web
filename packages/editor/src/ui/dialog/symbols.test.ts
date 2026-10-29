// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/symbols.cpp, src/ui/clipboard.cpp, src/selection-chemistry.cpp
// @vitest-environment happy-dom
import { SPDocument, type SPSymbol, SPUse } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import {
  collectSymbols,
  insertSymbolInDocument,
  symbolItem,
  symbolMatches,
  symbolPreviewSvg,
  symbolSetTitle,
} from './symbols.ts';

SPDocument.scheduleIdle = () => {};

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

const SET = `<svg ${NS} style="fill:none;stroke:#000000"><title>Test set</title><defs>
  <linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient>
  <symbol id="box" viewBox="0 0 20 10"><title>A box</title><rect width="20" height="10" fill="url(#g)"/></symbol>
  <symbol id="dot"><circle cx="5" cy="5" r="5"/></symbol>
</defs></svg>`;

function open(svg: string) {
  const doc = SPDocument.createNewDocFromMem(svg);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
}

function desktopFor(doc: SPDocument) {
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  return new SPDesktop(new Canvas(host), doc);
}

describe('symbols', () => {
  it('lists the symbols of a set with titles, searchable', () => {
    const set = open(SET);
    expect(symbolSetTitle(set, 'x/test.svg')).toBe('Test set');
    const symbols = collectSymbols(set.getRoot());
    expect(symbols.map((s) => s.getId())).toEqual(['box', 'dot']);
    const items = symbols.map((s) => symbolItem(s, 'Test set', set));
    expect(items.map((i) => i.label)).toEqual(['A box', 'dot']);
    expect(items[0]?.symbolTitle).toBe('A box (Test set)');
    expect(items.filter((i) => symbolMatches(i, 'BOX')).length).toBe(1);
    expect(items[1]?.dimensions.x).toBeCloseTo(11); // 10 px and the stroke of the set style;
  });

  it('inserts a use and copies the symbol with the defs it needs, once', async () => {
    const set = open(SET);
    const doc = open(`<svg ${NS} width="400" height="300"></svg>`);
    const desktop = desktopFor(doc);
    const item = symbolItem(collectSymbols(set.getRoot())[0] as SPSymbol, 'Test set', set);

    await insertSymbolInDocument(desktop, item);
    await insertSymbolInDocument(desktop, item);
    doc.ensureUpToDate();

    const defs = doc.getDefs()?.getRepr();
    const symbols = defs ? [...Array(defs.childCount()).keys()].map((i) => defs.nthChild(i)) : [];
    // One symbol in the defs, although inserted twice; no "_inkscape_duplicate" id.
    expect(symbols.filter((n) => n?.name() === 'svg:symbol').map((n) => n?.attribute('id'))).toEqual([
      'Test_set:box',
    ]);
    // TODO: upstream also merges equal defs (DuplicateDefString), so the gradient would be there once.
    expect(symbols.filter((n) => n?.name() === 'svg:linearGradient').length).toBeGreaterThanOrEqual(1);

    const uses = collectUses(doc);
    expect(uses.length).toBe(2);
    expect(uses[0]?.getRepr().attribute('xlink:href')).toBe('#Test_set:box');
    // The viewBox size becomes the size of the use, as upstream does.
    expect(uses[0]?.getRepr().attribute('width')).toBe('20');
    expect(uses[0]?.getRepr().attribute('height')).toBe('10');
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Paste');
  });

  it('puts the symbol at the center of the visible area', async () => {
    const set = open(SET);
    const doc = open(`<svg ${NS} width="400" height="300"></svg>`);
    const desktop = desktopFor(doc);
    const item = symbolItem(collectSymbols(set.getRoot())[0] as SPSymbol, 'Test set', set);
    await insertSymbolInDocument(desktop, item, new Point(100, 50));
    doc.ensureUpToDate();
    const bounds = collectUses(doc)[0]?.documentVisualBounds();
    // The size of the symbol includes the stroke of the set style, the size of the use does not: half a px off.
    expect(Math.abs((bounds?.midpoint().x ?? 0) - 100)).toBeLessThan(1);
    expect(Math.abs((bounds?.midpoint().y ?? 0) - 50)).toBeLessThan(1);
  });

  it('makes a standalone preview with the used defs', () => {
    const set = open(SET);
    const svg = symbolPreviewSvg(collectSymbols(set.getRoot())[0] as SPSymbol);
    expect(svg).toContain('width="20" height="10"');
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('style="fill:none;stroke:#000000"');
    const parsed = SPDocument.createNewDocFromMem(svg);
    expect(parsed).not.toBeNull();
  });

  it('converts objects to a symbol and back', () => {
    const doc = open(
      `<svg ${NS}><rect id="a" width="10" height="10"/><rect id="b" x="20" width="5" height="5"/></svg>`,
    );
    const desktop = desktopFor(doc);
    desktop.getSelection().setList([doc.getObjectById('a') as never, doc.getObjectById('b') as never]);
    desktop.getSelection().toSymbol();
    doc.ensureUpToDate();
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Group to symbol');
    const symbol = collectSymbols(doc.getRoot())[0];
    expect(symbol?.children.map((c) => c.getId())).toEqual(['a', 'b']);
    expect(collectUses(doc)[0]?.getRepr().attribute('xlink:href')).toBe(`#${symbol?.getId()}`);
    expect(desktop.getSelection().items()[0]).toBeInstanceOf(SPUse);

    desktop.getSelection().unSymbol();
    doc.ensureUpToDate();
    expect(collectSymbols(doc.getRoot()).length).toBe(0);
  });
});

function collectUses(doc: SPDocument): SPUse[] {
  const uses: SPUse[] = [];
  const walk = (o: { children: readonly unknown[] }) => {
    for (const c of o.children) {
      if (c instanceof SPUse) uses.push(c);
      else walk(c as { children: readonly unknown[] });
    }
  };
  walk(doc.getRoot());
  return uses;
}
