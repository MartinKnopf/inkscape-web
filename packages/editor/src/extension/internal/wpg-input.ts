// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/wpg-input.cpp, src/extension/internal/wpg-input.h
/*
 *  This file came from libwpg as a source, their utility wpg2svg
 *  specifically.  It has been modified to work as an Inkscape extension.
 *  The Inkscape extension code is covered by this copyright, but the
 *  rest is covered by the one below.
 *
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006 Authors
 *
 * libwpg
 * Copyright (C) 2006 Ariya Hidayat (ariya@kde.org)
 * Copyright (C) 2005 Fridrich Strba (fridrich.strba@bluewin.ch)
 *
 * For further information visit http://libwpg.sourceforge.net
 *
 * "This product is not manufactured, approved, or supported by
 * Corel Corporation or Corel Corporation Limited."
 */
import { N_, SPDocument } from '@inkscape-web/core';
import { Implementation } from '../implementation/implementation.ts';
import type { Input } from '../input.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';
import { ensureRevengeBackend, rvng_set_viewbox, rvng_svg_document } from './rvng-import-dialog.ts';

/** WordPerfect Graphics input with libwpg (upstream WpgInput). */
export class WpgInput extends Implementation {
  /** The first page; bindings/revenge.cpp does the libwpg part (the OLE stream, the parser). */
  override async open(_mod: Input, _uri: string, data: Uint8Array): Promise<SPDocument | null> {
    const parsers = await ensureRevengeBackend();
    const vec = parsers?.wpgParse(data);
    if (!vec?.[0]) return null;

    const doc = SPDocument.createNewDocFromMem(rvng_svg_document(vec[0]));

    // Set viewBox if it doesn't exist
    if (doc) rvng_set_viewbox(doc);

    return doc;
  }

  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('WPG Input')}</name>\n` +
        '<id>org.inkscape.input.wpg</id>\n' +
        '<input>\n' +
        '<extension>.wpg</extension>\n' +
        '<mimetype>image/x-wpg</mimetype>\n' +
        `<filetypename>${N_('WordPerfect Graphics (*.wpg)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Vector graphics format used by Corel WordPerfect')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new WpgInput(),
    );
  }
}
