// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/template.cpp, src/extension/template.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2022 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { DocumentUndo, type Node, SPDocument, type SPPage } from '@inkscape-web/core';
import { db } from './db.ts';
import { Extension, ExtensionState } from './extension.ts';
import type { Implementation } from './implementation/implementation.ts';
import { INKSCAPE_EXTENSION_NS } from './prefdialog/widget.ts';

/** What a template preset is shown in (upstream TemplateVisibility); a bit mask, except for ANY. */
export const TemplateVisibility = {
  /** Any visibility */
  TEMPLATE_ANY: -1,
  TEMPLATE_HIDDEN: 0,
  TEMPLATE_NEW_FROM: 1,
  TEMPLATE_NEW_WELCOME: 2,
  TEMPLATE_NEW_ICON: 3,
  TEMPLATE_SIZE_LIST: 4,
  TEMPLATE_SIZE_SEARCH: 8,
  /** Set as visible everywhere */
  TEMPLATE_ALL: 255,
} as const;

/** A visibility value (upstream TemplateShow). */
export type TemplateShow = number;

/** The preferences that a preset sets in its extension: parameter name to value. */
export type TemplatePrefs = Map<string, string>;

/** The text of the first descendant element with the name, or def (upstream sp_repr_lookup_content). */
export function sp_repr_lookup_content(repr: Node, name: string, def = ''): string {
  const find = (node: Node, depth: number): Node | null => {
    if (node.name() === name) return node;
    if (depth === 0) return null;
    for (const child of node.children()) {
      const found = find(child, depth - 1);
      if (found) return found;
    }
    return null;
  };
  const node = find(repr, -1);
  return node ? (node.firstChild()?.content() ?? def) : def;
}

/** A template with the preferences that make one of its documents (upstream TemplatePreset). */
export class TemplatePreset {
  _mod: Template;
  _key: string;
  _icon: string;
  _name = 'Unnamed';
  _label = '';
  _desc = '';
  _category: string;
  _priority: number;
  _visibility: number;
  /** This is a set of preferences given to the extension */
  _prefs: TemplatePrefs;

  /** Parse the inx xml node for preset information. */
  constructor(mod: Template, repr: Node | null, prefs: TemplatePrefs = new Map(), priority = 0) {
    this._mod = mod;
    this._prefs = new Map(prefs);
    this._priority = priority;
    this._visibility = mod.get_visibility();
    // Default icon and priority aren't a prefs, though they may at first look like it.
    this._icon = mod.get_icon();
    this._category = mod.get_category();

    if (repr) {
      for (const [name, value] of repr.attributeList()) {
        if (name === 'name') this._name = value === '' ? '?' : value;
        else if (name === 'label') this._label = value;
        else if (name === 'desc') this._desc = value;
        else if (name === 'icon') this._icon = value;
        else if (name === 'priority') this._priority = Number.parseInt(value, 10);
        else if (name === 'visibility') this._visibility = Template.parse_visibility(value);
        else this._prefs.set(name, value);
      }
    }

    // Generate a standard name that can be used to recall this preset.
    this._key = `${mod.get_id()}.${this._name}`.toLowerCase();
  }

  get_key(): string {
    return this._key;
  }
  get_icon(): string {
    return this._icon;
  }
  get_category(): string {
    return this._category;
  }
  get_name(): string {
    return this._name;
  }
  get_label(): string {
    return this._label;
  }
  get_description(): string {
    return this._desc;
  }
  get_sort_priority(): number {
    return this._priority;
  }
  get_visibility(): number {
    return this._visibility;
  }

  /** Whether the preset is shown in mode: not hidden and it contains the requested mode. */
  is_visible(mode: TemplateShow): boolean {
    return (
      this._visibility !== 0 &&
      (mode === TemplateVisibility.TEMPLATE_ANY || (this._visibility & mode) === mode)
    );
  }

  /**
   * The URL of the icon (upstream get_icon_path): the icons folder of the templates, or the
   * default icon.
   */
  get_icon_path(): string {
    return Template.icon_url(this._icon || 'default');
  }

  /**
   * Setup the preferences and ask the user to fill in the remainder. True if the preferences
   * have been shown or not using GUI, false if canceled.
   */
  async setup_prefs(others: TemplatePrefs = new Map()): Promise<boolean> {
    this._add_prefs(this._prefs);
    this._add_prefs(others);
    const ret = await this._mod.prefs();
    for (const name of this._prefs.keys()) {
      try {
        this._mod.set_param_hidden(name, false);
      } catch {
        // pass
      }
    }
    return ret;
  }

