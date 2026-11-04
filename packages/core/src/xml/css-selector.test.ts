// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/3rdparty/libcroco/cr-sel-eng.c
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';

SPDocument.scheduleIdle = () => {};

const doc = SPDocument.createNewDocFromMem(
  '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<g id="g" class="layer a"><rect id="r1" class="a b" x="1"/><circle id="c1" class="b"/><rect id="r2"/></g>' +
    '<rect id="r3" class="a" x="2"/></svg>',
) as SPDocument;
const ids = (list: { getId(): string | null }[]) => list.map((o) => o.getId());

describe('getObjectsBy*', () => {
  it('finds objects by class and element', () => {
    expect(ids(doc.getObjectsByClass('a'))).toEqual(['g', 'r1', 'r3']);
    expect(ids(doc.getObjectsByClass('b'))).toEqual(['r1', 'c1']);
    expect(ids(doc.getObjectsByElement('rect'))).toEqual(['r1', 'r2', 'r3']);
    expect(doc.getObjectsByClass('')).toEqual([]);
  });

  it('matches selectors: type, class, id, attribute and combinators', () => {
    expect(ids(doc.getObjectsBySelector('rect.a'))).toEqual(['r1', 'r3']);
    expect(ids(doc.getObjectsBySelector('#c1, #r2'))).toEqual(['c1', 'r2']);
    expect(ids(doc.getObjectsBySelector('rect[x]'))).toEqual(['r1', 'r3']);
    expect(ids(doc.getObjectsBySelector('rect[x="2"]'))).toEqual(['r3']);
    expect(ids(doc.getObjectsBySelector('g > rect'))).toEqual(['r1', 'r2']);
    expect(ids(doc.getObjectsBySelector('.layer .b'))).toEqual(['r1', 'c1']);
    expect(ids(doc.getObjectsBySelector('circle + rect'))).toEqual(['r2']);
    expect(ids(doc.getObjectsBySelector('g > :first-child'))).toEqual(['r1']);
    expect(ids(doc.getObjectsBySelector('rect:hover'))).toEqual([]); // not supported: matches nothing
  });
});
