// SPDX-License-Identifier: LGPL-2.1-or-later
// Upstream: src/util/ziptool.cpp
import { describe, expect, it } from 'vitest';
import { crc32, ZipFile } from './ziptool.ts';
import { readZip } from './ziptool-test-utils.ts';

describe('ZipFile', () => {
  it('has the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes entries that read back with their names, comments and contents', async () => {
    const zf = new ZipFile();
    const text = 'content '.repeat(100);
    zf.newEntry('content.xml', 'master').setUncompressedData(text);
    zf.newEntry('Pictures/a.png', '').setUncompressedData(new Uint8Array([1, 2, 3]));
    zf.newEntry('empty', '');
    const entries = await readZip(await zf.writeBuffer());
    expect(entries.map((e) => [e.name, e.comment])).toEqual([
      ['content.xml', 'master'],
      ['Pictures/a.png', ''],
      ['empty', ''],
    ]);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe(text);
    expect([...entries[1]!.data]).toEqual([1, 2, 3]);
    expect(entries[2]!.data.length).toBe(0);
  });
});
