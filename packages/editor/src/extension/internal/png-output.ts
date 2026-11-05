// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/png-output.cpp, src/extension/internal/png-output.h
/*
 * An internal raster export which passes the generated PNG output to an external file. In the
 * future this module could host more of the PNG generation code that isn't needed for other
 * raster export options.
 *
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2021 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { N_, type SPDocument } from '@inkscape-web/core';
import { Implementation } from '../implementation/implementation.ts';
import type { Output } from '../output.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';

export const SP_MODULE_KEY_RASTER_PNG = 'org.inkscape.output.png.default';

/** The default raster output (upstream PngOutput). */
export class PngOutput extends Implementation {
  /** The PNG file that the export made is the file (upstream moves it to the target). */
  override async export_raster(
    _module: Output,
    _doc: SPDocument,
    png: Uint8Array,
    _name: string,
  ): Promise<Uint8Array | null> {
    return png;
  }

  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('Portable Network Graphic')}</name>\n` +
        `<id>${SP_MODULE_KEY_RASTER_PNG}</id>\n` +
        `<param name='png_interlacing' type='bool' gui-text='${N_('Interlacing')}'>false</param>` +
        `<param name='png_bitdepth' type='optiongroup' appearance='combo' gui-text='${N_('Bit Depth')}'>` +
        `<option value='99'>${N_('RGBA 8')}</option>` + // First because it's the default option
        `<option value='100'>${N_('RGBA 16')}</option>` +
        `<option value='67'>${N_('GrayAlpha 8')}</option>` +
        `<option value='68'>${N_('GrayAlpha 16')}</option>` +
        `<option value='35'>${N_('RGB 8')}</option>` +
        `<option value='36'>${N_('RGB 16')}</option>` +
        `<option value='0'>${N_('Gray 1')}</option>` +
        `<option value='1'>${N_('Gray 2')}</option>` +
        `<option value='2'>${N_('Gray 4')}</option>` +
        `<option value='3'>${N_('Gray 8')}</option>` +
        `<option value='4'>${N_('Gray 16')}</option>` +
        '</param>' +
        `<param name='png_compression' type='optiongroup' appearance='combo' gui-text='${N_('Compression')}'>` +
        `<option value='0'>${N_('0 - No Compression')}</option>` +
        `<option value='1'>${N_('1 - Best Speed')}</option>` +
        "<option value='2'>2</option>" +
        "<option value='3'>3</option>" +
        "<option value='4'>4</option>" +
        "<option value='5'>5</option>" +
        `<option value='6'>${N_('6 - Default Compression')}</option>` + // First because it's default (and broken)
        "<option value='7'>7</option>" +
        "<option value='8'>8</option>" +
        `<option value='9'>${N_('9 - Best Compression')}</option>` +
        '</param>' +
        `<param name='png_phys' gui-text='${N_('pHYs DPI')}' type='float' min='0.0' max='100000.0'>0.0</param>` +
        `<param name='png_antialias' gui-text='${N_('Antialias')}' type='int' min='0' max='3'>2</param>` +
        '<output raster="true" priority="1">\n' +
        '<extension>.png</extension>\n' +
        '<mimetype>image/png</mimetype>\n' +
        `<filetypename>${N_('PNG (*.png)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Default raster graphic export')}</filetypetooltip>\n` +
        '</output>\n' +
        '</inkscape-extension>',
      new PngOutput(),
    );
  }
}
