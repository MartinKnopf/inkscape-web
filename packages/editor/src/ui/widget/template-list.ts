// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/template-list.cpp, src/ui/widget/template-list.h
/*
 * The list of templates of the New from Template dialog and the Save as Template dialog: the
 * template presets in one page for each category (the view is in the web app).
 *
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2022 Authors
 */
import { _, C_, NC_, type SPDocument } from '@inkscape-web/core';
import { db } from '../../extension/db.ts';
import { Template, type TemplatePreset, type TemplateShow } from '../../extension/template.ts';

/** One template of the list (upstream TemplateItem). */
export interface TemplateItem {
  name: string;
  label: string;
  tooltip: string;
  /** The URL of the icon. */
  icon: string;
  key: string;
  priority: number;
  category: string;
}

/** The key of the placeholder for a template that does not exist yet. */
export const NEW_TEMPLATE_KEY = '-new-template-';

/** The name of the page with all templates. */
export const all_templates = NC_('TemplateCategory', 'All templates');

/** What pages the list has: one for each category and one with all templates, or only the custom category. */
export type TemplateAddPage = 'all' | 'custom';

/** The list of the templates with presets in a visibility (upstream TemplateList). */
export class TemplateList {
  /** The pages in order: items are sorted by priority. */
  readonly pages: { name: string; items: TemplateItem[] }[] = [];

  /**
   * Make the pages for the presets with the visibility mode (upstream init). With 'custom', only
   * the category "Custom" is listed, with the placeholder "<new template>".
   */
  constructor(mode: TemplateShow, add_page: TemplateAddPage = 'all') {
    const all = add_page === 'all' ? this.#page(all_templates) : null;

    let group = 0;
    for (const tmod of db.get_template_list()) {
      for (const preset of tmod.get_presets(mode)) {
        const cat = preset.get_category();
        if (add_page === 'custom' && cat !== 'Custom') continue;
        let store = this.pages.find((p) => p.name === cat);
        if (!store) {
          group += 10000;
          store = this.#page(cat);
          if (add_page === 'custom') {
            // add new template placeholder
            store.items.push({
              name: _('<new template>'),
              label: '',
              tooltip: '',
              icon: Template.icon_url('custom'),
              key: NEW_TEMPLATE_KEY,
              priority: -1,
              category: cat,
            });
          }
        }
        const item = TemplateList.#item(preset, group);
        store.items.push(item);
        all?.items.push(item);
      }
    }
    for (const page of this.pages) page.items.sort((a, b) => a.priority - b.priority);
  }

  static #item(preset: TemplatePreset, group: number): TemplateItem {
    const name = preset.get_name();
    const desc = preset.get_description();
    const label = preset.get_label();
    return {
      name: _(name),
      label: label ? _(label) : '',
      tooltip: _(desc || name),
      icon: preset.get_icon_path(),
      key: preset.get_key(),
      priority: group + preset.get_sort_priority(),
      category: preset.get_category(),
    };
  }

  #page(name: string) {
    const page = { name, items: [] as TemplateItem[] };
    this.pages.push(page);
    return page;
  }

  /** The translated name of a page (upstream get_category_label). */
  static get_category_label(cat: string): string {
    return C_('TemplateCategory', cat);
  }

  /** The items of a page whose name or label contain the search text (upstream filter). */
  items(page: string, search = ''): TemplateItem[] {
    const items = this.pages.find((p) => p.name === page)?.items ?? [];
    const term = search.toLowerCase();
    if (!term) return items;
    return items.filter((i) => i.label.toLowerCase().includes(term) || i.name.toLowerCase().includes(term));
  }

  /** The preset of a key (upstream get_selected_preset). */
  static get_preset(key: string): TemplatePreset | null {
    return Template.get_any_preset(key);
  }

  /**
   * Make a document from the preset of key (upstream new_document). Null if the preset is
   * unknown or the user canceled the options of the template.
   */
  static async new_document(key: string): Promise<SPDocument | null> {
    const preset = TemplateList.get_preset(key);
    return preset ? preset.new_from_template() : null;
  }
}
