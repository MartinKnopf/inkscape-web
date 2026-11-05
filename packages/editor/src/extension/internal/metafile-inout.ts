// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/metafile-inout.cpp, src/extension/internal/metafile-inout.h
/*
 * Metafile input - common routines
 *
 * Authors:
 *   David Mathog
 *
 * Copyright (C) 2013 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { SPDocument } from '@inkscape-web/core';
import { Implementation } from '../implementation/implementation.ts';
import { ensureUemfBackend, type UemfBackend } from './uemf-backend.ts';

/**
 * The base class of the EMF and WMF input and output (upstream Metafile). The image
 * conversion (toPNG) and the other helpers of the import run in uemf-module.wasm with the
 * upstream import; here is the part that turns its SVG text into a document.
 */
export class Metafile extends Implementation {
  /** Run the import of the WASM module and build the document from its SVG text; null on error. */
  static async import_svg(run: (uemf: UemfBackend) => string): Promise<SPDocument | null> {
    const uemf = await ensureUemfBackend();
    if (!uemf) return null;
    const svg = run(uemf);
    if (!svg) return null;
    return SPDocument.createNewDocFromMem(svg);
  }
}
