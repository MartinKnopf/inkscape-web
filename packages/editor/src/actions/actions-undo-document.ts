// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-undo-document.cpp, src/actions/actions-undo-document.h
/*
 *  Actions for Undo/Redo tied to document.
 *
 * Authors:
 *   Tavmjong Bah
 *
 * Copyright (C) 2021 Authors
 */
import { DocumentUndo, N_, NC_, type SPDocument } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';

const SECTION = NC_('Action Section', 'Edit Document');

export const raw_data_undo_document: readonly (readonly [string, string, string, string])[] = [
  ['doc.undo', N_('Undo'), SECTION, N_('Undo last action')],
  ['doc.redo', N_('Redo'), SECTION, N_('Do again the last undone action')],
];

/**
 * Register doc.undo and doc.redo for the active document; they are enabled
 * when the document has steps to undo or redo (upstream enable_undo_actions).
 * TODO: no undo while the canvas is dragging.
 */
export function add_actions_undo_document(app: InkscapeApplication): void {
  const undo = app.actions.doc.add_action('undo', () => {
    const doc = app.get_active_document();
    if (doc) DocumentUndo.undo(doc);
  });
  const redo = app.actions.doc.add_action('redo', () => {
    const doc = app.get_active_document();
    if (doc) DocumentUndo.redo(doc);
  });

  const update = () => {
    const doc = app.get_active_document();
    undo.set_enabled(!!doc?.undoStack.undo.length);
    redo.set_enabled(!!doc?.undoStack.redo.length);
  };
  let disconnect: (() => void)[] = [];
  let watched: SPDocument | null = null;
  app.signal_active_changed.connect(() => {
    const doc = app.get_active_document();
    if (doc !== watched) {
      for (const off of disconnect) off();
      watched = doc;
      disconnect = doc ? [doc.commitSignal.connect(update), doc.modifiedSinceSaveSignal.connect(update)] : [];
    }
    update();
  });
  update();
  app.get_action_extra_data().add_data(raw_data_undo_document);
}
