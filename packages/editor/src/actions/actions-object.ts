// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-object.cpp, src/actions/actions-object.h
/*
 * Gio::Actions for working with objects without GUI.
 *
 * Copyright (C) 2020 Tavmjong Bah
 */
import {
  C_,
  DocumentUndo,
  Effect,
  EffectType,
  N_,
  NC_,
  Preferences,
  type Selection,
  type SPDocument,
  SPLPEItem,
  sp_inverse_powermask,
  sp_remove_powermask,
  spReprCssAttr,
  spReprCssProperty,
  spReprCssSet,
  spReprCssSetProperty,
  strokesToPaths,
  toCurves,
} from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { show_output } from './actions-helper.ts';

const SECTION = NC_('Action Section', 'Object');

/**
 * Action id, label, section and tooltip (untranslated).
 * TODO: attributes, inverse clip and mask (Power Clip/Mask LPE), clip group, …
 */
export const raw_data_object: readonly (readonly [string, string, string, string])[] = [
  ['app.object-stroke-to-path', N_('Stroke to Path'), SECTION, N_('Convert strokes to paths')],
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
  ['app.object-add-corners-lpe', N_('Add Corners LPE'), SECTION, N_('Add Corners Live Path Effect to path')],
  [
    'app.object-set-clip-group',
    N_('Set Object Clipping Group'),
    SECTION,
    N_('Create a self-clipping group to which objects (not contributing to the clip-path) can be added'),
  ],
  [
    'app.object-set-inverse-mask',
    N_('Set Object Inverse Mask'),
    SECTION,
    N_('Apply inverse mask to selection (Power Mask LPE)'),
  ],
  [
    'app.object-set-mask',
    N_('Set Object Mask'),
    SECTION,
    N_('Apply mask to selection (using the topmost object as mask)'),
  ],
  ['app.object-release-mask', N_('Release Object Mask'), SECTION, N_('Remove mask from selection')],
  [
    'app.object-set-attribute',
    N_('Set Attribute'),
    SECTION,
    N_(
      'Set or update an attribute of selected objects; usage: object-set-attribute:attribute name, attribute value;',
    ),
  ],
  [
    'app.object-set-property',
    N_('Set Property'),
    SECTION,
    N_(
      'Set or update a property on selected objects; usage: object-set-property:property name, property value;',
    ),
  ],
  [
    'app.object-get-attribute',
    N_('Get Attribute'),
    SECTION,
    N_('Get the attribute of selected objects; usage: object-get-attribute:attribute name;'),
  ],
  [
    'app.object-get-property',
    N_('Get Property'),
    SECTION,
    N_('Get the property of selected objects; usage: object-get-property:property name;'),
  ],
  [
    'app.object-remove-attribute',
    N_('Remove Attribute'),
    SECTION,
    N_('Remove the attribute from selected objects; usage: object-remove-attribute:attribute name;'),
  ],
  [
    'app.object-remove-property',
    N_('Remove Property'),
    SECTION,
    N_('Remove the property from selected objects; usage: object-remove-property:property name;'),
  ],
  ['app.object-unlink-clones', N_('Unlink Clones'), SECTION, N_('Unlink clones and symbols')],
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
    // TODO: sp_remove_powerclip (LPE).
    if (!clip) sp_remove_powermask(selection);
    selection.unsetMask(clip, true, should_remove_original());
    DocumentUndo.done(doc, clip ? C_('Undo', 'Release clipping path') : C_('Undo', 'Release mask'), '');
  }
}

