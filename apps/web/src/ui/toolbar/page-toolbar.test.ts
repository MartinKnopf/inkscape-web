// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/page-toolbar.cpp
import { PAGE_SIZES, SPDocument } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { labelEdited, marginsEdited, parse_page_size, sizeChanged, sizeChoose } from './page-toolbar.tsx';

SPDocument.scheduleIdle = () => {};

const open = () => {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><defs><view viewBox="0 0 100 50"/><view viewBox="110 0 100 50"/></defs></svg>',
  );
  if (!doc) throw new Error('parse failed');
  return doc;
};

describe('parse_page_size', () => {
  it.each([
    ['50x40', 'px', [50, 40]],
    ['1in x 2in', 'px', [96, 192]],
    ['1 x 2in', 'px', [96, 192]],
    ['3,5 × 2', 'px', [3.5, 2]],
    ['10-20', 'mm', [(10 * 96) / 25.4, (20 * 96) / 25.4]],
    ['A4 (1 x 2in)', 'px', [96, 192]],
  ])('parses %j with display unit %s', (text, unit, [w, h]) => {
    const size = parse_page_size(text, unit);
    expect(size?.width).toBeCloseTo(w as number, 6);
    expect(size?.height).toBeCloseTo(h as number, 6);
  });

  it.each(['', 'abc', '10', '-5x5'])('rejects %j', (text) => {
    expect(parse_page_size(text, 'px')).toBeNull();
  });
});

describe('page toolbar edits', () => {
  it('resizes the selected page to a preset in its orientation and keeps the preset name', () => {
    const doc = open();
    const pm = doc.getPageManager();
    const a5 = PAGE_SIZES.find((p) => p.name === 'A5');
    if (!a5) throw new Error('no A5');
    sizeChoose(doc, a5);
    const page = pm.getSelected();
    // The page was landscape (100 x 50), so A5 is landscape too.
    expect(page?.getRect().width()).toBeCloseTo((210 * 96) / 25.4, 6);
    expect(page?.getRect().height()).toBeCloseTo((148 * 96) / 25.4, 6);
    expect(page?.getRepr().attribute('inkscape:page-size')).toBe('A5');
    expect(pm.getSizeLabel(page)).toBe('A5');
  });

  it('sets a typed size, the margins and the label of the selected page', () => {
    const doc = open();
    const page = doc.getPageManager().getSelected();
    expect(sizeChanged(doc, '30 x 20')).toBe(true);
    expect(sizeChanged(doc, 'nonsense')).toBe(false);
    expect([page?.getRect().width(), page?.getRect().height()]).toEqual([30, 20]);
    marginsEdited(doc, '2 4');
    expect(page?.getRepr().attribute('inkscape:margin')).toBe('2 4');
    labelEdited(doc, 'Cover');
    expect(page?.getLabel()).toBe('Cover');
    labelEdited(doc, '');
    expect(page?.getLabel()).toBe('Page 2');
  });
});
