// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { loadRevenge } from './revenge.ts';

describe('loadRevenge', () => {
  it('loads again after a failed load', async () => {
    const missing = { locateFile: () => '/nonexistent/revenge-module.wasm' };
    await expect(loadRevenge(missing)).rejects.toBeDefined();
    const m = await loadRevenge();
    expect(m.wpgParse(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
