// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/messages.cpp, src/ui/widget/memory.cpp
import { afterEach, describe, expect, it, vi } from 'vitest';
import { format_size, memory_rows } from '../widget/memory.ts';
import { Messages } from '../widget/messages.ts';

describe('Messages', () => {
  const messages = new Messages();
  afterEach(() => {
    messages.releaseLogMessages();
    messages.clear();
  });

  it('keeps messages, one line each, and clears', () => {
    messages.message('a\n');
    messages.message('b');
    expect(messages.lines).toEqual(['Ready.', 'a', 'b']);
    messages.clear();
    expect(messages.lines).toEqual([]);
  });

  it('captures the console while the capture is on, and the console still gets the messages', () => {
    const original = vi.spyOn(console, 'warn').mockImplementation(() => {});
    console.warn('before');
    messages.captureLogMessages();
    console.warn('lost', { x: 1 });
    messages.releaseLogMessages();
    console.warn('after');
    expect(messages.lines).toEqual(['Log capture started.', 'lost {"x":1}', 'Log capture stopped.']);
    expect(original.mock.calls.map((c) => c[0])).toEqual(['before', 'lost', 'after']);
    original.mockRestore();
  });
});

describe('Memory', () => {
  it('formats sizes', () => {
    expect([format_size(512), format_size(1536), format_size(5 * 1024 * 1024)]).toEqual([
      '512 B',
      '1.50 KiB',
      '5.00 MiB',
    ]);
  });

  it('adds a combined row, with unknown sizes marked', () => {
    const rows = memory_rows([
      { name: 'A', used: 1024, size: 4096 },
      { name: 'B', used: 1024, size: null },
    ]);
    expect(rows[0]).toEqual({ name: 'A', used: '1.00 KiB', slack: '3.00 KiB', total: '4.00 KiB' });
    expect(rows[1]).toEqual({ name: 'B', used: '1.00 KiB', slack: 'Unknown', total: 'Unknown' });
    expect(rows[2]).toEqual({ name: 'Combined', used: '2.00 KiB', slack: 'Unknown', total: '> 4.00 KiB' });
  });
});
