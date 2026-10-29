// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/undo-history.cpp, src/event-log.cpp
import { DocumentUndo, SPDocument } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import {
  undoHistoryParent,
  undoHistoryPosition,
  undoHistoryRows,
  undoHistorySeek,
  undoHistoryTarget,
} from './undo-history.ts';

SPDocument.scheduleIdle = () => {};

/** A document with one step per [description, icon] and the width of the rect after each step. */
function documentWithSteps(steps: [description: string, icon: string][]) {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a" width="0" height="10"/></svg>',
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const rect = doc.getObjectById('a')?.getRepr();
  steps.forEach(([description, icon], i) => {
    rect?.setAttribute('width', String(i + 1));
    DocumentUndo.done(doc, description, icon);
  });
  const width = () => rect?.attribute('width');
  return { doc, width };
}

describe('undo history', () => {
  it('lists the events with the first row and groups runs of the same icon', () => {
    const { doc } = documentWithSteps([
      ['Move', 'tool-pointer'],
      ['Move', 'tool-pointer'],
      ['Move', 'tool-pointer'],
      ['Rotate', 'dialog-transform'],
    ]);
    const rows = undoHistoryRows(doc);
    expect(rows.map((r) => [r.position, r.description, r.childCount])).toEqual([
      [0, '[No more changes]', 0],
      [1, 'Move', 3],
      [4, 'Rotate', 1],
    ]);
    expect(rows[1]?.children.map((c) => c.position)).toEqual([2, 3]);
    expect(undoHistoryPosition(doc)).toBe(4);
    expect(undoHistoryParent(rows, 3)?.position).toBe(1);
  });

  it('seeks back and forth over several steps', () => {
    const { doc, width } = documentWithSteps([
      ['A', 'x'],
      ['B', 'y'],
      ['C', 'z'],
    ]);
    undoHistorySeek(doc, 1);
    expect(width()).toBe('1');
    expect(doc.undoStack.redo.length).toBe(2);
    // The redo steps are listed after the current one.
    expect(undoHistoryRows(doc).map((r) => r.description)).toEqual(['[No more changes]', 'A', 'B', 'C']);
    undoHistorySeek(doc, 3);
    expect(width()).toBe('3');
    undoHistorySeek(doc, 0);
    expect(width()).toBe('0');
    expect(undoHistoryPosition(doc)).toBe(0);
  });

  it('selecting a collapsed group goes to its last event', () => {
    const { doc } = documentWithSteps([
      ['Move', 'tool-pointer'],
      ['Move', 'tool-pointer'],
      ['Move', 'tool-pointer'],
    ]);
    undoHistorySeek(doc, 0);
    const group = undoHistoryRows(doc)[1];
    if (!group) throw new Error('no group');
    expect(undoHistoryTarget(group, false)).toBe(3);
    expect(undoHistoryTarget(group, true)).toBe(1);
  });

  it('tells subscribers when the stacks change', () => {
    const { doc } = documentWithSteps([['A', 'x']]);
    let calls = 0;
    doc.undoStackChangedSignal.connect(() => calls++);
    DocumentUndo.undo(doc);
    DocumentUndo.redo(doc);
    expect(calls).toBe(2);
  });
});
