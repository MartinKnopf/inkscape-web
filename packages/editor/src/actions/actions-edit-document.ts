// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-edit-document.cpp, src/actions/actions-edit-document.h
/*
 * Actions for editing a document (guides, grids).
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *
 * Copyright (C) 2021 Authors
 */
import {
  N_,
  NC_,
  type SPDocument,
  sp_guide_create_guides_around_page,
  sp_guide_delete_all_guides,
} from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';

const SECTION = NC_('Action Section', 'Edit Document');

/** Action id, label, section and tooltip (untranslated). TODO: fit-canvas-to-drawing, set-display-unit, clip-to-page. */
export const raw_data_edit_document: readonly (readonly [string, string, string, string])[] = [
  [
    'doc.create-guides-around-page',
    N_('Create Guides Around the Current Page'),
    SECTION,
    N_('Create four guides aligned with the page borders of the current page'),
  ],
  ['doc.lock-all-guides', N_('Lock All Guides'), SECTION, N_('Toggle lock of all guides in the document')],
  [
    'doc.show-all-guides',
    N_('Show All Guides'),
    SECTION,
    N_('Toggle visibility of all guides in the document'),
  ],
  ['doc.delete-all-guides', N_('Delete All Guides'), SECTION, N_('Delete all the guides in the document')],
  ['doc.show-grids', N_('Show Grids'), SECTION, N_('Toggle the visibility of grids')],
];

/**
 * Register the doc.* actions for guides and grids. The states of the toggle
 * actions follow the namedview of the active document (upstream
 * SPNamedView::updateGuides and updateGrids).
 */
export function add_actions_edit_document(app: InkscapeApplication): void {
  const map = app.actions.doc;
  const run = (f: (doc: SPDocument) => void) => () => {
    const doc = app.get_active_document();
    if (doc) f(doc);
  };
  map.add_action('create-guides-around-page', run(sp_guide_create_guides_around_page));
  map.add_action('delete-all-guides', run(sp_guide_delete_all_guides));
  const lock = map.add_action_bool(
    'lock-all-guides',
    run((doc) => doc.getNamedView().toggleLockGuides()),
  );
  const show = map.add_action_bool(
    'show-all-guides',
    run((doc) => doc.getNamedView().toggleShowGuides()),
    true,
  );
  const grids = map.add_action_bool(
    'show-grids',
    run((doc) => doc.getNamedView().toggleShowGrids()),
  );
  app.get_action_extra_data().add_data(raw_data_edit_document);

  // Keep the states in sync with the namedview of the active document.
  let disconnect: (() => void) | null = null;
  const update = () => {
    const nv = app.get_active_document()?.getNamedView();
    show.change_state(nv?.getShowGuides() ?? true);
    lock.change_state(nv?.getLockGuides() ?? false);
    grids.change_state(nv?.getShowGrids() ?? false);
  };
  app.signal_active_changed.connect(() => {
    disconnect?.();
    const nv = app.get_active_document()?.getNamedView();
    const off = [nv?.changedSignal.connect(update), nv?.guidesAndGridsChangedSignal.connect(update)];
    // Grid visibility is an attribute of the grids.
    const gridsOff = () => nv?.grids.map((g) => g.changedSignal.connect(update)) ?? [];
    let offGrids = gridsOff();
    const offList = nv?.guidesAndGridsChangedSignal.connect(() => {
      for (const f of offGrids) f();
      offGrids = gridsOff();
    });
    disconnect = () => {
      for (const f of [...off, ...offGrids, offList]) f?.();
    };
    update();
  });
}
