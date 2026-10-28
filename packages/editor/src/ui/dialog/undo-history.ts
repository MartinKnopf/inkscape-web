// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/undo-history.cpp, src/ui/dialog/undo-history.h, src/event-log.cpp, src/event-log.h
/*
 * Undo History dialog.
 *
 * Authors:
 *   Gustav Broberg <broberg@kth.se>
 *   Abhishek Sharma
 *
 * Copyright (C) 2014 Authors
 * Copyright (C) 2006 Authors
 */
import { _, DocumentUndo, type SPDocument } from '@inkscape-web/core';

/**
 * A row of the undo history. position is the number of undo steps that are
 * done when the document is at this row: 0 for "[No more changes]", i + 1 for
 * the i-th event.
 */
export interface UndoHistoryRow {
  position: number;
  description: string;
  iconName: string;
  /**
   * The number of events in the group of this row (the row itself and its
   * children); 0 for the first row.
   */
  childCount: number;
  /** The events after the first one of a run of events with the same icon. */
  children: UndoHistoryRow[];
}

/**
 * The rows of the history of doc (upstream EventLog): the first row "[No more
 * changes]", then the undo steps and the redo steps in order. A run of
 * consecutive events with the same icon is one row with the later events as
 * children.
 * TODO: "[Changes forgotten]" for steps that expired from the undo stack.
 */
export function undoHistoryRows(doc: SPDocument): UndoHistoryRow[] {
  const { undo, redo } = doc.undoStack;
  const events = [...undo, ...[...redo].reverse()];
  const rows: UndoHistoryRow[] = [
    {
      position: 0,
      description: _('[No more changes]'),
      iconName: 'document-new',
      childCount: 0,
      children: [],
    },
  ];
  events.forEach((event, i) => {
    const row: UndoHistoryRow = {
      position: i + 1,
      description: event.description,
      iconName: event.iconName,
      childCount: 1,
      children: [],
    };
    const last = rows[rows.length - 1] as UndoHistoryRow;
    if (last.position > 0 && last.iconName === event.iconName) {
      last.children.push(row);
      last.childCount++;
    } else {
      rows.push(row);
    }
  });
  return rows;
}

/** The position of the current row: the number of done undo steps. */
export function undoHistoryPosition(doc: SPDocument): number {
  return doc.undoStack.undo.length;
}

/** The row that holds position: the top row of its group. */
export function undoHistoryParent(rows: readonly UndoHistoryRow[], position: number): UndoHistoryRow | null {
  return rows.find((r) => r.position === position || r.children.some((c) => c.position === position)) ?? null;
}

/** The position to go to when the user selects row (a collapsed group means its last event). */
export function undoHistoryTarget(row: UndoHistoryRow, expanded: boolean): number {
  const last = row.children[row.children.length - 1];
  return last && !expanded ? last.position : row.position;
}

/**
 * Undo or redo until position steps are done (upstream EventLog::seekTo).
 * Stops if a step cannot be done.
 */
export function undoHistorySeek(doc: SPDocument, position: number): void {
  const total = doc.undoStack.undo.length + doc.undoStack.redo.length;
  const target = Math.max(0, Math.min(position, total));
  while (doc.undoStack.undo.length > target) if (!DocumentUndo.undo(doc)) return;
  while (doc.undoStack.undo.length < target) if (!DocumentUndo.redo(doc)) return;
}