  /** Called by setup_prefs to save the given prefs into this extension. */
  _add_prefs(prefs: TemplatePrefs): void {
    for (const [name, value] of prefs) {
      try {
        this._mod.set_param_any(name, value);
        this._mod.set_param_hidden(name, true);
      } catch {
        // pass: the extension has no such parameter
      }
    }
  }

  /**
   * Generate a new document from this preset. Sets the preferences and then calls back to its
   * parent extension. Null if the user canceled.
   */
  async new_from_template(others: TemplatePrefs = new Map()): Promise<SPDocument | null> {
    if (await this.setup_prefs(others)) return this._mod.new_from_template();
    return null;
  }

  /** Resize the given page to however the page format requires it to be. */
  async resize_to_template(
    doc: SPDocument,
    page: SPPage | null,
    others: TemplatePrefs = new Map(),
  ): Promise<void> {
    if (this._mod.can_resize() && (await this.setup_prefs(others))) {
      await this._mod.resize_to_template(doc, page);
    }
  }

  /** Reverse match for templates, allowing page duplication and labeling. */
  match_size(width: number, height: number, others: TemplatePrefs = new Map()): boolean {
    if (
      this.is_visible(TemplateVisibility.TEMPLATE_SIZE_SEARCH) ||
      this.is_visible(TemplateVisibility.TEMPLATE_SIZE_LIST)
    ) {
      this._add_prefs(this._prefs);
      this._add_prefs(others);
      return this._mod.imp.match_template_size(this._mod, width, height);
    }
    return false;
  }
}

/** An extension that makes new documents, with presets (upstream Template). */
export class Template extends Extension {
  /**
   * The SVG files of the template folder by name (upstream: the TEMPLATES resource folder),
   * for example "default.svg" and "A4leaflet-3fold-Roll.svg". The web app fills it.
   */
  static files = new Map<string, string>();
  /** The folder URL of the template icons. */
  static icons_url = '/share/templates/icons';
  /** Shows the parameters of a template to the user; true for OK. Set by the web app. */
  static show_prefs: ((template: Template) => Promise<boolean>) | null = null;

  _source = '';
  _icon = '';
  _desc = '';
  _category = '';
  /** Can this be used to resize existing pages? */
  _can_resize = false;
  _visibility: number = TemplateVisibility.TEMPLATE_SIZE_SEARCH;
  _presets: TemplatePreset[] = [];
  /** The sort priority of the template (upstream get_sort_priority; the default for the presets). */
  _sort_priority = 0;

  /** Builds a Template object from a XML description. */
  constructor(in_repr: Node, implementation: Implementation, base_directory = '') {
    super(in_repr, implementation, base_directory);

    const t_node = find_name(in_repr, `${INKSCAPE_EXTENSION_NS}template`, 1);
    if (!t_node) return;

    this._source = sp_repr_lookup_content(in_repr, `${INKSCAPE_EXTENSION_NS}source`);
    this._desc = sp_repr_lookup_content(in_repr, `${INKSCAPE_EXTENSION_NS}description`);
    this._category = sp_repr_lookup_content(in_repr, `${INKSCAPE_EXTENSION_NS}category`, 'Other');

    // Remember any global/default preferences from the root node.
    const prefs: TemplatePrefs = new Map();
    for (const [name, value] of t_node.attributeList()) {
      if (name === 'icon') this._icon = value;
      else if (name === 'visibility') this._visibility = Template.parse_visibility(value);
      else if (name === 'priority') this._sort_priority = Number.parseInt(value, 10);
      else prefs.set(name, value);
    }

    // Default priority will increment to keep inx order where possible.
    let priority = this._sort_priority;
    for (const p_node of t_node.children()) {
      if (p_node.name() !== `${INKSCAPE_EXTENSION_NS}preset`) continue;
      const preset = new TemplatePreset(this, p_node, prefs, priority);
      this._presets.push(preset);
      priority += 1;

      // If any preset is resizable, then the module is considered to support it.
      if (
        preset.is_visible(TemplateVisibility.TEMPLATE_SIZE_SEARCH) ||
        preset.is_visible(TemplateVisibility.TEMPLATE_SIZE_LIST)
      ) {
        this._can_resize = true;
      }
    }

    // Keep presets sorted internally for simple use cases (a stable sort).
    this._presets.sort((a, b) => a.get_sort_priority() - b.get_sort_priority());
  }

  /** The URL of the icon with the name. */
  static icon_url(name: string): string {
    return `${Template.icons_url}/${name}.svg`;
  }

