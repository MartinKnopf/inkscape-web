// SPDX-License-Identifier: GPL-2.0-or-later
import { Affine } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { FakeDrawing, type FakeDrawingGroup } from '../display/fake-drawing.ts';
import { SPDocument } from '../document.ts';
import { SP_ITEM_SHOW_DISPLAY, SPItem } from './sp-item.ts';

SPDocument.scheduleIdle = () => {};

const open = (attrs: string, body = '') => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};

describe('SPRoot size and viewBox', () => {
  it('maps a mm viewBox to px (A4 template)', () => {
    const doc = open('width="210mm" height="297mm" viewBox="0 0 210 297"', '<g id="g"/>');
    const px = 96 / 25.4;
    expect(doc.getDimensions().x).toBeCloseTo(210 * px);
    expect(doc.getDimensions().y).toBeCloseTo(297 * px);
    expect(doc.root.c2p.isNear(new Affine(px, 0, 0, px, 0, 0))).toBe(true);
    expect((doc.getObjectById('g') as SPItem).i2docAffine().isNear(doc.root.c2p)).toBe(true);
  });

  it('uses the viewBox size without width/height, and 300×150 without both', () => {
    expect(open('viewBox="10 20 100 50"').getDimensions()).toMatchObject({ x: 100, y: 50 });
    expect(open('viewBox="10 20 100 50"').root.c2p.isNear(new Affine(1, 0, 0, 1, -10, -20))).toBe(true);
    expect(open('').getDimensions()).toMatchObject({ x: 300, y: 150 });
  });

  it('applies preserveAspectRatio to a non-uniform viewBox', () => {
    const meet = open('width="200" height="100" viewBox="0 0 100 100"').root.c2p;
    expect(meet.isNear(new Affine(1, 0, 0, 1, 50, 0))).toBe(true);
    const none = open('width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="none"').root.c2p;
    expect(none.isNear(new Affine(2, 0, 0, 1, 0, 0))).toBe(true);
  });

  it('sets the child transform of its views and updates it on change', () => {
    const doc = open('width="20" height="20" viewBox="0 0 10 10"');
    const root = doc.root.invokeShow(
      new FakeDrawing(),
      SPItem.displayKeyNew(1),
      SP_ITEM_SHOW_DISPLAY,
    ) as FakeDrawingGroup;
    expect(root.childTransform?.isNear(new Affine(2, 0, 0, 2, 0, 0))).toBe(true);
    doc.root.getRepr().setAttribute('width', '40');
    doc.root.getRepr().setAttribute('height', '40');
    doc.ensureUpToDate();
    expect(root.childTransform?.isNear(new Affine(4, 0, 0, 4, 0, 0))).toBe(true);
  });
});
