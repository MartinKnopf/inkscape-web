// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/gif.cpp, src/extension/internal/gif.h
/*
 * Created by Michael Kowalski on 4/15/25.
 */
import { type Colors, N_, type SPDocument, type SPPage } from '@inkscape-web/core';
import type { Rect } from '@inkscape-web/geom';
import { sp_export_canvas } from '../../helper/png-write.ts';
import { Implementation } from '../implementation/implementation.ts';
import type { Output } from '../output.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';
import { GifWriter } from './lib-gif.ts';

/**
 * The RGBA pixels (width x height) of the area of the document over an opaque background. The
 * default draws with the browser; tests replace it.
 */
export type GifPageRenderer = (
  doc: SPDocument,
  area: Rect,
  width: number,
  height: number,
  background: Colors.Color,
) => Promise<Uint8ClampedArray>;

const render_with_canvas: GifPageRenderer = async (doc, area, width, height, background) => {
  const canvas = await sp_export_canvas(doc, area, width, height, { background });
  return canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
};

/** The animated GIF output: each page is a frame (upstream Gif). */
export class Gif extends Implementation {
  /** Draws the pages. */
  static render_page: GifPageRenderer = render_with_canvas;

  override async save(extension: Output, doc: SPDocument, _name: string): Promise<Uint8Array | null> {
    const dims = doc.getDimensions();
    const width = Math.trunc(dims.x);
    const height = Math.trunc(dims.y);
    if (!(width >= 1 && height >= 1 && width <= 0xffff && height <= 0xffff)) return null;

    const dither = extension.get_param_bool('dither');
    const bit_depth = extension.get_param_int('bit-depth');
    const delay = Math.trunc(extension.get_param_float('delay') / 10);
    const writer = new GifWriter(width, height, delay);

    // Opaque background of the page color
    const color = doc.getNamedView().getBackgroundColor().withOpacity(1);

    // add frames; a document without pages is one frame (upstream makes none)
    const pages: readonly SPPage[] = doc.getPageManager().getPages();
    const areas = pages.length ? pages.map((p) => p.getDocumentRect()) : [doc.preferredBounds()];
    for (const area of areas) {
      const pixels = await Gif.render_page(doc, area, width, height, color);
      writer.writeFrame(pixels, delay, bit_depth, dither);
    }
    return writer.end();
  }

  static init(): void {
    build_from_mem(
      `<?xml version="1.0" encoding="UTF-8" ?>
<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">
    <name>${N_('Animated GIF')}</name>
    <id>org.inkscape.output.gif.animated</id>
    <param name='delay' gui-text='${N_('Default frame duration (ms)')}' type='float' min='0.0' max='100000000.0'>100.0</param>
    <label>${N_('Note: frame duration accuracy is 10 ms.')}</label>
    <param name='bit-depth' gui-text='${N_('Bit depth (1-8)')}' type='int' min='1' max='8'>8</param>
    <param name='dither' type='bool' gui-text='${N_('Dithering')}'>false</param>
    <separator/>
    <label>${N_('To save animated GIF go to:')}</label>
    <label>${N_("'Export - Single File - Page'")}</label>
    <output is_exported='true' priority='2'>
        <extension>.gif</extension>
        <mimetype>image/gif</mimetype>
        <filetypename>${N_('GIF (*.gif)')}</filetypename>
        <filetypetooltip>${N_('Graphics Interchange Format')}</filetypetooltip>
    </output>
</inkscape-extension>
`,
      new Gif(),
    );
  }
}
