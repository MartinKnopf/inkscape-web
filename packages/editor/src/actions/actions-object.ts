// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-object.cpp, src/actions/actions-object.h
/*
 * Gio::Actions for working with objects without GUI.
 *
 * Copyright (C) 2020 Tavmjong Bah
 */
import { C_, DocumentUndo, N_, NC_, Preferences, type Selection, toCurves } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';

const SECTION = NC_('Action Section', 'Object');

/**
 * Action id, label, section and tooltip (untranslated).
 * TODO: attributes, inverse clip and mask (Power Clip/Mask LPE), clip group, …
 */
export const raw_data_object: readonly (readonly [string, string, string, string])[] = [
  ['app.object-to-path', N_('Object to Path'), SECTION, N_('Convert shapes to paths')],
  ['app.object-rotate-90-cw', N_('Rotate Object 90°'), SECTION, N_('Rotate selected objects 90° clockwise')],
  [
    'app.object-rotate-90-ccw',
    N_('Rotate Object 90° CCW'),
    SECTION,
    N_('Rotate selected objects 90° counter-clockwise'),
  ],
  [
    'app.object-flip-horizontal',
    N_('Flip Object Horizontally'),
    SECTION,
    N_('Flip selected objects horizontally'),
  ],
  ['app.object-flip-vertical', N_('Flip Object Vertically'), SECTION, N_('Flip selected objects vertically')],
  [
    'app.object-set-clip',
    N_('Set Object Clipping'),
    SECTION,
    N_('Apply clipping path to selection (using the topmost object as clipping path)'),
  ],
  [
    'app.object-release-clip',
    N_('Release Object Clipping'),
    SECTION,
    N_('Remove clipping path from selection'),
  ],
  [
    'app.object-set-mask',
    N_('Set Object Mask'),
    SECTION,
    N_('Apply mask to selection (using the topmost object as mask)'),
  ],
  ['app.object-release-mask', N_('Release Object Mask'), SECTION, N_('Remove mask from selection')],
];

function should_remove_original(): boolean {
  return Preferences.get().getBool('/options/maskobject/remove', true);
}

/** Set or release a clip path (clip) or mask, with an undo step (upstream object_clip_set etc.). */
function object_mask(selection: Selection, clip: boolean, set: boolean): void {
  const doc = selection.document();
  if (!doc) return;
  if (set) {
    selection.setMask(clip, false, should_remove_original());
    DocumentUndo.done(doc, clip ? C_('Undo', 'Set clipping path') : C_('Undo', 'Set mask'), '');
  } else {
    // TODO: sp_remove_powerclip / sp_remove_powermask (LPE).
    selection.unsetMask(clip, true, should_remove_original());
    DocumentUndo.done(doc, clip ? C_('Undo', 'Release clipping path') : C_('Undo', 'Release mask'), '');
  }
}

function yaxisdown(selection: Selection): boolean {
  const doc = selection.document();
  return !doc || doc.yaxisdir() > 0;
}

/** Scale the selection by (sx, sy) around its center, with an undo step. */
function object_flip(selection: Selection, sx: number, sy: number, description: string, icon: string): void {
  const bbox = selection.visualBounds();
  const doc = selection.document();
  if (!bbox || !doc) return;
  // Get center
  const center = selection.center() ?? bbox.midpoint();
  selection.scaleRelative(center, sx, sy);
  DocumentUndo.done(doc, description, icon);
}

export function add_actions_object(app: InkscapeApplication): void {
  const add = (name: string, run: (selection: Selection) => void) =>
    app.actions.app.add_action(name, () => {
      const selection = app.get_active_selection();
      if (selection) run(selection);
    });
  // TODO: /options/clonestocurvesjustunlink/value (clones).
  add('object-to-path', (s) => toCurves(s));
  add('object-rotate-90-cw', (s) => s.rotateAnchored(yaxisdown(s) ? 90 : -90));
  add('object-rotate-90-ccw', (s) => s.rotateAnchored(yaxisdown(s) ? -90 : 90));
  add('object-flip-horizontal', (s) =>
    object_flip(s, -1, 1, C_('Undo', 'Flip horizontally'), 'object-flip-horizontal'),
  );
  add('object-flip-vertical', (s) =>
    object_flip(s, 1, -1, C_('Undo', 'Flip vertically'), 'object-flip-vertical'),
  );
  add('object-set-clip', (s) => object_mask(s, true, true));
  add('object-release-clip', (s) => object_mask(s, true, false));
  add('object-set-mask', (s) => object_mask(s, false, true));
  add('object-release-mask', (s) => object_mask(s, false, false));
  app.get_action_extra_data().add_data(raw_data_object);
}
