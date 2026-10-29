// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/document-properties.cpp
import { Colors, DocumentUndo, findPaperSize, SPDocument } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import {
  get_document_scale,
  getPageSize,
  isLandscape,
  matchingPaperSize,
  set_background_color,
  set_document_dimensions,
  set_document_scale,
  set_orientation,
  set_paper_size,
} from './document-properties.ts';

SPDocument.scheduleIdle = () => {};

const open = (attrs: string) => {
  const doc = SPDocument.createNewDocFromMem(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}/>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const attrs = (doc: SPDocument) => ({
  width: doc.rroot.attribute('width'),
  height: doc.rroot.attribute('height'),
  viewBox: doc.rroot.attribute('viewBox'),
});

describe('page size', () => {
  it('writes width, height and viewBox, keeping the scale', () => {
    // 1 user unit = 1 mm
    const doc = open('width="210mm" height="297mm" viewBox="0 0 210 297"');
    set_document_dimensions(doc, 148, 210, 'mm');
    expect(attrs(doc)).toEqual({ width: '148mm', height: '210mm', viewBox: '0 0 148 210' });
    expect(get_document_scale(doc)).toEqual({ x: 1, y: 1 });
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Set page size']);
    DocumentUndo.undo(doc);
    expect(attrs(doc)).toEqual({ width: '210mm', height: '297mm', viewBox: '0 0 210 297' });
  });

  it('keeps a non-trivial scale and converts between units', () => {
    // 1 user unit = 2 mm
    const doc = open('width="100mm" height="100mm" viewBox="0 0 50 50"');
    set_document_dimensions(doc, 10, 20, 'cm');
    expect(attrs(doc)).toEqual({ width: '10cm', height: '20cm', viewBox: '0 0 50 100' });
    expect(get_document_scale(doc)).toEqual({ x: 0.2, y: 0.2 }); // per user unit, in cm: still 2 mm
  });

  it('writes no viewBox when the document has none', () => {
    const doc = open('width="100" height="100"');
    set_document_dimensions(doc, 200, 50, 'px');
    expect(attrs(doc)).toEqual({ width: '200', height: '50', viewBox: null });
    expect(doc.getDimensions().x).toBe(200);
  });

  it('chooses a preset in landscape and switches the orientation', () => {
    const doc = open('width="210mm" height="297mm" viewBox="0 0 210 297"');
    const a5 = findPaperSize(148, 210, 'mm');
    if (!a5) throw new Error('no A5');
    set_paper_size(doc, a5, true);
    expect(attrs(doc)).toEqual({ width: '210mm', height: '148mm', viewBox: '0 0 210 148' });
    expect(isLandscape(getPageSize(doc))).toBe(true);
    expect(matchingPaperSize(getPageSize(doc))?.name).toBe('A5');
    set_orientation(doc, false);
    expect(attrs(doc).width).toBe('148mm');
  });

  it('sets the scale by changing the viewBox only', () => {
    const doc = open('width="210mm" height="297mm" viewBox="0 0 210 297"');
    set_document_scale(doc, 2);
    expect(attrs(doc)).toEqual({ width: '210mm', height: '297mm', viewBox: '0 0 105 148.5' });
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Set page scale']);
  });
});

describe('page size with pages', () => {
  const multi = () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><defs><view viewBox="0 0 100 50"/><view viewBox="110 0 30 20"/></defs></svg>',
    );
    if (!doc) throw new Error('parse failed');
    return doc;
  };
  const size = (doc: SPDocument) => {
    const { width, height, unit } = getPageSize(doc);
    return { width: Math.round(width * 1e6) / 1e6, height: Math.round(height * 1e6) / 1e6, unit };
  };

  it('acts on the selected page when it is not the viewport page', () => {
    const doc = multi();
    expect(size(doc)).toEqual({ width: 30, height: 20, unit: 'mm' });
    set_document_dimensions(doc, 40, 25, 'mm');
    expect(doc.getPageManager().getSelected()?.getRepr().attribute('viewBox')).toBe('110 0 40 25');
    expect(attrs(doc).width).toBe('100mm');
    set_orientation(doc, false);
    expect(size(doc)).toEqual({ width: 25, height: 40, unit: 'mm' });
  });

  it('resizes the document and the viewport page together', () => {
    const doc = multi();
    const pm = doc.getPageManager();
    pm.selectPageIndex(0);
    set_document_dimensions(doc, 80, 60, 'mm');
    expect(attrs(doc)).toEqual({ width: '80mm', height: '60mm', viewBox: '0 0 80 60' });
    expect(pm.getFirstPage()?.getRepr().attribute('viewBox')).toBe('0 0 80 60');
  });
});

describe('page color', () => {
  it('writes pagecolor to the namedview, merging repeated changes into one undo step', () => {
    const doc = open('width="10" height="10"');
    set_background_color(doc, new Colors.Color(0xff0000ff, false));
    set_background_color(doc, new Colors.Color(0x00ff00ff, false));
    expect(doc.getNamedView().getAttribute('pagecolor')).toBe('#00ff00');
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Background color']);
  });
});
