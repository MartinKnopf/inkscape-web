// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/io/recent-files.cpp
import { Preferences } from '@inkscape-web/core';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryStore } from './kv-store.ts';
import { RecentFiles, type RecentHandle } from './recent-files.ts';

/** A handle that is the same file as every handle with the same name. */
const handle = (name: string): RecentHandle => ({
  name,
  isSameEntry: async (other) => other.name === name,
});

function setup() {
  const store = memoryStore<{ name: string; handle: RecentHandle; time: number }>();
  let t = 0;
  return { store, recent: new RecentFiles(store, () => ++t) };
}

describe('RecentFiles', () => {
  afterEach(() => Preferences.get().remove('/options/maxrecentdocuments/value'));

  it('lists the newest first and moves a reopened file to the top', async () => {
    const { recent } = setup();
    await recent.add(handle('a.svg'));
    await recent.add(handle('b.svg'));
    await recent.add(handle('a.svg'));
    expect(recent.entries.map((e) => e.name)).toEqual(['a.svg', 'b.svg']);
  });

  it('keeps at most /options/maxrecentdocuments/value entries, in the store too', async () => {
    Preferences.get().setInt('/options/maxrecentdocuments/value', 2);
    const { recent, store } = setup();
    for (const n of ['a', 'b', 'c']) await recent.add(handle(`${n}.svg`));
    expect(recent.entries.map((e) => e.name)).toEqual(['c.svg', 'b.svg']);
    expect((await store.entries()).map(([, e]) => e.name).sort()).toEqual(['b.svg', 'c.svg']);
  });

  it('loads the list from the store and clears it', async () => {
    const { recent, store } = setup();
    await recent.add(handle('a.svg'));
    await recent.add(handle('b.svg'));

    const reloaded = new RecentFiles(store);
    await reloaded.load();
    expect(reloaded.entries.map((e) => e.name)).toEqual(['b.svg', 'a.svg']);

    let changes = 0;
    reloaded.changedSignal.connect(() => changes++);
    await reloaded.clear();
    expect(reloaded.entries).toEqual([]);
    expect(await store.entries()).toEqual([]);
    expect(changes).toBe(1);
  });

  it('removes a single entry', async () => {
    const { recent, store } = setup();
    await recent.add(handle('a.svg'));
    await recent.add(handle('b.svg'));
    await recent.remove(recent.entries[0]?.id ?? '');
    expect(recent.entries.map((e) => e.name)).toEqual(['a.svg']);
    expect(await store.entries()).toHaveLength(1);
  });
});
