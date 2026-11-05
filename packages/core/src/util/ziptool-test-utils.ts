// SPDX-License-Identifier: LGPL-2.1-or-later
// Upstream: src/util/ziptool.cpp
// Helper for the tests of the Zip file: reads a Zip file back.
import { crc32 } from './ziptool.ts';

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`bad Zip file: ${what}`);
}

/** Read the entries of a Zip file through its central directory: name, comment, contents. */
export async function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const dec = new TextDecoder();
  const end = zip.length - 22;
  check(view.getUint32(end, true) === 0x06054b50, 'end of central directory');
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  const out: { name: string; comment: string; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    check(view.getUint32(pos, true) === 0x02014b50, 'central directory entry');
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const packedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const commentLen = view.getUint16(pos + 32, true);
    const local = view.getUint32(pos + 42, true);
    const name = dec.decode(zip.subarray(pos + 46, pos + 46 + nameLen));
    const comment = dec.decode(zip.subarray(pos + 46 + nameLen, pos + 46 + nameLen + commentLen));
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    let data = zip.subarray(dataStart, dataStart + packedSize);
    if (method === 8) {
      const stream = new Blob([data as Uint8Array<ArrayBuffer>])
        .stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    check(data.length === size, 'size');
    check(crc32(data) === crc, 'crc');
    out.push({ name, comment, data });
    pos += 46 + nameLen + commentLen;
  }
  return out;
}
