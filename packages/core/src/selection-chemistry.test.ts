// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/selection-chemistry.cpp, src/object/sp-item-group.cpp, src/selection.cpp
import { describe, expect, it } from 'vitest';
import { SPDocument } from './document.ts';
import { DocumentUndo } from './document-undo.ts';
import { SPItem } from './object/sp-item.ts';
import { SPGroup } from './object/sp-item-group.ts';
import { Selection } from './selection.ts';

SPDocument.scheduleIdle = () => {}; // tests call ensureUpToDate() themselves

function open(body: string) {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const item = (id: string) => {
    const o = doc.getObjectById(id);
    if (!(o instanceof SPItem)) throw new Error(`no item ${id}`);
    return o;
  };
  const select = (...ids: string[]) => {
    const s = new Selection(doc);
    s.setList(ids.map(item));
    return s;
  };
  /** Ids of the children of the element with id parent (or the root), without defs. */
  const order = (parent?: string) => {
    const repr = parent ? item(parent).getRepr() : doc.getReprRoot();
    return [...repr.children()].filter((c) => c.name() !== 'svg:defs').map((c) => c.attribute('id'));
  };
  const undoSteps = () => doc.undoStack.undo.map((s) => s.description);
  return { doc, item, select, order, undoSteps };
}

// a, b and c overlap; d is far away.
const STACK =
  '<rect id="a" x="0" y="0" width="20" height="20"/>' +
  '<rect id="b" x="10" y="0" width="20" height="20"/>' +
  '<rect id="d" x="100" y="100" width="10" height="10"/>' +
  '<rect id="c" x="20" y="0" width="20" height="20"/>';

describe('ObjectSet.duplicate', () => {
  it('appends copies with new ids on top, selects them, and undoes in one step', () => {
    const { doc, select, order, undoSteps } = open(STACK);
    const s = select('c', 'a');
    s.duplicate();
    expect(order()).toEqual(['a', 'b', 'd', 'c', expect.any(String), expect.any(String)]);
    const [copyA, copyC] = order().slice(4);
    expect(copyA).not.toBe('a');
    expect(doc.getObjectById(copyA ?? '')?.getAttribute('x')).toBe('0');
    expect(doc.getObjectById(copyC ?? '')?.getAttribute('x')).toBe('20');
    expect(new Set(s.items().map((i) => i.getId()))).toEqual(new Set([copyA, copyC]));
    expect(undoSteps()).toEqual(['Duplicate']);
    DocumentUndo.undo(doc);
    expect(order()).toEqual(['a', 'b', 'd', 'c']);
  });
});

