// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/auto-save.cpp, src/auto-save.h
/*
 * Auto-save
 *
 * Copyright (C) 2020 Tavmjong Bah
 *
 * Re-write of code formerly in inkscape.cpp and originally written by Jon Cruz and others.
 */
import { Preferences } from '@inkscape-web/core';
import type { KeyValueStore } from './kv-store.ts';

/** The part of SPDocument that the autosave uses. */
export interface AutoSaveDocument {
  documentName: string | null;
  documentFilename: string | null;
  modifiedSinceAutoSave: boolean;
}

/** An autosaved document in the store. */
export interface AutoSaveRecord {
  /** The document in the session that made the record. */
  docId: string;
  name: string;
  /** File name of the document when it was autosaved. */
  filename: string | null;
  /** The SVG source. */
  svg: string;
  /** ms since epoch */
  time: number;
}

export interface AutoSaveOptions {
  store: KeyValueStore<AutoSaveRecord>;
  /** The open documents. */
  getDocuments: () => readonly AutoSaveDocument[];
  /** The SVG source of a document. */
  serialize: (doc: AutoSaveDocument) => string;
  prefs?: Preferences;
  now?: () => number;
  /** Called when a record cannot be stored (upstream: "Autosave failed! ..."). */
  onError?: (doc: AutoSaveDocument, error: unknown) => void;
}

const KEY_PREFIX = 'autosave-';

/**
 * Periodically store the documents that changed since the last autosave
 * (upstream AutoSave): every /options/autosave/interval minutes if
 * /options/autosave/enable, at most /options/autosave/max records.
 * Records are keyed "autosave-<time>-<document id>", so the oldest sort first.
 */
export class AutoSave {
  readonly #o: Required<Omit<AutoSaveOptions, 'onError'>> & Pick<AutoSaveOptions, 'onError'>;
  readonly #ids = new WeakMap<AutoSaveDocument, string>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #counter = 0;
  /** A save in progress; the next one waits for it. */
  #running: Promise<void> = Promise.resolve();

  constructor(options: AutoSaveOptions) {
    this.#o = { prefs: Preferences.get(), now: Date.now, ...options };
  }

  /** (Re)start the timer from the preferences, or stop it when disabled (upstream AutoSave::start). */
  start(): void {
    this.stop();
    const prefs = this.#o.prefs;
    if (!prefs.getBool('/options/autosave/enable', true)) return;
    const minutes = Math.max(prefs.getInt('/options/autosave/interval', 10), 1);
    if (minutes * 60 > 60 * 60 * 24) {
      // Sanity check
      console.error('AutoSave::start: auto-save interval set to greater than one day. Not enabling.');
      return;
    }
    this.#timer = setInterval(() => void this.save(), minutes * 60_000);
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  get running(): boolean {
    return this.#timer !== null;
  }

  /** The id that records of doc have (assigned on first use). */
  #docId(doc: AutoSaveDocument): string {
    let id = this.#ids.get(doc);
    if (!id) {
      id = `${this.#o.now()}-${this.#counter++}`;
      this.#ids.set(doc, id);
    }
    return id;
  }

  /** Store every document that is modified since its last autosave (upstream AutoSave::save). */
  save(): Promise<void> {
    this.#running = this.#running.then(() => this.#save());
    return this.#running;
  }

  async #save(): Promise<void> {
    const { store, prefs } = this.#o;
    const max = Math.max(prefs.getInt('/options/autosave/max', 10), 1);
    for (const doc of this.#o.getDocuments()) {
      if (!doc.modifiedSinceAutoSave) continue;
      const time = this.#o.now();
      const record: AutoSaveRecord = {
        docId: this.#docId(doc),
        name: doc.documentName ?? 'unnamed',
        filename: doc.documentFilename,
        svg: this.#o.serialize(doc),
        time,
      };
      try {
        // Remove the oldest records to make room for this one.
        const keys = (await store.entries()).map(([k]) => k);
        for (const key of keys.slice(0, Math.max(keys.length - max + 1, 0))) await store.delete(key);
        await store.put(`${KEY_PREFIX}${String(time).padStart(15, '0')}-${record.docId}`, record);
        doc.modifiedSinceAutoSave = false;
      } catch (e) {
        this.#o.onError?.(doc, e);
      }
    }
  }

  /** Remove the records of doc (it was saved or closed, so there is nothing to recover). */
  async discard(doc: AutoSaveDocument): Promise<void> {
    const id = this.#ids.get(doc);
    if (!id) return;
    await this.#running;
    for (const [key, record] of await this.#o.store.entries()) {
      if (record.docId === id) await this.#o.store.delete(key);
    }
  }

  /** The newest record of each document that was autosaved in an earlier session, oldest first. */
  async pending(): Promise<AutoSaveRecord[]> {
    const latest = new Map<string, AutoSaveRecord>();
    for (const [, record] of await this.#o.store.entries()) latest.set(record.docId, record);
    return [...latest.values()].sort((a, b) => a.time - b.time);
  }

  /** Remove all records of the documents of records (restored or dismissed). */
  async discardRecords(records: readonly AutoSaveRecord[]): Promise<void> {
    const ids = new Set(records.map((r) => r.docId));
    for (const [key, record] of await this.#o.store.entries()) {
      if (ids.has(record.docId)) await this.#o.store.delete(key);
    }
  }
}
