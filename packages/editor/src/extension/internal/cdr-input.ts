// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/cdr-input.cpp, src/extension/internal/cdr-input.h
/*
 * This code abstracts the libwpg interfaces into the Inkscape
 * input extension interface.
 *
 * This file came from libwpg as a source, their utility wpg2svg
 * specifically.  It has been modified to work as an Inkscape extension.
 * The Inkscape extension code is covered by this copyright, but the
 * rest is covered by the one below.
 *
 * Authors:
 *   Fridrich Strba (fridrich.strba@bluewin.ch)
 *
 * Copyright (C) 2012 Authors
 */
import { N_, type SPDocument } from '@inkscape-web/core';
import { Implementation } from '../implementation/implementation.ts';
import type { Input } from '../input.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';
import { rvng_open } from './rvng-import-dialog.ts';

/** CorelDRAW input with libcdr (upstream CdrInput). */
export class CdrInput extends Implementation {
  override async open(_mod: Input, _uri: string, data: Uint8Array): Promise<SPDocument | null> {
    return rvng_open(data, (b, d) => b.cdrParse(d));
  }

  static init(): void {
    /* CDR */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('Corel DRAW Input')}</name>\n` +
        '<id>org.inkscape.input.cdr</id>\n' +
        '<input>\n' +
        '<extension>.cdr</extension>\n' +
        '<mimetype>image/x-xcdr</mimetype>\n' +
        `<filetypename>${N_('Corel DRAW 7-X4 files (*.cdr)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Open files saved in Corel DRAW 7-X4')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new CdrInput(),
    );
    /* CDT */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('Corel DRAW templates input')}</name>\n` +
        '<id>org.inkscape.input.cdt</id>\n' +
        '<input>\n' +
        '<extension>.cdt</extension>\n' +
        '<mimetype>application/x-xcdt</mimetype>\n' +
        `<filetypename>${N_('Corel DRAW 7-13 template files (*.cdt)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Open files saved in Corel DRAW 7-13')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new CdrInput(),
    );
    /* CCX */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('Corel DRAW Compressed Exchange files input')}</name>\n` +
        '<id>org.inkscape.input.ccx</id>\n' +
        '<input>\n' +
        '<extension>.ccx</extension>\n' +
        '<mimetype>application/x-xccx</mimetype>\n' +
        `<filetypename>${N_('Corel DRAW Compressed Exchange files (*.ccx)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Open compressed exchange files saved in Corel DRAW')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new CdrInput(),
    );
    /* CMX */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('Corel DRAW Presentation Exchange files input')}</name>\n` +
        '<id>org.inkscape.input.cmx</id>\n' +
        '<input>\n' +
        '<extension>.cmx</extension>\n' +
        '<mimetype>application/x-xcmx</mimetype>\n' +
        `<filetypename>${N_('Corel DRAW Presentation Exchange files (*.cmx)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Open presentation exchange files saved in Corel DRAW')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new CdrInput(),
    );
  }
}
