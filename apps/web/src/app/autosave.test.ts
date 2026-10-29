// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/auto-save.cpp
import { Preferences } from '@inkscape-web/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoSave, type AutoSaveDocument, type AutoSaveRecord } from './autosave.ts';
import { memoryStore } from './kv-store.ts';

function setup(docs: AutoSaveDocument[]) {
  const store = memoryStore<AutoSaveRecord>();
  const prefs = new Preferences();
  const autosave = new AutoSave({
    store,
    prefs,
    getDocuments: () => docs,
    serialize: (d) => `<svg><!-- ${d.documentName} --></svg>`,
  });
  return { store, prefs, autosave };
}

const doc = (name: string, modified = true): AutoSaveDocument => ({
  documentName: name,
  documentFilename: null,
  modifiedSinceAutoSave: modified,
});

describe('AutoSave', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('saves only modified documents, once per change, every interval minutes', async () => {
    const a = doc('a');
    const b = doc('b', false);
    const { store, prefs, autosave } = setup([a, b]);
    prefs.setInt('/options/autosave/interval', 2);
    autosave.start();

    await vi.advanceTimersByTimeAsync(119_000);
    expect(await store.entries()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    const saved = (await store.entries()).map(([, r]) => r);
    expect(saved.map((r) => r.name)).toEqual(['a']);
    expect(saved[0]?.svg).toContain('a');
    expect(a.modifiedSinceAutoSave).toBe(false);

    // Nothing changed: the next tick writes nothing.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await store.entries()).toHaveLength(1);
    a.modifiedSinceAutoSave = true;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await store.entries()).toHaveLength(2);
    autosave.stop();
  });

  it('does not run when disabled and restarts with the new interval', async () => {
    const { prefs, autosave } = setup([doc('a')]);
    prefs.setBool('/options/autosave/enable', false);
    autosave.start();
    expect(autosave.running).toBe(false);
    prefs.setBool('/options/autosave/enable', true);
    autosave.start();
    expect(autosave.running).toBe(true);
    autosave.stop();
    expect(autosave.running).toBe(false);
  });

  it('keeps at most /options/autosave/max records, dropping the oldest', async () => {
    const a = doc('a');
    const { store, prefs, autosave } = setup([a]);
    prefs.setInt('/options/autosave/max', 2);
    for (let i = 0; i < 4; i++) {
      a.modifiedSinceAutoSave = true;
      a.documentName = `v${i}`;
      vi.setSystemTime(2_000_000 + i * 1000);
      await autosave.save();
    }
    expect((await store.entries()).map(([, r]) => r.name)).toEqual(['v2', 'v3']);
  });

  it('offers the newest record per document and discards the records of a closed document', async () => {
    const a = doc('a');
    const b = doc('b');
    const { store, autosave } = setup([a, b]);
    await autosave.save();
    a.modifiedSinceAutoSave = true;
    a.documentName = 'a2';
    vi.setSystemTime(1_005_000);
    await autosave.save();
    expect((await autosave.pending()).map((r) => r.name)).toEqual(['b', 'a2']);

    await autosave.discard(a);
    expect((await autosave.pending()).map((r) => r.name)).toEqual(['b']);
    await autosave.discardRecords(await autosave.pending());
    expect(await store.entries()).toHaveLength(0);
  });
});
