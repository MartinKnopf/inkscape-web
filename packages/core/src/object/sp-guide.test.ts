// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-guide.cpp
import { Point } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { SPGuide } from './sp-guide.ts';

SPDocument.scheduleIdle = () => {};

const NS =
  'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';

const open = (attrs: string, namedview: string) => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" ${NS} ${attrs}><sodipodi:namedview>${namedview}</sodipodi:namedview></svg>`,
  );
  if (!doc) throw new Error('parse failed');
  return doc;
};

describe('SPGuide', () => {
  it('reads position, orientation, label and locked with the y axis pointing up in the file', () => {
    const doc = open(
      'width="200" height="100"',
      '<sodipodi:guide position="30,40" orientation="0,1" inkscape:label="top" inkscape:locked="true"/>',
    );
    const [guide] = doc.getNamedView().guides;
    // y = height - 40; a horizontal guide
    expect(guide?.getPoint().equals(new Point(30, 60))).toBe(true);
    expect(guide?.getNormal().equals(new Point(0, 1))).toBe(true);
    expect(guide?.label()).toBe('top');
    expect(guide?.getLocked()).toBe(true);
  });

  it('interprets the position in viewBox units', () => {
    const doc = open(
      'width="200" height="100" viewBox="0 0 20 10"',
      '<sodipodi:guide position="3,4" orientation="1,0"/>',
    );
    const [guide] = doc.getNamedView().guides;
    expect(guide?.getPoint().equals(new Point(30, 60))).toBe(true);
    // a vertical guide; the stored x of the normal is mirrored
    expect(Math.abs(guide?.getNormal().x ?? 0)).toBe(1);
  });

  it('createSPGuide() and moveto() write the file coordinates', () => {
    const doc = open('width="200" height="100"', '');
    const guide = SPGuide.createSPGuide(doc, new Point(10, 20), new Point(50, 20));
    expect(guide).toBeInstanceOf(SPGuide);
    expect(doc.getNamedView().guides).toEqual([guide]);
    expect(guide?.getAttribute('position')).toBe('10,80');
    expect(guide?.getPoint().equals(new Point(10, 20))).toBe(true);
    guide?.moveto(new Point(15, 25), true);
    expect(guide?.getAttribute('position')).toBe('15,75');
    expect(guide?.getPoint().equals(new Point(15, 25))).toBe(true);
    guide?.remove();
    expect(doc.getNamedView().guides).toEqual([]);
  });
});
