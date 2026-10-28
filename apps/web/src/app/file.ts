// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/file.cpp, src/file.h, src/extension/system.cpp, src/extension/internal/svg.cpp, src/actions/actions-file-gui.cpp
/*
 * File operations.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Chema Celorio <chema@celorio.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Bruno Dilly <bruno.dilly@gmail.com>
 *   Stephen Silver <sasilver@users.sourceforge.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Tavmjong Bah
 *
 * Copyright (C) 2006 Johan Engelen <johan@shouraizou.nl>
 * Copyright (C) 1999-2016 Authors
 * Copyright (C) 2004 David Turner
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { _, DocumentUndo, gdkpixbuf_input_open, SPDocument, SVG_NS_URI, saveBuf } from '@inkscape-web/core';
import { file_import, type SPDesktop } from '@inkscape-web/editor';
import { decodeSvgBytes, gzip } from './gzip.ts';

/** The part of FileSystemFileHandle that we use. */
interface FileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}

interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface FilePickers {
  showOpenFilePicker(options: { types: FilePickerType[] }): Promise<FileHandle[]>;
  showSaveFilePicker(options: { suggestedName: string; types: FilePickerType[] }): Promise<FileHandle>;
}

/** Handles of the files that documents were opened from or saved to. */
const fileHandles = new WeakMap<SPDocument, FileHandle>();

let docCount = 0;

/** Output formats (upstream org.inkscape.output.svg.inkscape and .svgz). */
const SVG_TYPE = (): FilePickerType => ({
  description: _('Inkscape SVG (*.svg)'),
  accept: { 'image/svg+xml': ['.svg'] },
});
const SVGZ_TYPE = (): FilePickerType => ({
  description: _('Compressed Inkscape SVG (*.svgz)'),
  accept: { 'image/svg+xml-compressed': ['.svgz'] },
});

/**
 * A new document from the default template (share/templates/default.svg from
 * the assets). TODO: the localized default.<lang>.svg and the
 * /templates/default preference.
 */
export async function sp_file_new_default(): Promise<SPDocument> {
  const response = await fetch('/share/templates/default.svg');
  const doc = SPDocument.createNewDocFromMem(await response.text());
  if (!doc) throw new Error('default template is not valid SVG');
  // Upstream SPDocument::createNewDoc with make_new.
  doc.documentName = _('New document %d').replace('%d', String(++docCount));
  return doc;
}

/**
 * Ask the user for an SVG or SVGZ file and open it. Returns null if the user
 * cancels or the file is not SVG. Uses the File System Access API, with an
 * <input type=file> fallback. The file handle is kept for saving.
 * TODO: other import formats.
 */
export async function sp_file_open_dialog(): Promise<SPDocument | null> {
  const picked = await pickFile();
  if (!picked) return null;
  const { file, handle } = picked;
  const text = await decodeSvgBytes(new Uint8Array(await file.arrayBuffer()));
  const doc = SPDocument.createNewDocFromMem(text, file.name);
  if (!doc) {
    alert(_('Failed to load the requested file %s').replace('%s', file.name));
    return null;
  }
  if (handle) fileHandles.set(doc, handle);
  return doc;
}

/** Input formats for import: SVG and the bitmaps that the browser shows (upstream GdkpixbufInput). */
const IMPORT_TYPE = (): FilePickerType => ({
  description: _('Images'),
  accept: {
    'image/svg+xml': ['.svg', '.svgz'],
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
  },
});

async function pickFile(
  types: FilePickerType[] = [SVG_TYPE(), SVGZ_TYPE()],
): Promise<{ file: File; handle: FileHandle | null } | null> {
  const w = window as Window & Partial<FilePickers>;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types });
      return handle ? { file: await handle.getFile(), handle } : null;
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = types.flatMap((t) => Object.entries(t.accept).flat(2)).join(',');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      resolve(file ? { file, handle: null } : null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * win.document-import (upstream document_import and file_import): ask for an
 * SVG or bitmap file and import it at the pointer. An SVG file becomes a
 * group; a bitmap an embedded image.
 */
export async function sp_file_import(desktop: SPDesktop): Promise<void> {
  const picked = await pickFile([IMPORT_TYPE()]);
  if (!picked) return;
  const { file } = picked;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = gdkpixbuf_input_open(bytes);
  const doc = image ?? SPDocument.createNewDocFromMem(await decodeSvgBytes(bytes), file.name);
  if (!doc) {
    alert(_('Failed to load the requested file %s').replace('%s', file.name));
    return;
  }
  file_import(desktop.getDocument(), doc, !image, desktop);
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/** The file contents for name: Inkscape SVG, gzipped for .svgz. */
async function serialize(doc: SPDocument, name: string): Promise<Blob> {
  const text = saveBuf(doc.rdoc, SVG_NS_URI);
  const bytes = new TextEncoder().encode(text);
  return new Blob([name.toLowerCase().endsWith('.svgz') ? await gzip(bytes) : bytes], {
    type: 'image/svg+xml',
  });
}

/**
 * Write doc as name (upstream Inkscape::Extension::save with the Inkscape SVG
 * output): the document gets the new name and is no longer modified.
 * TODO: rebase relative hrefs (changeFilenameAndHrefs), remember the output
 * extension in the preferences.
 */
async function file_save(doc: SPDocument, name: string, write: (data: Blob) => Promise<void>): Promise<void> {
  // The SVG output is not lossy.
  DocumentUndo.scopedInsensitive(doc, () => doc.rroot.removeAttribute('inkscape:dataloss'));
  await write(await serialize(doc, name));
  doc.documentFilename = name;
  doc.documentName = name;
  doc.setModifiedSinceSave(false);
}

/** Write through a file handle. Returns false and tells the user on failure. */
async function saveToHandle(doc: SPDocument, handle: FileHandle): Promise<boolean> {
  try {
    await file_save(doc, handle.name, async (data) => {
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    });
  } catch (e) {
    console.error(e);
    alert(_('File %s could not be saved.').replace('%s', handle.name));
    return false;
  }
  fileHandles.set(doc, handle);
  return true;
}

/** Offer data as a download (no File System Access API). */
async function download(data: Blob, name: string): Promise<void> {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

/**
 * Upstream sp_file_save_dialog: ask for a name and save. Returns true if the
 * document was saved. Without the File System Access API the file is
 * downloaded under the current name.
 */
export async function sp_file_save_dialog(doc: SPDocument): Promise<boolean> {
  const suggestedName = doc.documentName?.includes('.')
    ? doc.documentName
    : `${doc.documentName ?? 'drawing'}.svg`;
  const w = window as Window & Partial<FilePickers>;
  if (!w.showSaveFilePicker) {
    await file_save(doc, suggestedName, (data) => download(data, suggestedName));
    return true;
  }
  let handle: FileHandle;
  try {
    handle = await w.showSaveFilePicker({ suggestedName, types: [SVG_TYPE(), SVGZ_TYPE()] });
  } catch (e) {
    if (isAbort(e)) return false;
    throw e;
  }
  return saveToHandle(doc, handle);
}

/**
 * win.document-save (upstream sp_file_save_document): save to the file of the
 * document, or ask for a file if it has none. Returns true if saved.
 */
export async function sp_file_save(doc: SPDocument): Promise<boolean> {
  const handle = fileHandles.get(doc);
  if (handle) return saveToHandle(doc, handle);
  return sp_file_save_dialog(doc);
}

/** win.document-save-as (upstream sp_file_save_as): always ask for a file. */
export function sp_file_save_as(doc: SPDocument): Promise<boolean> {
  return sp_file_save_dialog(doc);
}
