// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/io/recent-files.cpp, src/io/recent-files.h
// The "Open Recent" list: File System Access handles kept in IndexedDB.
import { Preferences, Signal } from '@inkscape-web/core';
import { useSyncExternalStore } from 'react';
import { indexedDbStore, type KeyValueStore } from './kv-store.ts';

/** The part of FileSystemFileHandle that the list uses. */
export interface RecentHandle {
  readonly name: string;
  isSameEntry?(other: RecentHandle): Promise<boolean>;
}

/** A remembered file. */
export interface RecentEntry {
  /** Key in the store. */
  id: string;
  name: string;
  handle: RecentHandle;
  /** When the file was last opened or saved (ms since epoch). */
  time: number;
}

type StoredEntry = Omit<RecentEntry, 'id'>;

/**
 * The most recently used files, newest first, at most
 * /options/maxrecentdocuments/value (upstream default 36).
 */
export class RecentFiles {
  readonly #store: KeyValueStore<StoredEntry>;
  readonly #now: () => number;
  #entries: readonly RecentEntry[] = [];
  #counter = 0;
  /** Emitted when the list changes. */
  readonly changedSignal = new Signal<[]>();

  constructor(store: KeyValueStore<StoredEntry>, now: () => number = Date.now) {
    this.#store = store;
    this.#now = now;
  }

  /** The list as of the last change (newest first). */
  get entries(): readonly RecentEntry[] {
    return this.#entries;
  }

  /** Read the list from the store. */
  async load(): Promise<void> {
    this.#entries = (await this.#store.entries())
      .map(([id, e]) => ({ id, ...e }))
      .sort((a, b) => b.time - a.time);
    this.changedSignal.emit();
  }

  /** Put handle at the top of the list (a file that is opened or saved). */
  async add(handle: RecentHandle): Promise<void> {
    const max = Preferences.get().getInt('/options/maxrecentdocuments/value', 36);
    // The same file is listed once.
    const same: string[] = [];
    for (const e of this.#entries) {
      if (e.name === handle.name && (await isSame(e.handle, handle))) same.push(e.id);
    }
    const id = `${this.#now()}-${this.#counter++}`;
    const entry: RecentEntry = { id, name: handle.name, handle, time: this.#now() };
    const kept = [entry, ...this.#entries.filter((e) => !same.includes(e.id))];
    const dropped = [...same, ...kept.slice(Math.max(max, 0)).map((e) => e.id)];
    this.#entries = kept.slice(0, Math.max(max, 0));
    this.changedSignal.emit();
    if (max > 0) await this.#store.put(id, { name: entry.name, handle, time: entry.time });
    await Promise.all(dropped.map((d) => this.#store.delete(d)));
  }

  async remove(id: string): Promise<void> {
    this.#entries = this.#entries.filter((e) => e.id !== id);
    this.changedSignal.emit();
    await this.#store.delete(id);
  }

  /** The "Clear list" button of the Interface preferences. */
  async clear(): Promise<void> {
    const ids = this.#entries.map((e) => e.id);
    this.#entries = [];
    this.changedSignal.emit();
    await Promise.all(ids.map((id) => this.#store.delete(id)));
  }
}

async function isSame(a: RecentHandle, b: RecentHandle): Promise<boolean> {
  try {
    return (await a.isSameEntry?.(b)) ?? false;
  } catch {
    return false;
  }
}

let instance: RecentFiles | null = null;

/** The list of the app, in IndexedDB. */
export function getRecentFiles(): RecentFiles {
  instance ??= new RecentFiles(indexedDbStore('recent'));
  return instance;
}

/** The recent files, for menus. */
export function useRecentFiles(): readonly RecentEntry[] {
  const list = getRecentFiles();
  return useSyncExternalStore(
    (cb) => list.changedSignal.connect(cb),
    () => list.entries,
  );
}