describe('ObjectSet.group and ungroup', () => {
  it('groups siblings at the place of the topmost one, keeping their order', () => {
    const { select, order, item } = open(STACK);
    const s = select('b', 'a');
    const group = s.group();
    const gid = group?.attribute('id') ?? '';
    expect(order()).toEqual([gid, 'd', 'c']);
    expect(order(gid)).toEqual(['a', 'b']);
    expect(s.single()).toBe(item(gid));
  });

  it('moves objects of other parents into the group with their full transform and inherited style', () => {
    const { doc, select, order, item } = open(
      '<g id="g" transform="translate(50,0)" style="fill:red"><rect id="a" x="0" y="0" width="10" height="10"/></g>' +
        '<rect id="b" x="0" y="0" width="10" height="10"/>',
    );
    const before = item('a').documentVisualBounds();
    const group = select('a', 'b').group();
    const gid = group?.attribute('id') ?? '';
    // The group goes into the parent of the topmost object (b).
    expect(order()).toEqual(['g', gid]);
    expect(order(gid)).toEqual(['a', 'b']);
    doc.ensureUpToDate();
    expect(item('a').documentVisualBounds()).toEqual(before);
    expect(item('a').getRepr().attribute('style')).toContain('fill:red');
  });

  it('ungroups with the group transform and style merged into the children, at the group place', () => {
    const { doc, select, order, item, undoSteps } = open(
      '<rect id="a" x="0" y="0" width="10" height="10"/>' +
        '<g id="g" transform="translate(50,5)" style="fill:red">' +
        '<rect id="b" x="0" y="0" width="10" height="10"/><rect id="c" x="20" y="0" width="10" height="10" style="fill:blue"/>' +
        '</g><rect id="d" x="0" y="50" width="10" height="10"/>',
    );
    const bounds = [item('b').documentVisualBounds(), item('c').documentVisualBounds()];
    const s = select('g');
    s.ungroup();
    doc.ensureUpToDate();
    expect(doc.getObjectById('g')).toBeNull();
    expect(order()).toEqual(['a', 'b', 'c', 'd']);
    expect([item('b').documentVisualBounds(), item('c').documentVisualBounds()]).toEqual(bounds);
    expect(item('b').getRepr().attribute('style')).toContain('fill:red');
    expect(item('c').getRepr().attribute('style')).toContain('fill:blue');
    expect(new Set(s.items().map((i) => i.getId()))).toEqual(new Set(['b', 'c']));
    expect(undoSteps()).toEqual(['Ungroup']);
    DocumentUndo.undo(doc);
    expect(order()).toEqual(['a', 'g', 'd']);
    expect(order('g')).toEqual(['b', 'c']);
  });

  it('round-trips group and ungroup', () => {
    const { doc, select, order } = open(STACK);
    const s = select('a', 'b');
    s.group();
    DocumentUndo.done(doc, 'Group');
    expect(s.single()).toBeInstanceOf(SPGroup);
    s.ungroup();
    expect(order()).toEqual(['a', 'b', 'd', 'c']);
  });
});

describe('ObjectSet z-order', () => {
  it('raises above the next overlapping sibling and lowers below the previous one', () => {
    const { select, order, undoSteps } = open(STACK);
    // d does not overlap a, so a goes above b only.
    select('a').raise();
    expect(order()).toEqual(['b', 'a', 'd', 'c']);
    select('a').raise();
    expect(order()).toEqual(['b', 'd', 'c', 'a']);
    select('a').lower();
    expect(order()).toEqual(['b', 'd', 'a', 'c']);
    expect(undoSteps()).toEqual(['Raise', 'Raise', 'Lower']);
  });

  it('raises to top and lowers to bottom, keeping the order of the selection', () => {
    const { doc, select, order, undoSteps } = open(STACK);
    select('b', 'a').raiseToTop();
    expect(order()).toEqual(['d', 'c', 'a', 'b']);
    select('c', 'b').lowerToBottom();
    expect(order()).toEqual(['c', 'b', 'd', 'a']);
    // Non-items (defs) stay below.
    expect(doc.getReprRoot().firstChild()?.name()).toBe('svg:defs');
    expect(undoSteps()).toEqual(['Raise to top', 'Lower to bottom']);
  });

  it('does nothing for objects of different parents', () => {
    const { select, order, undoSteps } = open(
      '<rect id="a" width="5" height="5"/><g id="g"><rect id="b" width="5" height="5"/></g>',
    );
    select('a', 'b').raiseToTop();
    expect(order()).toEqual(['a', 'g']);
    expect(undoSteps()).toEqual([]);
  });
});

describe('Selection.rotateAnchored', () => {
  it('rotates 90° around the center and merges steps in the same direction', () => {
    const { doc, select, item, undoSteps } = open('<rect id="a" x="0" y="0" width="40" height="20"/>');
    const s = select('a');
    s.rotateAnchored(90);
    doc.ensureUpToDate();
    const b = item('a').documentVisualBounds();
    expect([b?.left(), b?.top(), b?.right(), b?.bottom()].map((v) => Math.round(v ?? NaN))).toEqual([
      10, -10, 30, 30,
    ]);
    s.rotateAnchored(90);
    expect(undoSteps()).toEqual(['Rotate 90° CW']);
    s.rotateAnchored(-90);
    expect(undoSteps()).toEqual(['Rotate 90° CW', 'Rotate 90° CCW']);
  });
});