  /** Parse the expected value for the visibility value, turn into the mask. */
  static parse_visibility(value: string): number {
    let ret = 0;
    for (const val of value.split(',')) {
      if (val === 'icon') ret |= TemplateVisibility.TEMPLATE_NEW_ICON;
      if (val === 'list') ret |= TemplateVisibility.TEMPLATE_SIZE_LIST;
      if (val === 'search') ret |= TemplateVisibility.TEMPLATE_SIZE_SEARCH;
      if (val === 'all') ret |= TemplateVisibility.TEMPLATE_ALL;
    }
    return ret;
  }

  /**
   * Validate this extension: it needs a category. Then the parent class checks the
   * implementation.
   */
  override check(): boolean {
    if (this._category === '') return false;
    return super.check();
  }

  get_icon(): string {
    return this._icon;
  }
  get_description(): string {
    return this._desc;
  }
  get_category(): string {
    return this._category;
  }
  can_resize(): boolean {
    return this._can_resize;
  }
  get_visibility(): number {
    return this._visibility;
  }
  get_sort_priority(): number {
    return this._sort_priority;
  }

  /**
   * Ask for the parameters of the template if it has any that the preset did not set (upstream
   * prefs). True if the user did not cancel.
   */
  async prefs(): Promise<boolean> {
    if (!this.loaded()) this.set_state(ExtensionState.STATE_LOADED);
    if (!this.loaded()) return false;
    if (this.widget_visible_count() === 0 || !Template.show_prefs) return true;
    return Template.show_prefs(this);
  }

  /** This function acts as the first step in creating a new document. Null if it fails. */
  async new_from_template(): Promise<SPDocument | null> {
    if (!this.loaded()) this.set_state(ExtensionState.STATE_LOADED);
    if (!this.loaded()) return null;

    const doc = await this.imp.new_from_template(this);
    if (!doc) return null;
    DocumentUndo.clearUndo(doc);
    doc.setModifiedSinceSave(false);
    return doc;
  }

  /**
   * Takes an existing page and resizes it to the required dimensions. page is the selected page
   * to resize, or null if not multipage.
   */
  async resize_to_template(doc: SPDocument, page: SPPage | null): Promise<void> {
    if (!this.loaded()) this.set_state(ExtensionState.STATE_LOADED);
    if (!this.loaded()) return;
    await this.imp.resize_to_template(this, doc, page);
  }

  /** Return a list of all template presets. */
  get_presets(visibility: TemplateShow = TemplateVisibility.TEMPLATE_ANY): TemplatePreset[] {
    const all_presets = [...this._presets];
    this.imp.get_template_presets(this, all_presets);
    return all_presets.filter((preset) => preset.is_visible(visibility));
  }

  /** Return the template preset based on the key from this template class. */
  get_preset(key: string): TemplatePreset | null;
  /** Matches the given page size against the presets. */
  get_preset(width: number, height: number): TemplatePreset | null;
  get_preset(a: string | number, b?: number): TemplatePreset | null {
    for (const preset of this.get_presets()) {
      if (typeof a === 'string' ? preset.get_key() === a : preset.match_size(a, b ?? 0)) return preset;
    }
    return null;
  }

  /** Return the template preset based on the key from any template class (upstream get_any_preset). */
  static get_any_preset(key: string): TemplatePreset | null;
  static get_any_preset(width: number, height: number): TemplatePreset | null;
  static get_any_preset(a: string | number, b?: number): TemplatePreset | null {
    for (const tmod of db.get_template_list()) {
      if (typeof a === 'string') {
        const preset = tmod.get_preset(a);
        if (preset) return preset;
      } else {
        if (!tmod.can_resize()) continue;
        const preset = tmod.get_preset(a, b ?? 0);
        if (preset) return preset;
      }
    }
    return null;
  }

  /** The text of the template file of this template: its source, else the default template. */
  get_template_source(): string | null {
    return (
      (this._source ? Template.files.get(this._source) : null) ?? Template.files.get('default.svg') ?? null
    );
  }

  /** The raw document svg for this template (pre-processing). */
  get_template_document(): SPDocument | null {
    const text = this.get_template_source();
    return text ? SPDocument.createNewDocFromMem(text) : null;
  }
}

/** The first node named name in repr and its descendants down to maxdepth levels (-1: all). */
function find_name(repr: Node, name: string, maxdepth: number): Node | null {
  if (repr.name() === name) return repr;
  if (maxdepth === 0) return null;
  for (const child of repr.children()) {
    const found = find_name(child, name, maxdepth - 1);
    if (found) return found;
  }
  return null;
}
