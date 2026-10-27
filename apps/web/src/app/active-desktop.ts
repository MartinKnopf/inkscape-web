// SPDX-License-Identifier: GPL-2.0-or-later
// The desktop that menus and the status bar act on (upstream: the active
// desktop of InkscapeApplication). There is one desktop for now.
import { Signal, type SPDocument } from '@inkscape-web/core';
import type { SPDesktop } from '@inkscape-web/editor';
import { useSyncExternalStore } from 'react';
import { documentTitle } from './title.ts';

let active: SPDesktop | null = null;
const changed = new Signal<[]>();

export function getActiveDesktop(): SPDesktop | null {
  return active;
}

export function setActiveDesktop(desktop: SPDesktop | null): void {
  active = desktop;
  changed.emit();
}

/** Show doc in desktop (upstream InkscapeApplication::swap_document). */
export function replaceDocument(desktop: SPDesktop, doc: SPDocument): void {
  desktop.setDocument(doc);
  changed.emit();
}

export function useActiveDesktop(): SPDesktop | null {
  return useSyncExternalStore((cb) => changed.connect(cb), getActiveDesktop);
}

/** The document of the active desktop (changes with replaceDocument). */
export function useActiveDocument(): SPDocument | null {
  return useSyncExternalStore(
    (cb) => changed.connect(cb),
    () => active?.doc ?? null,
  );
}

/** The zoom factor of desktop (1 is 100%). */
export function useZoom(desktop: SPDesktop | null): number {
  return useSyncExternalStore(
    (cb) => desktop?.signal_zoom_changed.connect(cb) ?? (() => {}),
    () => desktop?.current_zoom() ?? 1,
  );
}

/** The window title of doc: its name and modified flag. */
export function useDocumentTitle(doc: SPDocument | null): string {
  return useSyncExternalStore(
    (cb) => doc?.modifiedSinceSaveSignal.connect(cb) ?? (() => {}),
    () => (doc ? documentTitle(doc.documentName ?? '', doc.modifiedSinceSave) : 'Inkscape'),
  );
}

/** Whether doc has steps to undo and to redo (for doc.undo and doc.redo). */
export function useUndoState(doc: SPDocument | null): { canUndo: boolean; canRedo: boolean } {
  // Bit 0: undo, bit 1: redo. A number is a stable snapshot.
  const bits = useSyncExternalStore(
    (cb) => {
      if (!doc) return () => {};
      const off = [doc.commitSignal.connect(cb), doc.modifiedSinceSaveSignal.connect(cb)];
      return () => {
        for (const f of off) f();
      };
    },
    () => (doc ? (doc.undoStack.undo.length ? 1 : 0) | (doc.undoStack.redo.length ? 2 : 0) : 0),
  );
  return { canUndo: !!(bits & 1), canRedo: !!(bits & 2) };
}
