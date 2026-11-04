// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-selection.cpp, src/actions/actions-selection.h
/*
 * Gio::Actions for selection tied to the application and without GUI.
 *
 * Copyright (C) 2018 Tavmjong Bah
 *
 * The contents of this file may be used under the GNU General Public License Version 2 or later.
 */
import { N_, NC_, SPGroup, SPItem, type SPObject } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';

const SECTION = NC_('Action Section', 'Select');

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_selection: readonly (readonly [string, string, string, string])[] = [
  ['app.select-clear', N_('Clear Selection'), SECTION, N_('Clear selection')],
  ['app.select', N_('Select'), SECTION, N_('Select by ID (deprecated)')],
  ['app.unselect', N_('Deselect'), SECTION, N_('Deselect by ID (deprecated)')],
  ['app.select-by-id', N_('Select by ID'), SECTION, N_('Select by ID')],
  ['app.unselect-by-id', N_('Deselect by ID'), SECTION, N_('Deselect by ID')],
  ['app.select-by-class', N_('Select by Class'), SECTION, N_('Select by class')],
  ['app.select-by-element', N_('Select by Element'), SECTION, N_("Select by SVG element (e.g. 'rect')")],
  ['app.select-by-selector', N_('Select by Selector'), SECTION, N_('Select by CSS selector')],
  [
    'app.select-all',
    N_('Select All Objects'),
    SECTION,
    N_(
      "Select all; options: 'all' (every object including groups), 'layers', 'no-layers' (top level objects in layers), 'groups' (all groups including layers), 'no-groups' (all objects other than groups and layers, default)",
    ),
  ],
  ['app.select-list', N_('List Selection'), SECTION, N_('Print a list of objects in current selection')],
];

const CONDITIONS = ['', 'layers', 'no-layers', 'groups', 'no-groups', 'all'];

/**
 * The items below object that match condition (upstream get_all_items_recursive):
 * 'layers', 'groups' (including layers), 'no-layers' (top level objects in all layers),
 * 'no-groups' (default: all objects other than groups and layers) and 'all'.
 */
export function get_all_items_recursive(objects: SPObject[], object: SPObject, condition: string): void {
  for (const o of object.childList()) {
    if (!(o instanceof SPItem)) continue;
    const group = o instanceof SPGroup ? o : null;
    const is_layer = group?.isLayer() ?? false;
    if (condition === 'layers') {
      if (is_layer) {
        objects.push(o);
        continue; // Layers cannot contain layers.
      }
    } else if (condition === 'no-layers') {
      if (!is_layer) {
        objects.push(o);
        continue;
      } // else recurse one level
    } else if (condition === 'groups') {
      if (group) objects.push(o);
    } else if (condition === 'all') {
      objects.push(o);
    } else if (!group) {
      // no-groups, default
      objects.push(o);
      continue; // Non-groups cannot contain items.
    }
    get_all_items_recursive(objects, o, condition);
  }
}

export function add_actions_selection(app: InkscapeApplication): void {
  const actions = app.actions.app;
  const ids = (text: string) => text.split(/\s*,\s*/);

  actions.add_action('select-clear', () => app.get_active_selection()?.clear());

  const by_id = (add: boolean) => (text: string) => {
    const document = app.get_active_document();
    const selection = app.get_active_selection();
    if (!document || !selection) return;
    for (const id of ids(text)) {
      const object = document.getObjectById(id);
      if (!object) console.warn(`${add ? 'select' : 'unselect'}_by_id: Did not find object with id: ${id}`);
      else if (add) selection.add(object);
      else selection.remove(object);
    }
  };
  // "select" is the backwards compatible name of select-by-id.
  actions.add_action_with_parameter('select', 's', by_id(true));
  actions.add_action_with_parameter('unselect', 's', by_id(false));
  actions.add_action_with_parameter('select-by-id', 's', by_id(true));
  actions.add_action_with_parameter('unselect-by-id', 's', by_id(false));

  const by =
    (find: (document: NonNullable<ReturnType<typeof app.get_active_document>>, text: string) => SPObject[]) =>
    (text: string) => {
      const document = app.get_active_document();
      if (document) app.get_active_selection()?.addList(find(document, text));
    };
  actions.add_action_with_parameter(
    'select-by-class',
    's',
    by((d, t) => d.getObjectsByClass(t)),
  );
  actions.add_action_with_parameter(
    'select-by-element',
    's',
    by((d, t) => d.getObjectsByElement(t)),
  );
  actions.add_action_with_parameter(
    'select-by-selector',
    's',
    by((d, t) => d.getObjectsBySelector(t)),
  );

  const matching = (condition: string): SPObject[] | null => {
    const document = app.get_active_document();
    if (!document) return null;
    if (!CONDITIONS.includes(condition)) {
      console.warn(
        "select_all: allowed options are '', 'all', 'layers', 'no-layers', 'groups', and 'no-groups'",
      );
      return null;
    }
    const objects: SPObject[] = [];
    get_all_items_recursive(objects, document.getRoot(), condition);
    return objects;
  };
  actions.add_action_with_parameter('select-all', 's', (condition) => {
    const objects = matching(condition);
    if (objects) app.get_active_selection()?.setList(objects);
  });
  actions.add_action_with_parameter('select-invert', 's', (condition) => {
    const selection = app.get_active_selection();
    const objects = matching(condition);
    if (!objects || !selection) return;
    const current = selection.items();
    selection.setList(objects.filter((o) => !current.includes(o as SPItem)));
  });

  // Debug... print selected items
  actions.add_action('select-list', () => {
    for (const obj of app.get_active_selection()?.objects() ?? [])
      console.log(obj.getRepr().name(), obj.getId());
  });
  app.get_action_extra_data().add_data(raw_data_selection);
}