/** Add the Corners effect (fillet/chamfer) to the selected items, or remove it if they have it. */
function object_add_corners_lpe(selection: Selection): void {
  const document = selection.document();
  if (!document) return;
  const items = selection.items();
  selection.clear();
  for (const item of items) {
    if (item instanceof SPLPEItem) {
      const lpe = item.getFirstPathEffectOfType(EffectType.FILLET_CHAMFER);
      if (lpe) {
        item.removePathEffect(lpe, false);
        DocumentUndo.done(document, C_('Undo', 'Remove Live Path Effect'), 'dialog-path-effects');
      } else {
        Effect.createAndApply('fillet_chamfer', document, item);
        DocumentUndo.done(document, C_('Undo', 'Create and apply path effect'), 'dialog-path-effects');
      }
      const current = item.getCurrentLPE();
      if (current) current.refresh_widgets = true;
    }
    selection.add(item);
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
  add('object-stroke-to-path', (s) => void strokesToPaths(s));
  add('object-rotate-90-cw', (s) => s.rotateAnchored(yaxisdown(s) ? 90 : -90));
  add('object-rotate-90-ccw', (s) => s.rotateAnchored(yaxisdown(s) ? -90 : 90));
  add('object-flip-horizontal', (s) =>
    object_flip(s, -1, 1, C_('Undo', 'Flip horizontally'), 'object-flip-horizontal'),
  );
  add('object-flip-vertical', (s) =>
    object_flip(s, 1, -1, C_('Undo', 'Flip vertically'), 'object-flip-vertical'),
  );
  add('object-set-clip', (s) => object_mask(s, true, true));
  add('object-set-clip-group', (s) => s.setClipGroup()); // the undo step is added by setClipGroup()
  add('object-set-inverse-mask', (s) => {
    const doc = s.document();
    s.setMask(false, false, should_remove_original());
    sp_inverse_powermask(s);
    if (doc) DocumentUndo.done(doc, C_('Undo', 'Set Inverse Mask (LPE)'), '');
  });
  add('object-add-corners-lpe', (s) => object_add_corners_lpe(s));
  add('object-release-clip', (s) => object_mask(s, true, false));
  add('object-set-mask', (s) => object_mask(s, false, true));
  add('object-release-mask', (s) => object_mask(s, false, false));
  add('object-unlink-clones', (s) => void s.unlink());

  // The attribute and property actions work on the XML of the selected objects; no sanity checking.
  const param = (name: string, run: (value: string, selection: Selection, doc: SPDocument) => void) =>
    app.actions.app.add_action_with_parameter(name, 's', (value) => {
      const selection = app.get_active_selection();
      const doc = app.get_active_document();
      if (!doc || !selection) return;
      if (selection.isEmpty()) {
        show_output(`action:${name.replaceAll('-', '_')}: selection empty!`);
        return;
      }
      run(value, selection, doc);
    });
  param('object-get-attribute', (attribute, selection) => {
    for (const obj of selection.objects()) show_output(obj.getRepr().attribute(attribute) ?? '', false);
  });
  param('object-get-property', (property, selection) => {
    for (const obj of selection.objects()) {
      show_output(spReprCssProperty(spReprCssAttr(obj.getRepr(), 'style'), property, ''), false);
    }
  });
  param('object-remove-attribute', (attribute, selection, doc) => {
    for (const obj of selection.objects()) obj.getRepr().removeAttribute(attribute);
    DocumentUndo.done(doc, C_('Undo', 'Action remove attribute from objects'), '');
  });
  param('object-remove-property', (property, selection, doc) => {
    for (const obj of selection.objects()) {
      const css = spReprCssAttr(obj.getRepr(), 'style');
      spReprCssSetProperty(css, property, null);
      spReprCssSet(obj.getRepr(), css, 'style');
    }
    DocumentUndo.done(doc, C_('Undo', 'Action remove property from objects'), '');
  });
  param('object-set-attribute', (argument, selection, doc) => {
    const comma = argument.indexOf(',');
    if (comma <= 0) {
      show_output("action:object_set_attribute: requires 'attribute name, attribute value'");
      return;
    }
    for (const obj of selection.objects()) {
      obj.getRepr().setAttribute(argument.slice(0, comma), argument.slice(comma + 1));
    }
    // Needed to update repr (is this the best way?).
    DocumentUndo.done(doc, 'ActionObjectSetAttribute', '');
  });
  param('object-set-property', (argument, selection, doc) => {
    const tokens = argument.split(',');
    if (tokens.length !== 2) {
      show_output("action:object_set_property: requires 'property name, property value'");
      return;
    }
    for (const obj of selection.objects()) {
      const css = spReprCssAttr(obj.getRepr(), 'style');
      spReprCssSetProperty(css, tokens[0] as string, tokens[1] as string);
      spReprCssSet(obj.getRepr(), css, 'style');
    }
    DocumentUndo.done(doc, 'ActionObjectSetProperty', '');
  });
  app.get_action_extra_data().add_data(raw_data_object);
}
