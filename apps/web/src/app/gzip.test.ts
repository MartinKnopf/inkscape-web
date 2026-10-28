// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, it } from 'vitest';
import { decodeSvgBytes, gzip, isGzip } from './gzip.ts';
import { documentTitle } from './title.ts';

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>ä</title></svg>';
const plain = new TextEncoder().encode(svg);

it('detects the gzip magic number', async () => {
  expect(isGzip(await gzip(plain))).toBe(true);
  expect(isGzip(plain)).toBe(false);
  expect(isGzip(new Uint8Array([0x1f]))).toBe(false);
});

it('decodes plain and gzipped SVG to the same text', async () => {
  expect(await decodeSvgBytes(plain)).toBe(svg);
  expect(await decodeSvgBytes(await gzip(plain))).toBe(svg);
});

it('marks modified documents in the title', () => {
  expect(documentTitle('a.svg', false)).toBe('a.svg - Inkscape');
  expect(documentTitle('a.svg', true)).toBe('*a.svg - Inkscape');
});
