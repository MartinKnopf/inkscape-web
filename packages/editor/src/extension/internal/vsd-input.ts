// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/vsd-input.cpp, src/extension/internal/vsd-input.h
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

/** Visio input with libvisio (upstream VsdInput). */
export class VsdInput extends Implementation {
  override async open(_mod: Input, _uri: string, data: Uint8Array): Promise<SPDocument | null> {
    return rvng_open(data, (b, d) => b.vsdParse(d));
  }

  static init(): void {
    /* VSD */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('VSD Input')}</name>\n` +
        '<id>org.inkscape.input.vsd</id>\n' +
        '<input>\n' +
        '<extension>.vsd</extension>\n' +
        '<mimetype>application/vnd.visio</mimetype>\n' +
        `<filetypename>${N_('Microsoft Visio Diagram (*.vsd)')}</filetypename>\n` +
        `<filetypetooltip>${N_('File format used by Microsoft Visio 6 and later')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new VsdInput(),
    );
    /* VDX */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('VDX Input')}</name>\n` +
        '<id>org.inkscape.input.vdx</id>\n' +
        '<input>\n' +
        '<extension>.vdx</extension>\n' +
        '<mimetype>application/vnd.visio</mimetype>\n' +
        `<filetypename>${N_('Microsoft Visio XML Diagram (*.vdx)')}</filetypename>\n` +
        `<filetypetooltip>${N_('File format used by Microsoft Visio 2010 and later')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new VsdInput(),
    );
    /* VSDM */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('VSDM Input')}</name>\n` +
        '<id>org.inkscape.input.vsdm</id>\n' +
        '<input>\n' +
        '<extension>.vsdm</extension>\n' +
        '<mimetype>application/vnd.visio</mimetype>\n' +
        `<filetypename>${N_('Microsoft Visio 2013 drawing (*.vsdm)')}</filetypename>\n` +
        `<filetypetooltip>${N_('File format used by Microsoft Visio 2013 and later')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new VsdInput(),
    );
    /* VSDX */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('VSDX Input')}</name>\n` +
        '<id>org.inkscape.input.vsdx</id>\n' +
        '<input>\n' +
        '<extension>.vsdx</extension>\n' +
        '<mimetype>application/vnd.visio</mimetype>\n' +
        `<filetypename>${N_('Microsoft Visio 2013 drawing (*.vsdx)')}</filetypename>\n` +
        `<filetypetooltip>${N_('File format used by Microsoft Visio 2013 and later')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new VsdInput(),
    );
  }
}
