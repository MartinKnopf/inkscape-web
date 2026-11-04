// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-object-align.cpp
import { ObjectSet, Preferences, SPDocument, type SPItem, type SPText } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { useWasmBackend } from '../ui/tools/tool-test-utils.ts';
import {
  object_align,
  object_align_actions,
  object_align_text,
  object_distribute,
  object_distribute_text,
} from './actions-object-align.ts';

await useWasmBackend();

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

describe('object-rearrange', () => {
  it('exchange moves each item to the center of the previous one, the first to the one of the last', () => {
    const { set, box, undo } = setup('a', 'b', 'c');
    object_align_actions['object-rearrange']?.(set, 'exchange');
    expect(box('a')).toEqual([100, 20, 110, 30]); // the center of c
    expect(box('b')).toEqual([-5, -5, 15, 15]); // the center of a
    expect(box('c')).toEqual([35, 10, 45, 50]); // the center of b
    expect(undo()).toEqual(['Rearrange']);
  });

  it('does nothing for less than two items', () => {
    const { set, undo } = setup('a');
    object_align_actions['object-rearrange']?.(set, 'exchange');
    expect(undo()).toEqual([]);
  });
});

describe('object-remove-overlaps', () => {
  it('moves overlapping items apart by the gaps and keeps the others', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
        '<rect id="a" x="0" y="0" width="20" height="20"/>' +
        '<rect id="b" x="10" y="0" width="20" height="20"/>' +
        '<rect id="c" x="100" y="50" width="20" height="20"/></svg>',
    );
    if (!doc) throw new Error('parse failed');
    doc.ensureUpToDate();
    const set = new ObjectSet(doc);
    set.setList(['a', 'b', 'c'].map((id) => doc.getObjectById(id)).filter((o) => o !== null));
    object_align_actions['object-remove-overlaps']?.(set, '5,5');
    doc.ensureUpToDate();
    const a = (doc.getObjectById('a') as SPItem).desktopVisualBounds();
    const b = (doc.getObjectById('b') as SPItem).desktopVisualBounds();
    const c = (doc.getObjectById('c') as SPItem).desktopVisualBounds();
    // a and b are at least 5 apart, c has not moved.
    expect(
      Math.max(a?.left() ?? 0, b?.left() ?? 0) - Math.min(a?.right() ?? 0, b?.right() ?? 0),
    ).toBeGreaterThanOrEqual(5);
    expect([c?.left(), c?.top()]).toEqual([100, 50]);
    expect(doc.undoStack.undo.map((s) => s.description)).toEqual(['Remove overlaps']);
  });
});

describe('text alignment', () => {
  const TEXTS =
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
    '<text id="t1" x="10" y="50">A</text><text id="t2" x="40" y="80">BB</text>' +
    '<text id="t3" x="100" y="60" style="text-anchor:end;text-align:end">CCC</text><rect id="r" x="5" y="7" width="5" height="5"/></svg>';

  function texts(...ids: string[]) {
    const doc = SPDocument.createNewDocFromMem(TEXTS)!;
    doc.ensureUpToDate();
    const set = new ObjectSet(doc);
    set.setList(ids.map((id) => doc.getObjectById(id)!));
    /** The baseline anchor of a text in desktop coordinates. */
    const anchor = (id: string) => {
      doc.ensureUpToDate();
      const t = doc.getObjectById(id) as SPText;
      const p = t.layout.baselineAnchorPoint()!.transformed(t.i2dtAffine());
      return [Math.round(p.x), Math.round(p.y)];
    };
    return { doc, set, anchor, undo: () => doc.undoStack.undo.map((s) => s.description) };
  }

  it('aligns the baseline anchors to the first text, vertically', () => {
    const { set, anchor, undo } = texts('t1', 't2', 't3');
    object_align_text(set, 'vertical first');
    expect([anchor('t1'), anchor('t2'), anchor('t3')]).toEqual([
      [10, 50],
      [40, 50],
      [100, 50],
    ]);
    expect(undo()).toEqual(['Align']);
  });

  it('aligns horizontally to the minimum corner of a shape', () => {
    const { set, anchor } = texts('t1', 't3', 'r');
    object_align_text(set, 'horizontal last');
    expect([anchor('t1')[0], anchor('t3')[0]]).toEqual([5, 5]);
  });

  it('distributes the anchors evenly', () => {
    const { set, anchor, undo } = texts('t3', 't1', 't2');
    object_distribute_text(set, 'horizontal');
    expect([anchor('t1')[0], anchor('t2')[0], anchor('t3')[0]]).toEqual([10, 55, 100]);
    expect(undo()).toEqual(['Distribute']);
  });
});
