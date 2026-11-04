// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-base.cpp, src/actions/actions-base.h
/*
 * Actions tied to the application and independent of GUI.
 *
 * Copyright (C) 2018 Tavmjong Bah
 *
 * The contents of this file may be used under the GNU General Public License Version 2 or later.
 */
import { N_, NC_, SPItem, type SPObject, svgNumber } from '@inkscape-web/core';
import { db } from '../extension/db.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { show_output } from './actions-helper.ts';

const SECTION_BASE = NC_('Action Section', 'Base');
const SECTION_IMPORT = NC_('Action Section', 'Import');
const SECTION_QUERY = NC_('Action Section', 'Query');

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_base: readonly (readonly [string, string, string, string])[] = [
  ['app.inkscape-version', N_('Inkscape Version'), SECTION_BASE, N_('Print Inkscape version and exit')],
  [
    'app.active-document-file-name',
    N_('Active Document File Name'),
    SECTION_BASE,
    N_('Print active document file name'),
  ],
  [
    'app.active-window-start',
    N_('Active Window: Start Call'),
    SECTION_BASE,
    N_('Start execution in active window'),
  ],
  [
    'app.active-window-end',
    N_('Active Window: End Call'),
    SECTION_BASE,
    N_('End execution in active window'),
  ],
  ['app.save-preferences', N_('Save preferences'), SECTION_BASE, N_('Make sure the preferences are saved')],
  ['app.debug-info', N_('Debug Info'), SECTION_BASE, N_('Print debugging information and exit')],
  [
    'app.system-data-directory',
    N_('System Directory'),
    SECTION_BASE,
    N_('Print system data directory and exit'),
  ],
  ['app.user-data-directory', N_('User Directory'), SECTION_BASE, N_('Print user data directory and exit')],
  ['app.action-list', N_('List Actions'), SECTION_BASE, N_('Print a list of actions and exit')],
  [
    'app.list-input-types',
    N_('List Input File Extensions'),
    SECTION_BASE,
    N_('Print a list of input file extensions and exit'),
  ],
  ['app.quit', N_('Quit'), SECTION_BASE, N_('Quit Inkscape, check for data loss')],
  [
    'app.quit-immediate',
    N_('Quit Immediately'),
    SECTION_BASE,
    N_('Immediately quit Inkscape, no check for data loss'),
  ],
  [
    'app.refresh-user-extensions',
    N_('Refresh User Extensions'),
    SECTION_BASE,
    N_('Refresh list of available user extensions'),
  ],

  ['app.open-page', N_('Import Page Number'), SECTION_IMPORT, N_('Select PDF page number to import')],
  [
    'app.convert-dpi-method',
    N_('Import DPI Method'),
    SECTION_IMPORT,
    N_('Set DPI conversion method for legacy Inkscape files'),
  ],
  [
    'app.no-convert-baseline',
    N_('No Import Baseline Conversion'),
    SECTION_IMPORT,
    N_('Do not convert text baselines in legacy Inkscape files'),
  ],

  ['app.query-x', N_('Query X'), SECTION_QUERY, N_("Query 'x' value(s) of selected objects")],
  ['app.query-y', N_('Query Y'), SECTION_QUERY, N_("Query 'y' value(s) of selected objects")],
  ['app.query-width', N_('Query Width'), SECTION_QUERY, N_("Query 'width' value(s) of object(s)")],
  ['app.query-height', N_('Query Height'), SECTION_QUERY, N_("Query 'height' value(s) of object(s)")],
  ['app.query-all', N_('Query All'), SECTION_QUERY, N_("Query 'x', 'y', 'width', and 'height'")],
  ['app.query-pages', N_('Query Pages'), SECTION_QUERY, N_('Query number of pages in the document')],
];

/** The version of the port: that of the upstream commit it follows. */
export const INKSCAPE_VERSION = '1.5.0-dev';

