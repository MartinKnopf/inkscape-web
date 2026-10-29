// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/page-manager-test.cpp
import { Point, Rect, Translate } from '@inkscape-web/geom';
import { beforeEach, describe, expect, it } from 'vitest';
import { SPDocument } from './document.ts';
import { ObjectSet } from './object/object-set.ts';
import type { SPRect } from './object/sp-rect.ts';
import { Preferences } from './preferences.ts';

SPDocument.scheduleIdle = () => {};

const NS =
  'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';

const open = (attrs: string, body = '') => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" ${NS} ${attrs}>${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};

const xywh = (r: Rect | null | undefined) => (r ? [r.left(), r.top(), r.width(), r.height()] : null);

beforeEach(() => Preferences.get().setBool('/tools/pages/move_objects', true));

describe('PageManager', () => {
  it('reads the svg:view pages of the defs in document order', () => {
    const doc = open(
      'width="100" height="200"',
      `<defs><svg:view xmlns:svg="http://www.w3.org/2000/svg" id="p1" viewBox="0 0 100 200"/>
       <view id="p2" viewBox="110 0 50 50" inkscape:label="Back" inkscape:margin="5" inkscape:bleed="2 4"/></defs>`,
    );
    const pm = doc.getPageManager();
    expect(pm.getPages().map((p) => p.getId())).toEqual(['p1', 'p2']);
    const [first, second] = pm.getPages();
    expect(first?.isViewportPage()).toBe(true);
    expect(second?.isViewportPage()).toBe(false);
    expect(second?.getLabel()).toBe('Back');
    expect(first?.getLabel()).toBe('Page 1');
    expect(xywh(second?.getDesktopMargin())).toEqual([115, 5, 40, 40]);
    expect(xywh(second?.getDesktopBleed())).toEqual([106, -2, 58, 54]);
    expect(pm.findPageAt(new Point(120, 10))).toBe(second);
  });

  it('converts the inkscape:page elements of the namedview to svg:view in the defs', () => {
    const doc = open(
      'width="100" height="100"',
      `<sodipodi:namedview><inkscape:page id="a" x="0" y="0" width="100" height="100" margin="3"/>
       <inkscape:page id="b" x="120" y="0" width="80" height="60" inkscape:label="B"/></sodipodi:namedview>`,
    );
    const pages = doc.getPageManager().getPages();
    expect(pages.map((p) => [p.getId(), p.getRepr().name(), p.parent === doc.getDefs()])).toEqual([
      ['a', 'svg:view', true],
      ['b', 'svg:view', true],
    ]);
    expect(pages[0]?.getRepr().attribute('inkscape:margin')).toBe('3');
    expect(xywh(pages[1]?.getRect())).toEqual([120, 0, 80, 60]);
    expect(doc.getNamedView().getRepr().childCount()).toBe(0);
  });

  it('enables pages with the viewport as the first page and adds new pages to the right', () => {
    const doc = open('width="100" height="50"');
    const pm = doc.getPageManager();
    expect(pm.hasPages()).toBe(false);
    const page = pm.newPage();
    expect(pm.getPageCount()).toBe(2);
    expect(pm.getSelected()).toBe(page);
    expect(xywh(pm.getFirstPage()?.getRect())).toEqual([0, 0, 100, 50]);
    expect(xywh(page?.getRect())).toEqual([110, 0, 100, 50]);
    expect(page?.getRepr().attribute('viewBox')).toBe('110 0 100 50');
    expect(xywh(doc.pageBounds())).toEqual([110, 0, 100, 50]);
  });

  it('goes back to a single page document when the second last page is deleted', () => {
    const doc = open('width="100" height="50"');
    const pm = doc.getPageManager();
    const page = pm.newPage();
    pm.deletePage(page, false);
    expect(pm.hasPages()).toBe(false);
    expect(doc.getDefs()?.children.length).toBe(0);
  });

  it('keeps the last page when it has a margin', () => {
    const doc = open('width="100" height="50"');
    const pm = doc.getPageManager();
    const page = pm.newPage();
    pm.getFirstPage()?.setMargin('4');
    pm.deletePage(page, false);
    expect(pm.getPageCount()).toBe(1);
  });

  it('deletes the contents of a page that rest on it only', () => {
    const doc = open(
      'width="100" height="100"',
      `<defs><view viewBox="0 0 100 100"/><view viewBox="200 0 100 100"/></defs>
       <rect id="on" x="210" y="10" width="10" height="10"/><rect id="off" x="10" y="10" width="10" height="10"/>`,
    );
    const pm = doc.getPageManager();
    pm.deletePage(pm.getPage(1), true);
    expect(doc.getObjectById('on')).toBeNull();
    expect(doc.getObjectById('off')).not.toBeNull();
  });

  it('moves a page with the objects on it', () => {
    const doc = open(
      'width="100" height="100"',
      `<defs><view viewBox="0 0 100 100"/><view viewBox="200 0 100 100"/></defs>
       <rect id="r" x="210" y="10" width="10" height="10"/>`,
    );
    const page = doc.getPageManager().getPage(1);
    page?.movePage(Translate(50, 20), true);
    doc.ensureUpToDate();
    expect(xywh(page?.getRect())).toEqual([250, 20, 100, 100]);
    const rect = doc.getObjectById('r') as SPRect;
    expect(xywh(rect.desktopGeometricBounds())).toEqual([260, 30, 10, 10]);
  });

  it('resizes the document for the viewport page and moves the other pages to compensate', () => {
    const doc = open(
      'width="100mm" height="100mm" viewBox="0 0 100 100"',
      '<defs><view viewBox="0 0 100 100"/><view viewBox="110 0 100 100"/></defs>',
    );
    const pm = doc.getPageManager();
    const [first, second] = pm.getPages();
    // Move the viewport page right by 10mm: the document origin moves, so the second page shifts left.
    const mm = (v: number) => (v * 96) / 25.4;
    pm.fitToRect(Rect.fromXywh(mm(10), 0, mm(200), mm(100)), first ?? null);
    expect(doc.getRoot().getRepr().attribute('width')).toBe('200mm');
    expect(first?.isViewportPage()).toBe(true);
    expect(xywh(second?.getRect())?.map((v) => Math.round(v * 1000) / 1000)).toEqual([100, 0, 100, 100]);
  });

  it('resizes a page that is not the viewport page', () => {
    const doc = open(
      'width="100" height="100"',
      '<defs><view viewBox="0 0 100 100"/><view viewBox="110 0 100 100"/></defs>',
    );
    const pm = doc.getPageManager();
    pm.selectPageIndex(1);
    pm.resizeSelectedPage(40, 30);
    expect(xywh(pm.getSelected()?.getRect())).toEqual([110, 0, 40, 30]);
    expect(doc.getDimensions().equals(new Point(100, 100))).toBe(true);
  });

  it('moves a page forward in the page order and swaps the positions', () => {
    const doc = open(
      'width="100" height="100"',
      '<defs><view id="a" viewBox="0 0 100 100"/><view id="b" viewBox="110 0 100 100"/><view id="c" viewBox="220 0 100 100"/></defs>',
    );
    const pm = doc.getPageManager();
    const b = doc.getObjectById('b');
    pm.selectPageIndex(1);
    expect(pm.getSelected()?.setPageIndex(2, true)).toBe(true);
    expect(pm.getPages().map((p) => p.getId())).toEqual(['a', 'c', 'b']);
    expect(pm.getSelected()).toBe(b);
    expect(xywh(pm.getPage(1)?.getRect())).toEqual([110, 0, 100, 100]);
    expect(xywh(pm.getPage(2)?.getRect())).toEqual([220, 0, 100, 100]);
  });

  it('fits the selected page to the selection with its margins', () => {
    const doc = open(
      'width="100" height="100"',
      '<defs><view viewBox="0 0 100 100"/><view viewBox="200 0 100 100" inkscape:margin="5"/></defs><rect id="r" x="300" y="20" width="10" height="10"/>',
    );
    const pm = doc.getPageManager();
    pm.selectPageIndex(1);
    const set = new ObjectSet(doc);
    set.add(doc.getObjectById('r') as SPRect);
    pm.fitToSelection(set, true);
    expect(xywh(pm.getSelected()?.getRect())).toEqual([295, 15, 20, 20]);
  });

  it('labels the size of a page by preset name or by size in the display unit', () => {
    const doc = open('width="210mm" height="297mm" viewBox="0 0 210 297"');
    const pm = doc.getPageManager();
    expect(pm.getSizeLabel()).toBe('A4');
    expect(pm.getSizeLabelFor(100, 50)).toBe('100 × 50 px');
  });
});
