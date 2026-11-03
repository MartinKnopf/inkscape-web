// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/extensions-gallery.cpp, src/ui/dialog/extensions-gallery.h
/*
 * Extension gallery
 *
 * Authors:
 *   Mike Kowalski
 *
 * Copyright (C) 2023 Authors
 */
// The model of the Filter Gallery: the filter effects as items with category, access path and
// sort order, the category list, the search, and the thumbnails (share/ui/resources/filter-test.svg
// with the filter applied to its test object).
import { _, SPDocument, SPItem, SVG_NS_URI, saveBuf } from '@inkscape-web/core';
import type { Filter } from '../../extension/internal/filter/filter.ts';

/** An effect of the gallery (upstream EffectItem); texts are translated. */
export interface EffectItem {
  /** Extension id (the action is app.<id>). */
  id: string;
  /** Effect's name. */
  name: string;
  /** Short description (the menu tip). */
  description: string;
  /** Menu access path, "Blurs ▸ Blur". */
  access: string;
  /** String to sort items. */
  order: string;
  /** Category (the first menu). */
  category: string;
  effect: Filter;
}

/** The items of the effects, sorted by menu and name (upstream add_effects). */
export function add_effects(effects: readonly Filter[]): EffectItem[] {
  const items = effects.map((effect): EffectItem => {
    const name = _(effect.name).replace('...', '').replace('…', '').replace('_', '');
    const menu = effect.menu.map((m) => _(m));
    return {
      id: effect.get_sanitized_id(),
      name,
      description: effect.menu_tip ? _(effect.menu_tip) : '',
      access: [...menu, name].join(' ▸ '), // right pointing triangle
      order: [...menu, name].join('\n'),
      category: menu[0] ?? '',
      effect,
    };
  });
  return items.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
}

/** The categories: "all" first, then the categories of the items, sorted (upstream add_categories). */
export function add_categories(items: readonly EffectItem[]): string[] {
  return ['all', ...[...new Set(items.map((i) => i.category).filter((c) => c))].sort()];
}

/** Whether item shows in the category with the search text (upstream is_item_visible). */
export function is_item_visible(item: EffectItem, category: string, search: string): boolean {
  if (category !== 'all' && category !== item.category) return false;
  const str = search.toLowerCase();
  return !str || item.access.toLowerCase().includes(str);
}

/** The thumbnail size of the size index (upstream get_thumbnail_size, filters). */
export function get_thumbnail_size(index: number): number {
  const min_size = 50;
  const factor = 2.0 ** (1.0 / 6.0);
  return Math.round(factor ** index * min_size);
}

/**
 * The SVG source of the thumbnail of effect: test_svg (filter-test.svg) with the filter
 * applied to its test object (upstream render_icon); null if it cannot be made.
 */
export function render_icon_svg(effect: Filter, test_svg: string): string | null {
  const doc = SPDocument.createNewDocFromMem(test_svg);
  if (!doc) return null;
  const item = doc.getObjectById('test-object');
  if (item instanceof SPItem) effect.apply_filter(item);
  return saveBuf(doc.getReprDoc(), SVG_NS_URI);
}
