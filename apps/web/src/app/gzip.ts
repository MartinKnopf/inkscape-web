// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/io/gzipstream.cpp, src/io/gzipstream.h
// Gzip for .svgz files, with the streams of the browser.

/** True if bytes start with the gzip magic number (1f 8b). */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return pipe(bytes, new DecompressionStream('gzip'));
}

export function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return pipe(bytes, new CompressionStream('gzip'));
}

/** Decode the bytes of an SVG or SVGZ file to text. */
export async function decodeSvgBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return new TextDecoder().decode(isGzip(bytes) ? await gunzip(bytes) : bytes);
}
