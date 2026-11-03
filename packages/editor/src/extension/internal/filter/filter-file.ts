// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/filter/filter-file.cpp
/*
 * Copyright (C) 2008 Authors:
 *   Ted Gould <ted@gould.cx>
 */
import { N_, type Node, readMem, SVG_NS_URI } from '@inkscape-web/core';
import { Filter } from './filter.ts';

/** The filter effects of the filter files, in the order loaded (upstream: the effects in Extension::db). */
export const filter_effects: Filter[] = [];

/**
 * Load the filters of the defs of an SVG file as effects (upstream filters_load_file);
 * menuname is the submenu of filters without inkscape:menu.
 */
export function filters_load_file(text: string, menuname: string): Filter[] {
  const doc = readMem(text, SVG_NS_URI);
  if (!doc) {
    console.warn('File is not parseable as XML.  Ignored.');
    return [];
  }
  const root = doc.root();
  if (root?.name() !== 'svg:svg') {
    console.warn('File is not SVG.  Ignored.');
    return [];
  }
  const loaded: Filter[] = [];
  for (let child = root.firstChild(); child; child = child.next()) {
    if (child.name() !== 'svg:defs') continue;
    for (let defs = child.firstChild(); defs; defs = defs.next()) {
      if (defs.name() === 'svg:filter') loaded.push(filters_load_node(defs, menuname));
    }
  }
  filter_effects.push(...loaded);
  return loaded;
}

/** The effect of one filter of a filter file (upstream Filter::filters_load_node). */
export function filters_load_node(node: Node, menuname: string): Filter {
  const id = node.attribute('id') ?? '';
  const label = node.attribute('inkscape:label') ?? id;
  const menu = node.attribute('inkscape:menu');
  const menu_tooltip = node.attribute('inkscape:menu-tooltip');
  return new Filter(
    `org.inkscape.effect.filter.${id}`,
    label,
    [menu ?? menuname],
    menu_tooltip ?? label,
    node,
  );
}

/**
 * Load the bundled filter file share/filters/filters.svg (upstream filters_all_files).
 * TODO: the user's filter files (USER and SHARED, menu "Personal").
 */
export async function filters_all_files(
  fetchText: (path: string) => Promise<string | null>,
): Promise<Filter[]> {
  const text = await fetchText('/share/filters/filters.svg');
  return text ? filters_load_file(text, N_('Bundled')) : [];
}
