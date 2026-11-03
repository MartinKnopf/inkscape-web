// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-pattern.cpp, src/selection-chemistry.cpp (tile, untile)
import { Point, Scale } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { ObjectSet } from './object-set.ts';
import type { SPItem } from './sp-item.ts';
import { PatternUnits, SPPattern } from './sp-pattern.ts';

SPDocument.scheduleIdle = () => {};

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(`<svg ${NS} width="400" height="300">${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};

const DEFS =
  '<defs><pattern id="root" patternUnits="userSpaceOnUse" width="10" height="20" patternTransform="translate(1,2)"><rect width="5" height="5"/></pattern>' +
  '<pattern id="link" xlink:href="#root" x="3"/></defs>';

describe('SPPattern', () => {
  it('reads the attributes along the href chain and draws the root content', () => {
    const doc = open(DEFS);
    const link = doc.getObjectById('link') as SPPattern;
    expect(link.width()).toBe(10);
    expect(link.height()).toBe(20);
    expect(link.x()).toBe(3);
    expect(link.patternUnits()).toBe(PatternUnits.UNITS_USERSPACEONUSE);
    expect(link.getTransform().translation().equals(new Point(1, 2))).toBe(true);
    expect(link.rootPattern()).toBe(doc.getObjectById('root'));
    expect(link.isValid()).toBe(true);
  });

  it('gives an item its own linked pattern before the transform changes', () => {
    const doc = open(`${DEFS}<rect id="a" width="50" height="50" style="fill:url(#root)"/>`);
    const a = doc.getObjectById('a') as SPItem;
    const root = doc.getObjectById('root') as SPPattern;
    const own = root.clone_if_necessary(a, 'fill');
    expect(own).not.toBe(root);
    expect(a.getRepr().attribute('style')).toContain(`url(#${own.getId()})`);
    own.transform_multiply(Scale(2), false);
    doc.ensureUpToDate();
    expect(own.getRepr().attribute('patternTransform')).toBe('matrix(2,0,0,2,2,4)');
    // the root pattern keeps its transform
    expect(root.getRepr().attribute('patternTransform')).toBe('translate(1,2)');
  });

  it('turns objects into a pattern-filled rectangle and back', () => {
    const doc = open('<rect id="a" x="10" y="20" width="30" height="40"/>');
    const set = new ObjectSet(doc);
    set.add(doc.getObjectById('a')!);
    expect(set.tile()).toBe(true);
    const rect = set.singleItem()!;
    expect(rect.getRepr().name()).toBe('svg:rect');
    expect([rect.getAttribute('x'), rect.getAttribute('y'), rect.getAttribute('width')]).toEqual([
      '10',
      '20',
      '30',
    ]);
    const pattern = rect.style.getFillPaintServer() as SPPattern;
    expect(pattern).toBeInstanceOf(SPPattern);
    expect([pattern.width(), pattern.height()]).toEqual([30, 40]);
    // the content moved to the tile origin; the pattern transform moves it back
    const content = pattern.firstChild() as SPItem;
    expect([content.getAttribute('x'), content.getAttribute('y')]).toEqual(['0', '0']);
    expect(pattern.getTransform().translation().equals(new Point(10, 20))).toBe(true);

    expect(set.untile()).toBe(true);
    doc.ensureUpToDate();
    const copy = set.singleItem()!;
    expect(copy.documentGeometricBounds()?.min().equals(new Point(10, 20))).toBe(true);
    expect(rect.getRepr().attribute('style')).toContain('fill:none');
  });
});
