// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/util/font-collections.cpp, src/util/font-collections.h, src/util/recently-used-fonts.cpp, src/util/recently-used-fonts.h
/*
 * Authors:
 *   Vaibhav Malik <vaibhavmalik2018@gmail.com>
 *
 * Copyright (C) 2024 Authors
 */
import { _, Preferences, Signal } from '@inkscape-web/core';

/** The system collections (their fonts come from the document and the recently used list). */
export const RECENTLY_USED_FONTS = 'Recently Used Fonts';
export const DOCUMENT_FONTS = 'Document Fonts';

/** Translated display name of a collection. */
export function collection_label(name: string): string {
  return name === RECENTLY_USED_FONTS || name === DOCUMENT_FONTS ? _(name) : name;
}

/**
 * Upstream writes each user collection to a text file in the profile directory; here they are a
 * JSON object { name: fonts[] } in this preference.
 */
const COLLECTIONS_PREF = '/options/fontcollections/user';

/**
 * Named sets of font families (upstream FontCollections): the system collections "Document
 * Fonts" and "Recently Used Fonts", and the user collections. The selected collections filter
 * the font lists.
 */
export class FontCollections {
  static #instance: FontCollections | null = null;
  static get(): FontCollections {
    FontCollections.#instance ??= new FontCollections();
    return FontCollections.#instance;
  }

  /** Emitted when collections or their fonts change. */
  readonly update_signal = new Signal<[]>();
  /** Emitted when the selected collections change. */
  readonly selection_update_signal = new Signal<[]>();
  readonly #user = new Map<string, Set<string>>();
  readonly #selected = new Set<string>();

  constructor() {
    this.init();
  }

  /** Read the user collections. */
  init(): void {
    this.#user.clear();
    try {
      const stored = JSON.parse(Preferences.get().getString(COLLECTIONS_PREF, '{}')) as Record<
        string,
        string[]
      >;
      for (const [name, fonts] of Object.entries(stored)) this.#user.set(name, new Set(fonts));
    } catch {
      // ignore a broken preference
    }
  }

  #write(): void {
    const out: Record<string, string[]> = {};
    for (const [name, fonts] of [...this.#user].sort(([a], [b]) => a.localeCompare(b)))
      out[name] = [...fonts].sort();
    Preferences.get().setString(COLLECTIONS_PREF, JSON.stringify(out));
  }

  add_collection(collection_name: string): void {
    const name = collection_name.trim();
    if (!name || this.#user.has(name) || this.#isSystem(name)) return;
    this.#user.set(name, new Set());
    this.#write();
    this.update_signal.emit();
  }

  remove_collection(collection_name: string): void {
    if (!this.#user.delete(collection_name)) return;
    this.#write();
    this.update_signal.emit();
    if (this.#selected.delete(collection_name)) this.selection_update_signal.emit();
  }

  rename_collection(old_name: string, new_name: string): void {
    new_name = new_name.trim();
    if (old_name === new_name || !new_name || this.#user.has(new_name)) return;
    const fonts = this.#user.get(old_name);
    if (!fonts) {
      this.add_collection(new_name);
      return;
    }
    this.#user.delete(old_name);
    this.#user.set(new_name, fonts);
    this.#write();
    if (this.#selected.delete(old_name)) {
      this.#selected.add(new_name);
      this.selection_update_signal.emit();
    }
    this.update_signal.emit();
  }

  add_font(collection_name: string, font_name: string): void {
    const fonts = this.#user.get(collection_name);
    if (!fonts || !font_name || fonts.has(font_name)) return;
    fonts.add(font_name);
    this.#write();
    this.update_signal.emit();
  }

  remove_font(collection_name: string, font_name: string): void {
    const fonts = this.#user.get(collection_name);
    if (!fonts?.delete(font_name)) return;
    this.#write();
    this.update_signal.emit();
  }

  /** Select or unselect a collection (upstream update_selected_collections toggles). */
  update_selected_collections(collection_name: string): void {
    if (!this.#selected.delete(collection_name)) this.#selected.add(collection_name);
    this.selection_update_signal.emit();
  }

  is_collection_selected(collection_name: string): boolean {
    return this.#selected.has(collection_name);
  }

  clear_selected_collections(): void {
    if (!this.#selected.size) return;
    this.#selected.clear();
    this.selection_update_signal.emit();
  }

  get_selected_collections(): ReadonlySet<string> {
    return this.#selected;
  }

  #isSystem(name: string): boolean {
    return name === DOCUMENT_FONTS || name === RECENTLY_USED_FONTS;
  }

  /** The collection names: the system ones, or the user ones sorted. */
  get_collections(is_system = false): string[] {
    return is_system
      ? [DOCUMENT_FONTS, RECENTLY_USED_FONTS]
      : [...this.#user.keys()].sort((a, b) => a.localeCompare(b));
  }

  get_all_collections(): string[] {
    return [...this.get_collections(true), ...this.get_collections(false)];
  }

  find_collection(collection_name: string, is_system = false): boolean {
    return is_system ? this.#isSystem(collection_name) : this.#user.has(collection_name);
  }

  /** The fonts of a user collection (system collections: see FontLister.apply_collections). */
  get_fonts(name: string): ReadonlySet<string> {
    return this.#user.get(name) ?? new Set();
  }

  is_font_in_collection(collection_name: string, font_name: string): boolean {
    return !!this.#user.get(collection_name)?.has(font_name);
  }
}

/** The most recently applied font families, newest first (upstream RecentlyUsedFonts). */
export class RecentlyUsedFonts {
  static #instance: RecentlyUsedFonts | null = null;
  static get(): RecentlyUsedFonts {
    RecentlyUsedFonts.#instance ??= new RecentlyUsedFonts();
    return RecentlyUsedFonts.#instance;
  }

  static readonly #PREF = '/options/fontcollections/recent';
  readonly update_signal = new Signal<[]>();
  #recent_list: string[] = [];

  constructor() {
    try {
      this.#recent_list = JSON.parse(Preferences.get().getString(RecentlyUsedFonts.#PREF, '[]')) as string[];
    } catch {
      this.#recent_list = [];
    }
  }

  #max_size(): number {
    return Preferences.get().getInt('/tools/text/recently_used_fonts_size', 10);
  }

  /** Put a font at the front of the list. */
  prepend_to_list(font_name: string): void {
    if (!font_name) return;
    this.#recent_list = [font_name, ...this.#recent_list.filter((f) => f !== font_name)].slice(
      0,
      this.#max_size(),
    );
    Preferences.get().setString(RecentlyUsedFonts.#PREF, JSON.stringify(this.#recent_list));
    this.update_signal.emit();
  }

  get_fonts(): readonly string[] {
    return this.#recent_list;
  }
}
