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
import type { Effect } from '../../extension/effect.ts';
import { Filter } from '../../extension/internal/filter/filter.ts';

/** What the gallery shows: the extensions of the Extensions menu or the filter presets of the Filters menu. */
export enum GalleryType {
  Effects,
  Filters,
}

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
  effect: Filter | Effect;
  /** The effect has parameters: its button says "Run..." (upstream takes_input). */
  takes_input: boolean;
}

/** The effects of the Extensions menu that the gallery shows: not hidden from the menu, not filters (upstream prepare_effects). */
export function prepare_effects(effects: readonly Effect[]): Effect[] {
  return effects.filter((e) => !e.hidden_from_menu() && !e.is_filter_effect());
}

/** The items of the effects, sorted by menu and name (upstream add_effects). */
export function add_effects(effects: readonly (Filter | Effect)[]): EffectItem[] {
  const items = effects.map((effect): EffectItem => {
    // The names of Effect extensions are translated already; the menu is in the effect's translation.
    const is_filter = effect instanceof Filter;
    const name = (is_filter ? _(effect.name) : effect.get_name())
      .replace('...', '')
      .replace('…', '')
      .replace('_', '');
    const menu = is_filter ? effect.menu.map((m) => _(m)) : effect.get_menu_list();
    return {
      id: effect.get_sanitized_id(),
      name,
      description: is_filter ? (effect.menu_tip ? _(effect.menu_tip) : '') : effect.get_menu_tip(),
      access: [...menu, name].join(' ▸ '), // right pointing triangle
      order: [...menu, name].join('\n'),
      category: menu[0] ?? '',
      effect,
      takes_input: !is_filter && effect.takes_input(),
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
export function render_icon_svg(effect: Filter | Effect, test_svg: string): string | null {
  // The icons of extensions are not rendered: they all show the placeholder (missing-icon.svg).
  if (!(effect instanceof Filter)) return test_svg;
  const doc = SPDocument.createNewDocFromMem(test_svg);
  if (!doc) return null;
  const item = doc.getObjectById('test-object');
  if (item instanceof SPItem) effect.apply_filter(item);
  return saveBuf(doc.getReprDoc(), SVG_NS_URI);
}
