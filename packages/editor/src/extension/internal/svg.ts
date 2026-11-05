// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/svg.cpp, src/extension/internal/svg.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Ted Gould <ted@gould.cx>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2002 Ximian, Inc.
 * Copyright (C) 2002-2004 Ted Gould
 */
import { N_, readMem, type SPDocument, SVG_NS_URI, saveBuf } from '@inkscape-web/core';
import {
  prune_inkscape_from_node,
  prune_proprietary_from_node,
} from '../../actions/actions-svg-processing.ts';
import { Implementation } from '../implementation/implementation.ts';
import type { Output } from '../output.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';

export const SP_MODULE_KEY_OUTPUT_SVG_INKSCAPE = 'org.inkscape.output.svg.inkscape';
export const SP_MODULE_KEY_OUTPUT_SVG = 'org.inkscape.output.svg.plain';

/**
 * The text of the SVG file of the document: with the Inkscape data, or, for plain SVG, without
 * the elements and attributes of Inkscape and Sodipodi. Null if the plain document fails.
 * TODO: the actions of the output (version, polyfills, fallbacks).
 */
export function svg_text(doc: SPDocument, plain: boolean): string | null {
  const text = saveBuf(doc.rdoc, SVG_NS_URI);
  if (!plain) return text;
  const copy = readMem(text, SVG_NS_URI);
  if (!copy) return null;
  prune_proprietary_from_node(copy);
  prune_inkscape_from_node(copy);
  return saveBuf(copy, SVG_NS_URI);
}

/**
 * The SVG outputs (upstream Svg). The input is in the file functions of the web app (the files
 * are opened with createNewDocFromMem and the import dialog is not ported).
 */
export class Svg extends Implementation {
  override async save(module: Output, doc: SPDocument, _name: string): Promise<Uint8Array | null> {
    const text = svg_text(doc, module.get_id() === SP_MODULE_KEY_OUTPUT_SVG);
    return text === null ? null : new TextEncoder().encode(text);
  }

  /** Register the SVG outputs (upstream Svg::init). */
  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('SVG Output Inkscape')}</name>\n` +
        `<id>${SP_MODULE_KEY_OUTPUT_SVG_INKSCAPE}</id>\n` +
        "<output is_exported='true' priority='1'>\n" +
        '<extension>.svg</extension>\n' +
        '<mimetype>image/x-inkscape-svg</mimetype>\n' +
        `<filetypename>${N_('Inkscape SVG (*.svg)')}</filetypename>\n` +
        `<filetypetooltip>${N_('SVG format with Inkscape extensions')}</filetypetooltip>\n` +
        '<dataloss>false</dataloss>\n' +
        '</output>\n' +
        '</inkscape-extension>',
      new Svg(),
    );
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('SVG Output')}</name>\n` +
        `<id>${SP_MODULE_KEY_OUTPUT_SVG}</id>\n` +
        "<output is_exported='true' priority='2'>\n" +
        '<extension>.svg</extension>\n' +
        '<mimetype>image/svg+xml</mimetype>\n' +
        `<filetypename>${N_('Plain SVG (*.svg)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Scalable Vector Graphics format as defined by the W3C')}</filetypetooltip>\n` +
        '</output>\n' +
        '</inkscape-extension>',
      new Svg(),
    );
  }
}
