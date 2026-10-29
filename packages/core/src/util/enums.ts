// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/util/enums.h
/*
 * Authors:
 *   Nicholas Bishop <nicholasbishop@gmail.com>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *
 * Copyright (C) 2007 Authors
 */

/**
 * An enumeration value with its UI label and SVG key. The label is untranslated (N_());
 * translate it each time it is shown.
 */
export interface EnumData<E extends number> {
  id: E;
  label: string;
  key: string;
}

/**
 * Simplified management of enumerations of svg items with UI labels.
 *
 * get_id_from_key and get_id_from_label return 0 if they cannot find an entry for that key string;
 * get_label and get_key return an empty string when the requested id is not in the list.
 */
export class EnumDataConverter<E extends number> {
  readonly _length: number;
  readonly #data: readonly EnumData<E>[];

  constructor(cd: readonly EnumData<E>[], length = cd.length) {
    this.#data = cd;
    this._length = length;
  }

  #list(): readonly EnumData<E>[] {
    return this.#data.slice(0, this._length);
  }

  get_id_from_label(label: string): E {
    return this.#list().find((d) => d.label === label)?.id ?? (0 as E);
  }
  get_id_from_key(key: string): E {
    return this.#list().find((d) => d.key === key)?.id ?? (0 as E);
  }
  is_valid_key(key: string): boolean {
    return this.#list().some((d) => d.key === key);
  }
  is_valid_id(id: E): boolean {
    return this.#list().some((d) => d.id === id);
  }
  get_label(id: E): string {
    return this.#list().find((d) => d.id === id)?.label ?? '';
  }
  get_key(id: E): string {
    return this.#list().find((d) => d.id === id)?.key ?? '';
  }
  data(i: number): EnumData<E> {
    return this.#data[i] as EnumData<E>;
  }
}
