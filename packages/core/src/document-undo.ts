// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/document-undo.cpp, src/document-undo.h, src/event.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   MenTaLguY <mental@rydia.net>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2003 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import type { SPDocument } from './document.ts';
import { type Event, type EventLog, replayLog, undoLog } from './xml/event.ts';

/** One undo step (upstream Inkscape::Event). */
export interface UndoEvent {
  event: Event[];
  description: string;
  iconName: string;
}

/** Undo state of a document (fields of upstream SPDocument). */
export interface UndoStack {
  undo: UndoEvent[];
  redo: UndoEvent[];
  /** Changes made while undo was insensitive; added to the next step. */
  partial: Event[];
  actionKey: string | null;
  undoTime: number | null;
  sensitive: boolean;
  seeking: boolean;
  /** True until the first undo step. */
  virgin: boolean;
}

/** Steps with the same key within this time are merged (upstream action_expires). */
const ACTION_EXPIRES_MS = 10_000;
const UNDO_LIMIT = 200;

/**
 * Undo and redo for documents. Every change of the repr tree is recorded in
 * an open transaction; done() closes it as one undo step.
 */
export const DocumentUndo = {
  /** While insensitive, changes are not recorded as separate steps. */
  setUndoSensitive(doc: SPDocument, sensitive: boolean): void {
    const s = doc.undoStack;
    if (sensitive === s.sensitive) return;
    if (sensitive) doc.rdoc.beginTransaction();
    else s.partial.push(...doc.rdoc.commitUndoable());
    s.sensitive = sensitive;
  },

  getUndoSensitive(doc: SPDocument): boolean {
    return doc.undoStack.sensitive;
  },

  /** Run fn without recording undo steps (upstream ScopedInsensitive). */
  scopedInsensitive<T>(doc: SPDocument, fn: () => T): T {
    const was = doc.undoStack.sensitive;
    DocumentUndo.setUndoSensitive(doc, false);
    try {
      return fn();
    } finally {
      DocumentUndo.setUndoSensitive(doc, was);
    }
  },

  /** Close the current changes as an undo step. */
  done(doc: SPDocument, description: string, iconName = ''): void {
    if (doc.undoStack.sensitive) DocumentUndo.maybeDone(doc, null, description, iconName);
  },

  /**
   * Like done(), but merge with the previous step if it has the same key and
   * is less than 10 s old (e.g. repeated arrow-key moves).
   */
  maybeDone(doc: SPDocument, key: string | null, description: string, iconName = ''): void {
    maybeDoneInternal(doc, key, description, iconName, false);
  },

  resetKey(doc: SPDocument): void {
    doc.undoStack.actionKey = null;
  },

  /** Revert the changes since the last step. */
  cancel(doc: SPDocument): void {
    maybeDoneInternal(doc, null, 'undozone', '', true);
    if (doc.undoStack.undo.at(-1)?.description === 'undozone') undoInternal(doc, true);
  },

  undo(doc: SPDocument): boolean {
    return undoInternal(doc, false);
  },

  redo(doc: SPDocument): boolean {
    const s = doc.undoStack;
    s.sensitive = false;
    s.seeking = true;
    finishIncompleteTransaction(doc);
    const step = s.redo.pop();
    if (step) {
      replayLog(step.event);
      s.undo.push(step);
      performDocumentUpdate(doc);
      doc.setModifiedSinceSave();
    }
    doc.rdoc.beginTransaction();
    s.sensitive = true;
    s.seeking = false;
    return step !== undefined;
  },

  clearUndo(doc: SPDocument): void {
    doc.undoStack.undo = [];
  },

  clearRedo(doc: SPDocument): void {
    doc.undoStack.redo = [];
  },
};

function maybeDoneInternal(
  doc: SPDocument,
  key: string | null,
  description: string,
  iconName: string,
  temporary: boolean,
): void {
  const s = doc.undoStack;
  if (!s.sensitive) throw new Error('maybeDone on an insensitive document');
  doc.collectOrphans();
  doc.ensureUpToDate();
  if (!temporary) DocumentUndo.clearRedo(doc);
  const log = [...s.partial, ...doc.rdoc.commitUndoable()];
  s.partial = [];
  if (!log.length) {
    doc.rdoc.beginTransaction();
    return;
  }
  const now = Date.now();
  const expired = s.undoTime !== null && now - s.undoTime > ACTION_EXPIRES_MS;
  const last = s.undo.at(-1);
  if (key && !expired && s.actionKey === key && last) {
    last.event.push(...log);
  } else {
    s.undo.push({ event: log, description, iconName });
  }
  s.actionKey = key;
  s.undoTime = key ? now : null;
  s.virgin = false;
  doc.setModifiedSinceSave();
  doc.rdoc.beginTransaction();
  doc.commitSignal.emit();
  if (!key) while (s.undo.length > UNDO_LIMIT) s.undo.shift();
}

function undoInternal(doc: SPDocument, temporary: boolean): boolean {
  const s = doc.undoStack;
  s.sensitive = false;
  s.seeking = true;
  finishIncompleteTransaction(doc);
  const step = s.undo.pop();
  if (step) {
    undoLog(step.event);
    performDocumentUpdate(doc);
    if (!temporary) {
      s.redo.push(step);
      doc.setModifiedSinceSave();
    }
  }
  doc.rdoc.beginTransaction();
  s.sensitive = true;
  s.seeking = false;
  return step !== undefined;
}

/** Changes made outside done() are added to the last step. */
function finishIncompleteTransaction(doc: SPDocument): void {
  const s = doc.undoStack;
  const log: EventLog = [...s.partial, ...doc.rdoc.commitUndoable()];
  if (log.length) {
    console.warn('Incomplete undo transaction (added to next undo)');
    s.undo.at(-1)?.event.push(...log);
  }
  s.partial = [];
}

/** Update the objects after undo/redo. Changes made by the update join the last step. */
function performDocumentUpdate(doc: SPDocument): void {
  doc.rdoc.beginTransaction();
  doc.ensureUpToDate();
  const log = doc.rdoc.commitUndoable();
  if (log.length) {
    console.warn('Document was modified while being updated after undo operation');
    doc.undoStack.undo.at(-1)?.event.push(...log);
  }
}