/** The version line printed by app.inkscape-version (upstream Inkscape::inkscape_version()). */
export function inkscape_version(): string {
  return `Inkscape ${INKSCAPE_VERSION} (web)`;
}

/** What app.debug-info prints (upstream Inkscape::debug_info()): the version and the browser. */
export function debug_info(): string {
  return `${inkscape_version()}\nBrowser: ${typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent}`;
}

/** The "x" or the width etc. of the selected objects, comma separated (upstream query_dimension). */
function query_dimension(app: InkscapeApplication, extent: boolean, axis: 'x' | 'y'): void {
  const document = app.get_active_document();
  const selection = app.get_active_selection();
  if (!document || !selection) return;
  if (selection.isEmpty()) selection.add(document.getRoot());
  const size = axis === 'x' ? 'width' : 'height';
  const out = selection.items().map((item) => {
    const area = item.documentVisualBounds();
    if (!area) return '0';
    return svgNumber(extent ? area[size]() : axis === 'x' ? area.left() : area.top());
  });
  show_output(out.join(','), false);
}

/** "id,x,y,width,height" of every item with an id (upstream query_all_recurse). */
function query_all_recurse(o: SPObject): void {
  if (!(o instanceof SPItem) || !o.getId()) return;
  const area = o.documentVisualBounds();
  show_output(
    area
      ? [o.getId(), area.left(), area.top(), area.width(), area.height()]
          .map((v) => (typeof v === 'number' ? svgNumber(v) : v))
          .join(',')
      : '',
    false,
  );
  for (const child of o.children) query_all_recurse(child);
}

export function add_actions_base(app: InkscapeApplication): void {
  const actions = app.actions.app;
  actions.add_action('inkscape-version', () => show_output(inkscape_version(), false));
  actions.add_action('active-document-file-name', () => {
    const doc = app.get_active_document();
    show_output(doc ? (doc.documentFilename ?? '') : 'active_document_file_name: no document!');
  });
  // The active window is the only window: there is nothing to start or end.
  actions.add_action('active-window-start', () => {});
  actions.add_action('active-window-end', () => {});
  // Preferences are written to localStorage when they change.
  actions.add_action('save-preferences', () => {});
  actions.add_action('debug-info', () => show_output(debug_info(), false));
  actions.add_action('system-data-directory', () => show_output('/share', false));
  actions.add_action('user-data-directory', () => show_output('localStorage', false));
  actions.add_action('action-list', () => {
    for (const prefix of ['app', 'win', 'doc']) {
      for (const name of app.actions.map(prefix)?.list_actions() ?? [])
        show_output(`${prefix}.${name}`, false);
    }
  });
  actions.add_action('list-input-types', () => {
    for (const input of db.get_input_list()) show_output(input.get_extension() ?? '', false);
  });

  // Options of the import: kept for the command line, nothing in the browser reads them.
  actions.add_action_with_parameter('open-page', 'i', () => {});
  actions.add_action_with_parameter('convert-dpi-method', 's', (method) => {
    if (!['none', 'scale-viewbox', 'scale-document'].includes(method)) {
      show_output('dpi_convert_method: invalid option');
    }
  });
  actions.add_action('no-convert-baseline', () => {});

  actions.add_action('query-x', () => query_dimension(app, false, 'x'));
  actions.add_action('query-y', () => query_dimension(app, false, 'y'));
  actions.add_action('query-width', () => query_dimension(app, true, 'x'));
  actions.add_action('query-height', () => query_dimension(app, true, 'y'));
  actions.add_action('query-all', () => {
    const doc = app.get_active_document();
    if (!doc) show_output('query_all: no document!');
    else query_all_recurse(doc.getRoot());
  });
  actions.add_action('query-pages', () => {
    const doc = app.get_active_document();
    show_output(doc ? String(doc.getPageManager().getPageCount()) : 'query-pages: no document!');
  });
  app.get_action_extra_data().add_data(raw_data_base);
}
