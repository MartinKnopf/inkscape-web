// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-object-align.cpp
import { ObjectSet, Preferences, SPDocument, type SPItem } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { object_align, object_distribute } from './actions-object-align.ts';

// Three rects without stroke: visual and geometric bounds are the same.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
  '<rect id="a" x="0" y="0" width="10" height="10"/>' +
  '<rect id="b" x="30" y="20" width="20" height="20"/>' +
  '<rect id="c" x="90" y="5" width="10" height="40" transform="translate(10,0)"/>' +
  '</svg>';

function setup(...ids: string[]) {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const set = new ObjectSet(doc);
  set.setList(ids.map((id) => doc.getObjectById(id)).filter((o) => o !== null));
  /** Bounds [left, top, right, bottom] of the item with id. */
  const box = (id: string) => {
    doc.ensureUpToDate();
    const b = (doc.getObjectById(id) as SPItem).desktopPreferredBounds();
    return b && [b.left(), b.top(), b.right(), b.bottom()];
  };
  const undo = () => doc.undoStack.undo.map((s) => s.description);
  return { doc, set, box, undo };
}

describe('object_align', () => {
  it('aligns left edges to the selection bounds', () => {
    const { set, box, undo } = setup('a', 'b', 'c');
    object_align(set, 'left selection');
    expect([box('a'), box('b'), box('c')]).toEqual([
      [0, 0, 10, 10],
      [0, 20, 20, 40],
      [0, 5, 10, 45],
    ]);
    expect(undo()).toEqual(['Align']);
  });

  it('aligns to the last selected item, which does not move', () => {
    const { set, box } = setup('a', 'c', 'b');
    object_align(set, 'right bottom last');
    expect(box('b')).toEqual([30, 20, 50, 40]);
    expect(box('a')).toEqual([40, 30, 50, 40]);
    expect(box('c')).toEqual([40, 0, 50, 40]);
  });

  it('centers on the page', () => {
    const { set, box } = setup('a', 'b');
    object_align(set, 'hcenter vcenter page');
    expect(box('a')).toEqual([95, 45, 105, 55]);
    expect(box('b')).toEqual([90, 40, 110, 60]);
  });

  it('moves the selection as a group', () => {
    const { set, box } = setup('a', 'b');
    object_align(set, 'right page group');
    expect(box('a')).toEqual([150, 0, 160, 10]);
    expect(box('b')).toEqual([180, 20, 200, 40]);
  });

  it('puts the items beside the anchor', () => {
    const { set, box } = setup('a', 'b');
    object_align(set, 'left anchor first');
    // b's left edge goes to a's right edge; with 'right anchor' its right edge to a's left edge.
    expect(box('b')).toEqual([10, 20, 30, 40]);
  });

  it('takes the target and group from the preferences with "pref"', () => {
    const prefs = Preferences.get();
    prefs.setString('/dialogs/align/objects-align-to', 'biggest');
    try {
      const { set, box } = setup('a', 'b', 'c');
      // The biggest by width is b.
      object_align(set, 'top pref');
      expect(box('a')?.[1]).toBe(20);
      expect(box('c')?.[1]).toBe(20);
      expect(box('b')?.[1]).toBe(20);
    } finally {
      prefs.setString('/dialogs/align/objects-align-to', 'selection');
    }
  });

  it('makes no undo step if nothing moves', () => {
    const { set, undo } = setup('a');
    object_align(set, 'left selection');
    expect(undo()).toEqual([]);
  });
});

describe('object_distribute', () => {
  it('makes equal horizontal gaps', () => {
    const { set, box, undo } = setup('a', 'b', 'c');
    object_distribute(set, 'hgap');
    // Span 0..110, boxes take 40: gaps of 35.
    expect(box('a')).toEqual([0, 0, 10, 10]);
    expect(box('b')).toEqual([45, 20, 65, 40]);
    expect(box('c')).toEqual([100, 5, 110, 45]);
    expect(undo()).toEqual(['Distribute']);
  });

  it('makes equal distances between centers', () => {
    const { set, box } = setup('c', 'a', 'b');
    object_distribute(set, 'hcenter');
    // Centers 5..105: b's center goes to 55.
    expect(box('b')).toEqual([45, 20, 65, 40]);
  });

  it('makes equal distances between bottom edges', () => {
    const { set, box } = setup('a', 'b', 'c');
    object_distribute(set, 'bottom');
    // Bottoms 10, 40, 45 → 10, 27.5, 45
    expect(box('b')).toEqual([30, 7.5, 50, 27.5]);
  });
});
