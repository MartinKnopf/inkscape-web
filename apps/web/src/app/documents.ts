// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/inkscape-application.cpp, src/ui/desktop/document-check.cpp, src/actions/actions-file-gui.cpp
// The open documents. Upstream shows each document in its own window; the web
// app shows each in its own tab of the dockview and makes the desktop of the
// focused tab the active desktop.
import { _, C_, Preferences, Signal, SPDocument, SVG_NS_URI, saveBuf } from '@inkscape-web/core';
import type { SPDesktop } from '@inkscape-web/editor';
import type { DockviewApi } from 'dockview-react';
import { showMessageDialog } from '../ui/dialog/message-dialog.tsx';
import { setActiveDesktop } from './active-desktop.ts';
import { AutoSave, type AutoSaveRecord } from './autosave.ts';
import { sp_file_new_default, sp_file_save } from './file.ts';
import { indexedDbStore } from './kv-store.ts';
import { tabTitle } from './title.ts';

/** A document with the tab that shows it. */
export interface DocumentWindow {
  /** Id of the dockview panel. */
  readonly id: string;
  readonly doc: SPDocument;
  /** Set by the drawing panel while it is mounted. */
  desktop: SPDesktop | null;
}

/** The panel ids of documents start with this; dialogs have their dialog key as id. */
const PANEL_PREFIX = 'doc-';

const windows = new Map<string, DocumentWindow>();
let dock: DockviewApi | null = null;
let activeId: string | null = null;
let counter = 0;
/** Emitted when a document is opened or closed. */
export const documentsChanged = new Signal<[]>();

export function isDocumentPanel(panelId: string): boolean {
  return panelId.startsWith(PANEL_PREFIX);
}

export function getDocumentWindow(panelId: string): DocumentWindow | undefined {
  return windows.get(panelId);
}

/** The open documents, in the order they were opened. */
export function getDocuments(): SPDocument[] {
  return [...windows.values()].map((w) => w.doc);
}

/** The id of a document panel to put dialogs beside, if any is open. */
export function getDocumentAnchor(api: DockviewApi): string | undefined {
  return api.panels.find((p) => isDocumentPanel(p.id))?.id;
}

function applyActive(): void {
  setActiveDesktop((activeId && windows.get(activeId)?.desktop) || null);
}

/**
 * Use api as the dockview for the documents. The desktop of the focused
 * document tab becomes the active desktop; focusing a dialog keeps it.
 * Returns a function that undoes it.
 */
export function setDocumentDock(api: DockviewApi | null): () => void {
  dock = api;
  if (!api) return () => {};
  const subs = [
    api.onDidActivePanelChange((e) => {
      if (e.panel && isDocumentPanel(e.panel.id)) {
        activeId = e.panel.id;
        applyActive();
      }
    }),
    api.onDidRemovePanel((panel) => {
      const win = windows.get(panel.id);
      if (!win) return;
      windows.delete(panel.id);
      void autosave().discard(win.doc);
      if (activeId === panel.id) {
        activeId = null;
        applyActive();
      }
      documentsChanged.emit();
    }),
  ];
  return () => {
    for (const s of subs) s.dispose();
    if (dock === api) dock = null;
  };
}

/** Called by the drawing panel when its desktop exists (or is destroyed). */
export function registerDesktop(panelId: string, desktop: SPDesktop | null): void {
  const win = windows.get(panelId);
  if (!win) return;
  win.desktop = desktop;
  if (activeId === panelId) applyActive();
}

/** Show doc in a new tab (upstream InkscapeApplication::create_window). Returns the panel id. */
export function openDocumentWindow(doc: SPDocument): string {
  const api = dock;
  if (!api) throw new Error('openDocumentWindow: the dockview is not ready');
  const id = `${PANEL_PREFIX}${++counter}`;
  const win: DocumentWindow = { id, doc, desktop: null };
  windows.set(id, win);
  const anchor = getDocumentAnchor(api);
  const panel = api.addPanel({
    id,
    component: 'drawing',
    tabComponent: 'document',
    title: tabTitle(doc.documentName ?? '', doc.modifiedSinceSave),
    // The canvas keeps its state while another tab is shown.
    renderer: 'always',
    ...(anchor && { position: { referencePanel: anchor } }),
  });
  // Keep the tab title and the autosave in step with the document.
  doc.modifiedSinceSaveSignal.connect((modified) => {
    panel.api.setTitle(tabTitle(doc.documentName ?? '', modified));
    // Saved: nothing is left to recover.
    if (!modified) void autosave().discard(doc);
  });
  documentsChanged.emit();
  return id;
}

/** A new document from the default template in a new tab (action app.document-new). */
export async function document_new(): Promise<string> {
  return openDocumentWindow(await sp_file_new_default());
}

/**
 * Upstream document_check_for_data_loss: if doc is modified, ask whether to
 * save it. Returns true if the document should remain open.
 */
