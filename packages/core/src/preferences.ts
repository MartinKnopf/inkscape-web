// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/preferences.cpp, src/preferences.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2008,2009 Authors
 */
import { preferences_skeleton } from './preferences-skeleton.ts';
import { Signal } from './util/signal.ts';
import {
  type SPCSSAttr,
  spReprCssAttrAddFromString,
  spReprCssAttrNew,
  spReprCssMerge,
  spReprCssWriteString,
} from './xml/repr-css.ts';

/**
 * Where the changed preferences persist (upstream: preferences.xml). The web
 * app attaches localStorage; the entries are path -> value.
 */
export interface PreferencesStorage {
  /** All stored entries. */
  load(): Iterable<readonly [path: string, value: string]>;
  save(path: string, value: string): void;
  remove(path: string): void;
}

/**
 * Preferences by path ("/options/transform/stroke"), as upstream.
 * Values the user has not set come from preferences-skeleton.ts; for paths
 * not in the skeleton, callers pass the upstream default, like upstream code does.
 * The values the user set are kept by a PreferencesStorage, if one is attached.
 */
export class Preferences {
  static #instance: Preferences | null = null;
  readonly #values = new Map<string, string>();
  #storage: PreferencesStorage | null = null;
  /** Emitted with the path when a value changes. */
  readonly changedSignal = new Signal<[string]>();

  static get(): Preferences {
    Preferences.#instance ??= new Preferences();
    return Preferences.#instance;
  }

  /**
   * Load the stored values and store later changes (upstream Preferences::load).
   * Call before anything reads preferences.
   */
  attachStorage(storage: PreferencesStorage): void {
    this.#storage = storage;
    for (const [path, value] of storage.load()) {
      if (this.#values.get(path) === value) continue;
      this.#values.set(path, value);
      this.changedSignal.emit(path);
    }
  }

  /** The value set by the user, else the skeleton value. */
  #raw(path: string): string | undefined {
    return this.#values.get(path) ?? preferences_skeleton[path];
  }

  getString(path: string, def = ''): string {
    return this.#raw(path) ?? def;
  }
  getBool(path: string, def = false): boolean {
    const v = this.#raw(path);
    return v === undefined ? def : v === 'true' || v === '1';
  }
  getInt(path: string, def = 0): number {
    const v = Number.parseInt(this.#raw(path) ?? '', 10);
    return Number.isNaN(v) ? def : v;
  }
  getDouble(path: string, def = 0): number {
    const v = Number.parseFloat(this.#raw(path) ?? '');
    return Number.isNaN(v) ? def : v;
  }

  /** The CSS properties of the style string at path (empty if not set). */
  getStyle(path: string): SPCSSAttr {
    const style = spReprCssAttrNew();
    spReprCssAttrAddFromString(style, this.#raw(path) ?? null);
    return style;
  }

  /**
   * The style at path merged over the styles of the same name in the parent
   * groups: "/tools/shapes/rect/style" over "/tools/shapes/style" over "/tools/style".
   * Empty if path itself is not set.
   */
  getInheritedStyle(path: string): SPCSSAttr {
    const style = spReprCssAttrNew();
    if (this.#raw(path) === undefined) return style;
    const slash = path.lastIndexOf('/');
    const node = path.slice(0, slash).split('/');
    const attr = path.slice(slash + 1);
    for (let i = 1; i <= node.length; i++) {
      spReprCssAttrAddFromString(style, this.#raw(`${node.slice(0, i).join('/')}/${attr}`) ?? null);
    }
    return style;
  }

  /** Merge the properties of css into the style string at path. */
  mergeStyle(path: string, css: SPCSSAttr): void {
    const style = this.getStyle(path);
    spReprCssMerge(style, css);
    this.setString(path, spReprCssWriteString(style));
  }

  setString(path: string, value: string): void {
    if (this.#values.get(path) === value) return;
    this.#values.set(path, value);
    this.#storage?.save(path, value);
    this.changedSignal.emit(path);
  }
  setBool(path: string, value: boolean): void {
    this.setString(path, value ? '1' : '0');
  }
  setInt(path: string, value: number): void {
    this.setString(path, String(Math.trunc(value)));
  }
  setDouble(path: string, value: number): void {
    this.setString(path, String(value));
  }
  remove(path: string): void {
    if (!this.#values.delete(path)) return;
    this.#storage?.remove(path);
    this.changedSignal.emit(path);
  }
  /** Whether path has a value (upstream getEntry(path).isSet()). */
  isSet(path: string): boolean {
    return this.#raw(path) !== undefined;
  }
}
