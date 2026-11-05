// SPDX-License-Identifier: LGPL-2.1-or-later
// Upstream: src/util/ziptool.cpp, src/util/ziptool.h
/*
 * This is intended to be a standalone, reduced capability
 * implementation of Gzip and Zip functionality.  Its
 * targeted use case is for archiving and retrieving single files
 * which use the Gzip and Zip formats.
 *
 * Authors:
 *   Bob Jamison
 *
 * Copyright (C) 2006-2007 Bob Jamison
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of the bytes (upstream Crc32). */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Compress with deflate, without a header (what a Zip entry holds). */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One file of a Zip file (upstream ZipEntry). */
export class ZipEntry {
  #data: Uint8Array = new Uint8Array(0);

  constructor(
    readonly fileName: string,
    readonly comment: string,
  ) {}

  /** The file contents. */
  setUncompressedData(data: Uint8Array | string): void {
    this.#data = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  }

  getUncompressedData(): Uint8Array {
    return this.#data;
  }

  /** The Zip file calls it to compress the entry. */
  async finish(): Promise<{ method: number; crc: number; size: number; packed: Uint8Array }> {
    const data = this.#data;
    const crc = crc32(data);
    if (data.length === 0) return { method: 0, crc, size: 0, packed: data };
    const packed = await deflateRaw(data);
    // Store the entry if the compression does not help
    return packed.length < data.length
      ? { method: 8, crc, size: data.length, packed }
      : { method: 0, crc, size: data.length, packed: data };
  }
}

/** A Zip file in memory (upstream ZipFile). */
export class ZipFile {
  readonly entries: ZipEntry[] = [];

  /** Add a file (upstream newEntry); fill it with setUncompressedData(). */
  newEntry(fileName: string, comment = ''): ZipEntry {
    const entry = new ZipEntry(fileName, comment);
    this.entries.push(entry);
    return entry;
  }

  /** The bytes of the Zip file (upstream writeFileBuffer). */
  async writeBuffer(): Promise<Uint8Array> {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const enc = new TextEncoder();

    const chunks: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
    const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

    for (const entry of this.entries) {
      const { method, crc, size, packed } = await entry.finish();
      const name = enc.encode(entry.fileName);
      const comment = enc.encode(entry.comment);
      const common = [
        ...u16(20), // version needed to extract
        ...u16(0x800), // flags: UTF-8 names
        ...u16(method),
        ...u16(dosTime),
        ...u16(dosDate),
        ...u32(crc),
        ...u32(packed.length),
        ...u32(size),
        ...u16(name.length),
        ...u16(0), // extra field length
      ];
      const local = new Uint8Array([...u32(0x04034b50), ...common, ...name]);
      chunks.push(local, packed);
      central.push(
        new Uint8Array([
          ...u32(0x02014b50),
          ...u16(20), // version made by
          ...common,
          ...u16(comment.length),
          ...u16(0), // disk number
          ...u16(0), // internal attributes
          ...u32(0), // external attributes
          ...u32(offset),
          ...name,
          ...comment,
        ]),
      );
      offset += local.length + packed.length;
    }

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array([
      ...u32(0x06054b50),
      ...u16(0),
      ...u16(0),
      ...u16(this.entries.length),
      ...u16(this.entries.length),
      ...u32(centralSize),
      ...u32(offset),
      ...u16(0), // comment length
    ]);

    const all = [...chunks, ...central, end];
    const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
    let pos = 0;
    for (const c of all) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }
}
