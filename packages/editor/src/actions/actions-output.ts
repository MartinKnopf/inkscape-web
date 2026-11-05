// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-output.cpp, src/actions/actions-output.h
/*
 * Gio::Actions for output tied to the application and without GUI.
 *
 * Copyright (C) 2018 Tavmjong Bah
 *
 * The contents of this file may be used under the GNU General Public License Version 2 or later.
 */
import { N_, NC_ } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { ExportAreaType, type InkFileExportCmd } from '../io/file-export-cmd.ts';
import { show_output } from './actions-helper.ts';

const SECTION = NC_('Action Section', 'Export');

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_output: readonly (readonly [string, string, string, string])[] = [
  ['app.export-type', N_('Export Type'), SECTION, N_('Set export file type')],
  ['app.export-filename', N_('Export File Name'), SECTION, N_('Set export file name')],
  [
    'app.export-overwrite',
    N_('Export Overwrite'),
    SECTION,
    N_('Allow to overwrite existing files during export'),
  ],

  ['app.export-area', N_('Export Area'), SECTION, N_('Set export area')],
  ['app.export-area-drawing', N_('Export Area Drawing'), SECTION, N_('Export drawing area')],
  ['app.export-area-page', N_('Export Area Page'), SECTION, N_('Export page area')],
  ['app.export-margin', N_('Export Margin'), SECTION, N_('Set additional export margin')],
  ['app.export-area-snap', N_('Export Area Snap'), SECTION, N_('Snap export area to integer values')],
  ['app.export-width', N_('Export Width'), SECTION, N_('Set export width')],
  ['app.export-height', N_('Export Height'), SECTION, N_('Set export height')],

  ['app.export-id', N_('Export ID'), SECTION, N_('Export selected ID(s)')],
  ['app.export-id-only', N_('Export ID Only'), SECTION, N_('Hide any objects not given in export-id option')],

  ['app.export-plain-svg', N_('Export Plain SVG'), SECTION, N_('Export as plain SVG')],
  ['app.export-dpi', N_('Export DPI'), SECTION, N_('Set export DPI')],
  [
    'app.export-ignore-filters',
    N_('Export Ignore Filters'),
    SECTION,
    N_('Export without filters to avoid rasterization for PDF, PS, EPS'),
  ],
  [
    'app.export-text-to-path',
    N_('Export Text to Path'),
    SECTION,
    N_('Convert texts to paths in the exported file'),
  ],
  ['app.export-ps-level', N_('Export PS Level'), SECTION, N_('Set PostScript level')],
  ['app.export-pdf-version', N_('Export PDF Version'), SECTION, N_('Set PDF version')],
  ['app.export-page', N_('Export Page'), SECTION, N_('Select page(s) to export')],
  ['app.export-latex', N_('Export LaTeX'), SECTION, N_('Export LaTeX')],
  ['app.export-use-hints', N_('Export Use Hints'), SECTION, N_('Export using saved hints')],
  [
    'app.export-background',
    N_('Export Background'),
    SECTION,
    N_('Include background color in exported file'),
  ],
  [
    'app.export-background-opacity',
    N_('Export Background Opacity'),
    SECTION,
    N_('Include background opacity in exported file'),
  ],
  ['app.export-png-color-mode', N_('Export PNG Color Mode'), SECTION, N_('Set color mode for PNG export')],
  ['app.export-png-use-dithering', N_('Export PNG Dithering'), SECTION, N_('Set dithering for PNG export')],
  [
    'app.export-png-compression',
    N_('Export PNG Compression'),
    SECTION,
    N_('Set compression level for PNG export'),
  ],
  [
    'app.export-png-antialias',
    N_('Export PNG Antialiasing'),
    SECTION,
    N_('Set antialiasing level for PNG export'),
  ],

  ['app.export-do', N_('Do Export'), SECTION, N_('Do export')],
];

/** Action id and hint for the parameter (untranslated; upstream hint_data_output). */
export const hint_data_output: readonly (readonly [string, string])[] = [
  ['app.export-type', N_('Enter string for the file type')],
  ['app.export-filename', N_('Enter string for the file name')],
  ['app.export-overwrite', N_('Enter 1/0 for Yes/No to overwrite exported file')],

  ['app.export-area', N_('Enter string for export area, formatted like x0:y0:x1:y1')],
  ['app.export-area-drawing', N_('Enter 1/0 for Yes/No to export drawing area')],
  ['app.export-area-page', N_('Enter 1/0 for Yes/No to export page area')],
  ['app.export-margin', N_('Enter integer number for margin')],
  ['app.export-area-snap', N_('Enter 1/0 for Yes/No to snap the export area')],
  ['app.export-width', N_('Enter integer number for width')],
  ['app.export-height', N_('Enter integer number for height')],

  ['app.export-id', N_('Enter string for export ID')],
  ['app.export-id-only', N_('Enter 1/0 for Yes/No to export only given ID')],

  ['app.export-plain-svg', N_('Enter 1/0 for Yes/No to export plain SVG')],
  ['app.export-dpi', N_('Enter integer number for export DPI')],
  ['app.export-ignore-filters', N_('Enter 1/0 for Yes/No to export ignoring filters')],
  ['app.export-text-to-path', N_('Enter 1/0 for Yes/No to convert text to path on export')],
  ['app.export-ps-level', N_('Enter integer number 2 or 3 for PS Level')],
  ['app.export-pdf-version', N_('Enter string for PDF Version, e.g. 2.0')],
  ['app.export-page', N_("Enter string for page numbers e.g. '1', '1-3' or '2,4'")],
  ['app.export-latex', N_('Enter 1/0 for Yes/No to export to PDF and LaTeX')],
  ['app.export-use-hints', N_('Enter 1/0 for Yes/No to use export hints from document')],
  ['app.export-background', N_('Enter string for background color, e.g. #ff007f or rgb(255, 0, 128)')],
  [
    'app.export-background-opacity',
    N_('Enter number for background opacity, either between 0.0 and 1.0, or 1 up to 255'),
  ],
  [
    'app.export-png-color-mode',
    N_(
      'Enter string for PNG Color Mode, one of Gray_1/Gray_2/Gray_4/Gray_8/Gray_16/RGB_8/RGB_16/GrayAlpha_8/GrayAlpha_16/RGBA_8/RGBA_16',
    ),
  ],
  ['app.export-png-use-dithering', N_('Enter 1/0 for Yes/No to use dithering')],
  ['app.export-png-compression', N_('Enter integer for PNG compression level (0 (none) to 9 (max))')],
  ['app.export-png-antialias', N_('Enter integer for PNG antialiasing level (0 (none) to 3 (best))')],
];

