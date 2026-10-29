// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-pages.cpp, src/actions/actions-pages.h
/*
 * Page actions.
 *
 * Copyright (C) 2021 Martin Owens
 */
import { C_, DocumentUndo, N_, NC_, PageManager, Preferences, type SPDocument } from '@inkscape-web/core';
import type { SPDesktop } from '../desktop.ts';
import type { InkscapeApplication } from '../inkscape-application.ts';

export function page_new(document: SPDocument): void {
  const pm = document.getPageManager();
  pm.selectPage(pm.newPage());
  DocumentUndo.done(document, C_('Undo', 'New Automatic Page'), 'tool-pages');
}

export function page_duplicate(document: SPDocument): void {
  const pm = document.getPageManager();
  pm.selectPage(pm.duplicatePage());
  DocumentUndo.done(document, C_('Undo', 'Duplicate Page'), 'tool-pages');
}

export function page_delete(document: SPDocument): void {
  // Delete page's content if move_objects is checked.
  document.getPageManager().deleteSelectedPage(PageManager.move_objects());
  DocumentUndo.done(document, C_('Undo', 'Delete Page'), 'tool-pages');
}

export function page_backward(document: SPDocument): void {
  const page = document.getPageManager().getSelected();
  if (page?.setPageIndex(page.getPageIndex() - 1, PageManager.move_objects())) {
    DocumentUndo.done(document, C_('Undo', 'Shift Page Backwards'), 'tool-pages');
  }
}

export function page_forward(document: SPDocument): void {
  const page = document.getPageManager().getSelected();
  if (page?.setPageIndex(page.getPageIndex() + 1, PageManager.move_objects())) {
    DocumentUndo.done(document, C_('Undo', 'Shift Page Forwards'), 'tool-pages');
  }
}

/** Center the view on the selected page (upstream PageManager::centerToSelectedPage). */
function center_to_selected_page(desktop: SPDesktop): void {
  desktop.set_display_center(desktop.getDocument().getPageManager().getSelectedPageRect());
}

const SECTION = NC_('Action Section', 'Page');

// biome-ignore format: table
export const doc_page_actions: readonly (readonly [string, string, string, string])[] = [
  ['doc.page-new',               N_('New Page'),               SECTION, N_('Create a new page')                                  ],
  ['doc.page-duplicate',         N_('Duplicate Page'),         SECTION, N_('Duplicate the selected page')                        ],
  ['doc.page-delete',            N_('Delete Page'),            SECTION, N_('Delete the selected page')                           ],
  ['doc.page-move-objects',      N_('Move Objects with Page'), SECTION, N_('Move overlapping objects as the page is moved')     ],
  ['doc.page-move-backward',     N_('Move Before Previous'),   SECTION, N_('Move page backwards in the page order')              ],
  ['doc.page-move-forward',      N_('Move After Next'),        SECTION, N_('Move page forwards in the page order')               ],
];

// biome-ignore format: table
export const win_page_actions: readonly (readonly [string, string, string, string])[] = [
  ['win.page-new',       N_('New Page'),       SECTION, N_('Create a new page and center view on it')],
  ['win.page-duplicate', N_('Duplicate Page'), SECTION, N_('Duplicate the selected page and center view on the duplicate')],
  ['win.page-delete',    N_('Delete Page'),    SECTION, N_('Delete the selected page and center view on next page')],
];

/**
 * Register the doc.page-* actions (upstream add_actions_pages) and the
 * win.page-* actions that also center the view on the page (upstream
 * add_actions_page_tools). They act on the active document and desktop.
 */
export function add_actions_pages(app: InkscapeApplication): void {
  const doc = (f: (document: SPDocument) => void) => () => {
    const document = app.get_active_document();
    if (document) f(document);
  };
  const map = app.actions.doc;
  map.add_action('page-new', doc(page_new));
  map.add_action('page-duplicate', doc(page_duplicate));
  map.add_action('page-delete', doc(page_delete));
  map.add_action('page-move-backward', doc(page_backward));
  map.add_action('page-move-forward', doc(page_forward));
  const move_objects = map.add_action_bool(
    'page-move-objects',
    () => {
      const active = !move_objects.get_state(); // toggle
      move_objects.change_state(active);
      Preferences.get().setBool('/tools/pages/move_objects', active);
    },
    PageManager.move_objects(),
  );
  app.get_action_extra_data().add_data(doc_page_actions);

  const win = (f: (document: SPDocument) => void) => () => {
    const desktop = app.get_active_desktop();
    if (!desktop) return;
    f(desktop.getDocument());
    center_to_selected_page(desktop);
  };
  app.actions.win.add_action('page-new', win(page_new));
  app.actions.win.add_action('page-duplicate', win(page_duplicate));
  app.actions.win.add_action('page-delete', win(page_delete));
  app.get_action_extra_data().add_data(win_page_actions);
}
