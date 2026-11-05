// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/template-other.cpp, src/extension/internal/template-other.h
/*
 * Contain internal sizes of paper which can be used in various
 * functions to make and size pages.
 *
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2022 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { N_, NC_ } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';
import type { Template } from '../template.ts';
import { TemplateBase } from './template-base.ts';

/** Miscellaneous sizes. (upstream TemplateOther) */
export class TemplateOther extends TemplateBase {
  /** The width and height of the new page: a square. */
  override get_template_size(tmod: Template): Point {
    const size = tmod.get_param_float('size');
    return new Point(size, size);
  }

  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">` +
        `<id>org.inkscape.template.other</id>` +
        `<name>${N_('Other Sizes')}</name>` +
        `<description>${N_('Miscellaneous document formats')}</description>` +
        `<category>${NC_('TemplateCategory', 'Other')}</category>` +
        `<param name='unit' gui-text='${N_('Unit')}' type='string'>px</param>` +
        `<param name='size' gui-text='${N_('Size')}' type='float' min='1.0' max='100000.0'>32.0</param>` +
        `<template icon='icon_square' unit='px' priority='-10' visibility='icon,search'>` +
        `<preset name='${N_('Icon 16x16')}' label='16 × 16 px' size='16'/>` +
        `<preset name='${N_('Icon 32x32')}' label='32 × 32 px' size='32'/>` +
        `<preset name='${N_('Icon 48x48')}' label='48 × 48 px' size='48'/>` +
        `<preset name='${N_('Icon 120x120')}' label='120 × 120 px' size='120'/>` +
        `<preset name='${N_('Icon 180x180')}' label='180 × 180 px' size='180'/>` +
        `<preset name='${N_('Icon 512x512')}' label='512 × 512 px' size='512'/>` +
        `</template>` +
        `</inkscape-extension>`,
      new TemplateOther(),
    );
  }
}