/**
 * Do the export of the active document with the settings of the actions (upstream export_do).
 * The files go to on_files of the export.
 */
async function export_do(app: InkscapeApplication): Promise<void> {
  const document = app.get_active_document();
  if (!document) {
    show_output('export_do: no documents open!');
    return;
  }
  // The name of the file of the document, else its name (the browser has no paths).
  const filename = document.documentFilename ?? document.documentName ?? '';
  const cmd = app.file_export();
  await cmd.do_export(document, filename);
  const files = cmd.take_files();
  if (files.length) cmd.on_files?.(files);
}

/**
 * Register the app.export-* actions. They are stateless and change an instance of the
 * InkFileExportCmd class of the application (the same as the command line options); export-do
 * runs the export.
 */
export function add_actions_output(app: InkscapeApplication): void {
  const actions = app.actions.app;
  const cmd = (): InkFileExportCmd => app.file_export();

  // Matches command line options
  actions.add_action_with_parameter('export-type', 's', (s) => {
    cmd().export_type = s;
  });
  actions.add_action_with_parameter('export-filename', 's', (s) => {
    cmd().export_filename = s;
  });
  actions.add_action_with_parameter('export-page', 's', (s) => {
    cmd().export_page = s;
  });
  actions.add_action_with_parameter('export-overwrite', 'b', (b) => {
    cmd().export_overwrite = b;
  });

  actions.add_action_with_parameter('export-area', 's', (s) => cmd().set_export_area(s));
  actions.add_action_with_parameter('export-area-drawing', 'b', (b) => {
    if (b) cmd().set_export_area_type(ExportAreaType.Drawing);
  });
  actions.add_action_with_parameter('export-area-page', 'b', (b) => {
    if (b) cmd().set_export_area_type(ExportAreaType.Page);
  });
  actions.add_action_with_parameter('export-margin', 'i', (i) => {
    cmd().export_margin = i;
  });
  actions.add_action_with_parameter('export-area-snap', 'b', (b) => {
    cmd().export_area_snap = b;
  });
  actions.add_action_with_parameter('export-width', 'i', (i) => {
    cmd().export_width = i;
  });
  actions.add_action_with_parameter('export-height', 'i', (i) => {
    cmd().export_height = i;
  });

  actions.add_action_with_parameter('export-id', 's', (s) => {
    cmd().export_id = s;
  });
  actions.add_action_with_parameter('export-id-only', 'b', (b) => {
    cmd().export_id_only = b;
  });

  actions.add_action_with_parameter('export-plain-svg', 'b', (b) => {
    cmd().export_plain_svg = b;
  });
  actions.add_action_with_parameter('export-dpi', 'd', (d) => {
    cmd().export_dpi = d;
  });
  // Upstream connects this action to the function of export-plain-svg, which is a mistake.
  actions.add_action_with_parameter('export-ignore-filters', 'b', (b) => {
    cmd().export_ignore_filters = b;
  });
  actions.add_action_with_parameter('export-text-to-path', 'b', (b) => {
    cmd().export_text_to_path = b;
  });
  actions.add_action_with_parameter('export-ps-level', 'i', (i) => {
    cmd().export_ps_level = i;
  });
  actions.add_action_with_parameter('export-pdf-version', 's', (s) => {
    cmd().export_pdf_level = s;
  });
  actions.add_action_with_parameter('export-latex', 'b', (b) => {
    cmd().export_latex = b;
  });
  actions.add_action_with_parameter('export-use-hints', 'b', (b) => {
    cmd().export_use_hints = b;
  });
  actions.add_action_with_parameter('export-background', 's', (s) => {
    cmd().export_background = s;
  });
  actions.add_action_with_parameter('export-background-opacity', 'd', (d) => {
    cmd().export_background_opacity = d;
  });
  actions.add_action_with_parameter('export-png-color-mode', 's', (s) => {
    cmd().export_png_color_mode = s;
  });
  actions.add_action_with_parameter('export-png-use-dithering', 'b', (b) => {
    cmd().export_png_use_dithering = b;
  });
  actions.add_action_with_parameter('export-png-compression', 'i', (i) => {
    cmd().export_png_compression = i;
  });
  actions.add_action_with_parameter('export-png-antialias', 'i', (i) => {
    cmd().export_png_antialias = i;
  });

  // Extra
  actions.add_action('export-do', () => void export_do(app));

  app.get_action_extra_data().add_data(raw_data_output);
}
