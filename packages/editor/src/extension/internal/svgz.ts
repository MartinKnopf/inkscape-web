// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/svgz.cpp, src/extension/internal/svgz.h
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2002-2004 Authors
 */
import { N_, readMem, SPDocument, SVG_NS_URI, saveBuf } from '@inkscape-web/core';
import { prune_inkscape_from_node } from '../../actions/actions-svg-processing.ts';
import { Implementation } from '../implementation/implementation.ts';
import type { Input } from '../input.ts';
import type { Output } from '../output.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';

export const SP_MODULE_KEY_INPUT_SVGZ = 'org.inkscape.input.svgz';
export const SP_MODULE_KEY_OUTPUT_SVGZ = 'org.inkscape.output.svgz.plain';
export const SP_MODULE_KEY_OUTPUT_SVGZ_INKSCAPE = 'org.inkscape.output.svgz.inkscape';

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Compress bytes with gzip (upstream GzipOutputStream). */
export function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return pipe(bytes, new CompressionStream('gzip'));
}

/** Decompress gzip bytes (upstream GzipInputStream). */
export function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return pipe(bytes, new DecompressionStream('gzip'));
}

/** SVG files compressed with gzip (upstream Svgz, which derives from Svg). */
export class Svgz extends Implementation {
  /** Open the bytes of an .svgz file (gzip, or plain SVG) as a document. */
  override async open(_module: Input, name: string, data: Uint8Array): Promise<SPDocument | null> {
    const bytes = new Uint8Array(data);
    const gz = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const text = new TextDecoder().decode(gz ? await gunzip(bytes) : bytes);
    return SPDocument.createNewDocFromMem(text, name);
  }

  /** Save the document as gzipped SVG; the plain output drops the Inkscape and Sodipodi data. */
  override async save(module: Output, doc: SPDocument, _name: string): Promise<Uint8Array | null> {
    let text = saveBuf(doc.rdoc, SVG_NS_URI);
    if (module.get_id() === SP_MODULE_KEY_OUTPUT_SVGZ) {
      const plain = readMem(text, SVG_NS_URI);
      if (!plain) return null;
      prune_inkscape_from_node(plain);
      text = saveBuf(plain, SVG_NS_URI);
    }
    return gzip(new TextEncoder().encode(text));
  }

  /** Register the SVGZ input and the two SVGZ outputs (upstream Svgz::init). */
  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('SVGZ Input')}</name>\n` +
        `<id>${SP_MODULE_KEY_INPUT_SVGZ}</id>\n` +
        "<input priority='2'>\n" +
        '<extension>.svgz</extension>\n' +
        '<mimetype>image/svg+xml-compressed</mimetype>\n' +
        `<filetypename>${N_('Compressed Inkscape SVG (*.svgz)')}</filetypename>\n` +
        `<filetypetooltip>${N_('SVG file format compressed with GZip')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new Svgz(),
    );
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('SVGZ Output')}</name>\n` +
        `<id>${SP_MODULE_KEY_OUTPUT_SVGZ_INKSCAPE}</id>\n` +
        "<output priority='3'>\n" +
        '<extension>.svgz</extension>\n' +
        '<mimetype>image/x-inkscape-svg-compressed</mimetype>\n' +
        `<filetypename>${N_('Compressed Inkscape SVG (*.svgz)')}</filetypename>\n` +
        `<filetypetooltip>${N_("Inkscape's native file format compressed with GZip")}</filetypetooltip>\n` +
        '<dataloss>false</dataloss>\n' +
        '</output>\n' +
        '</inkscape-extension>',
      new Svgz(),
    );
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('SVGZ Output')}</name>\n` +
        `<id>${SP_MODULE_KEY_OUTPUT_SVGZ}</id>\n` +
        "<output priority='4'>\n" +
        '<extension>.svgz</extension>\n' +
        '<mimetype>image/svg+xml-compressed</mimetype>\n' +
        `<filetypename>${N_('Compressed plain SVG (*.svgz)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Scalable Vector Graphics format compressed with GZip')}</filetypetooltip>\n` +
        '</output>\n' +
        '</inkscape-extension>\n',
      new Svgz(),
    );
  }
}
