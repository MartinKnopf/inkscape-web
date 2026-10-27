// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/preferences.cpp, src/preferences.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2008,2009 Authors
 */
import { Signal } from './util/signal.ts';

/**
 * Preferences by path ("/options/transform/stroke"), as upstream.
 * TODO: defaults from preferences-skeleton.h and persistence (the editor stores them).
 * Until then, callers pass the upstream default, like upstream code does.
 */
export class Preferences {
  static #instance: Preferences | null = null;
  readonly #values = new Map<string, string>();
  /** Emitted with the path when a value changes. */
  readonly changedSignal = new Signal<[string]>();

  static get(): Preferences {
    Preferences.#instance ??= new Preferences();
    return Preferences.#instance;
  }

  getString(path: string, def = ''): string {
    return this.#values.get(path) ?? def;
  }
  getBool(path: string, def = false): boolean {
    const v = this.#values.get(path);
    return v === undefined ? def : v === 'true' || v === '1';
  }
  getInt(path: string, def = 0): number {
    const v = Number.parseInt(this.#values.get(path) ?? '', 10);
    return Number.isNaN(v) ? def : v;
  }
  getDouble(path: string, def = 0): number {
    const v = Number.parseFloat(this.#values.get(path) ?? '');
    return Number.isNaN(v) ? def : v;
  }

  setString(path: string, value: string): void {
    if (this.#values.get(path) === value) return;
    this.#values.set(path, value);
    this.changedSignal.emit(path);
  }
  setBool(path: string, value: boolean): void {
    this.setString(path, value ? 'true' : 'false');
  }
  setInt(path: string, value: number): void {
    this.setString(path, String(Math.trunc(value)));
  }
  setDouble(path: string, value: number): void {
    this.setString(path, String(value));
  }
  remove(path: string): void {
    if (this.#values.delete(path)) this.changedSignal.emit(path);
  }
}