export async function document_check_for_data_loss(doc: SPDocument): Promise<boolean> {
  if (!doc.modifiedSinceSave) return false;
  // Show the document that the question is about.
  for (const [id, win] of windows) if (win.doc === doc) dock?.getPanel(id)?.api.setActive();
  const response = await showMessageDialog({
    title: _('Save Document'),
    message: _(
      'Save changes to document "%s" before closing?\n\nIf you close without saving, your changes will be discarded.',
    ).replace('%s', doc.documentName ?? ''),
    buttons: [
      { id: 'no', label: _('Close _without saving') },
      { id: 'cancel', label: _('_Cancel') },
      { id: 'yes', label: _('_Save') },
    ],
    cancel: 'cancel',
    default: 'yes',
  });
  if (response === 'no') return false;
  if (response === 'yes') return !(await sp_file_save(doc));
  return true;
}

/**
 * Close a tab after the data loss check (upstream document_close, action
 * win.document-close). The last tab stays open with a new document, as
 * upstream keeps the window. Returns false if the user cancelled.
 */
export async function document_close(panelId: string): Promise<boolean> {
  const win = windows.get(panelId);
  if (!win) return true;
  if (await document_check_for_data_loss(win.doc)) return false;
  if (windows.size === 1) await document_new();
  dock?.getPanel(panelId)?.api.close();
  return true;
}

/** Close the focused tab (action win.document-close). */
export async function document_close_active(): Promise<void> {
  if (activeId) await document_close(activeId);
}

/**
 * Action app.quit (upstream InkscapeApplication::on_quit and destroy_all): close
 * every document after the data loss check; stop when the user cancels one.
 * A browser page cannot always close itself, so the app stays with a new document.
 */
export async function app_quit(): Promise<void> {
  for (const id of [...windows.keys()]) {
    const win = windows.get(id);
    if (!win) continue;
    if (await document_check_for_data_loss(win.doc)) return;
    // The data loss is accepted: no reason to recover this document.
    win.doc.setModifiedSinceSave(false);
  }
  await document_new();
  for (const id of [...windows.keys()].slice(0, -1)) dock?.getPanel(id)?.api.close();
  window.close();
}

/** Ask the browser to confirm leaving the page when a document is modified. */
export function warnBeforeUnload(): () => void {
  const handler = (e: BeforeUnloadEvent) => {
    if (getDocuments().some((d) => d.modifiedSinceSave)) e.preventDefault();
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}

// ---------------------------------------------------------------- autosave

let autosaveInstance: AutoSave | null = null;

/** The autosave of the open documents (records in IndexedDB). */
export function autosave(): AutoSave {
  autosaveInstance ??= new AutoSave({
    store: indexedDbStore<AutoSaveRecord>('autosave'),
    getDocuments,
    serialize: (doc) => saveBuf((doc as SPDocument).rdoc, SVG_NS_URI),
    onError: (doc, e) =>
      console.error(
        _('Autosave failed! File %s could not be saved.').replace('%s', doc.documentName ?? ''),
        e,
      ),
  });
  return autosaveInstance;
}

/** Start the autosave timer, and restart it when its preferences change (upstream AutoSave::restart). */
export function startAutoSave(): () => void {
  const service = autosave();
  service.start();
  const off = Preferences.get().changedSignal.connect((path) => {
    if (path.startsWith('/options/autosave/')) service.start();
  });
  return () => {
    off();
    service.stop();
  };
}

let restoreAsked = false;

/**
 * Offer to open the documents that earlier sessions autosaved and did not
 * save or close (after a crash or a closed tab). Restored documents are open
 * as modified documents without a file. The unmodified start document
 * initialId is closed then.
 */
export async function restoreAutosaved(initialId?: string): Promise<void> {
  if (restoreAsked) return;
  restoreAsked = true;
  const service = autosave();
  const records = await service.pending();
  if (records.length === 0) return;
  const list = records.map((r) => `  ${r.name} (${new Date(r.time).toLocaleString()})`).join('\n');
  const response = await showMessageDialog({
    title: C_('Autosave', 'Recover documents'),
    message: `${_('Automatic backups of unsaved documents were done to the following locations:\n').trim()}\n\n${list}`,
    buttons: [
      { id: 'discard', label: _('_Discard') },
      { id: 'restore', label: _('_Restore') },
    ],
    cancel: 'discard',
    default: 'restore',
  });
  if (response === 'restore') {
    for (const r of records) {
      const doc = SPDocument.createNewDocFromMem(r.svg, r.filename ?? undefined);
      if (!doc) continue;
      doc.documentName = r.name;
      doc.setModifiedSinceSave(true);
      openDocumentWindow(doc);
    }
    const initial = initialId ? windows.get(initialId) : undefined;
    if (initial && !initial.doc.modifiedSinceSave) dock?.getPanel(initial.id)?.api.close();
    // Store the restored documents again before the old records go.
    await service.save();
  }
  await service.discardRecords(records);
}
