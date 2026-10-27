// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/file.cpp, src/file.h
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
import { _, SPDocument } from '@inkscape-web/core';

/**
 * A new document from the default template (share/templates/default.svg from
 * the assets). TODO: the localized default.<lang>.svg and the
 * /templates/default preference.
 */
export async function sp_file_new_default(): Promise<SPDocument> {
  const response = await fetch('/share/templates/default.svg');
  const doc = SPDocument.createNewDocFromMem(await response.text());
  if (!doc) throw new Error('default template is not valid SVG');
  return doc;
}

/**
 * Ask the user for an SVG file and open it. Returns null if the user cancels
 * or the file is not SVG. Uses the File System Access API, with an
 * <input type=file> fallback. TODO: .svgz, other import formats, keep the
 * file handle for saving.
 */
export async function sp_file_open_dialog(): Promise<SPDocument | null> {
  const file = await pickFile();
  if (!file) return null;
  const doc = SPDocument.createNewDocFromMem(await file.text(), file.name);
  if (!doc) alert(_('Failed to load the requested file %s').replace('%s', file.name));
  return doc;
}

interface OpenFilePicker {
  showOpenFilePicker(options: {
    types: { description: string; accept: Record<string, string[]> }[];
  }): Promise<{ getFile(): Promise<File> }[]>;
}

async function pickFile(): Promise<File | null> {
  const w = window as Window & Partial<OpenFilePicker>;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: [{ description: _('Scalable Vector Graphic (*.svg)'), accept: { 'image/svg+xml': ['.svg'] } }],
      });
      return handle ? await handle.getFile() : null;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svg,image/svg+xml';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
