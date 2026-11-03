// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/db.cpp, src/extension/db.h
/*
 * Functions to keep a listing of all modules in the system.  Has its
 * own file mostly for abstraction reasons, but is pretty simple
 * otherwise.
 *
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *
 * Copyright (C) 2002-2004 Authors
 */
import { Effect } from './effect.ts';
import type { Extension } from './extension.ts';
import { Input } from './input.ts';
import { Output } from './output.ts';

/** The registry of the extensions by id (upstream DB). */
export class DB {
  readonly #moduledict = new Map<string, Extension>();
  readonly #modulelist: Extension[] = [];

  /** Add an extension; one with the same id replaces it (upstream register_ext). */
  register_ext(module: Extension): void {
    const old = this.#moduledict.get(module.get_id());
    if (old) this.#modulelist.splice(this.#modulelist.indexOf(old), 1);
    this.#moduledict.set(module.get_id(), module);
    this.#modulelist.push(module);
  }
  unregister_ext(module: Extension): void {
    if (this.#moduledict.get(module.get_id()) !== module) return;
    this.#moduledict.delete(module.get_id());
    this.#modulelist.splice(this.#modulelist.indexOf(module), 1);
  }
  /** The extension with key as id; null if there is none or it is deactivated. */
  get(key: string): Extension | null {
    const mod = this.#moduledict.get(key);
    return mod && !mod.deactivated() ? mod : null;
  }
  get_effect_list(): Effect[] {
    return this.#modulelist.filter((m): m is Effect => m instanceof Effect && !m.deactivated());
  }
  get_input_list(): Input[] {
    return this.#modulelist.filter((m): m is Input => m instanceof Input && !m.deactivated());
  }
  get_output_list(): Output[] {
    return this.#modulelist.filter((m): m is Output => m instanceof Output && !m.deactivated());
  }
}

export const db = new DB();
