// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SPDocument, SPShape, sp_repr_visit_descendants } from '@inkscape-web/core';
import { loadUemf } from '@inkscape-web/wasm/uemf';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db.ts';
import type { Input } from '../input.ts';
import type { Output } from '../output.ts';
import { Emf } from './emf-inout.ts';
import { SHAPES_SVG } from './fixtures/shapes.ts';
import { setUemfBackendLoader } from './uemf-backend.ts';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));

/** The records of an EMF file: [type, data]. */
function emf_records(bytes: Uint8Array): [number, Uint8Array][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: [number, Uint8Array][] = [];
  for (let off = 0; off + 8 <= bytes.length; ) {
    const type = view.getUint32(off, true);
    const size = view.getUint32(off + 4, true);
    out.push([type, bytes.subarray(off, off + size)]);
    if (!size) break;
    off += size;
  }
  return out;
}

const U_EMR_HEADER = 1;
const U_EMR_EOF = 14;
const U_EMR_EXTTEXTOUTW = 84;

beforeAll(() => {
  setUemfBackendLoader(() =>
    loadUemf({ readFont: async (url) => new Uint8Array(readFileSync(fileURLToPath(url))) }),
  );
  Emf.init();
});

const input = () => db.get('org.inkscape.input.emf') as Input;
const output = () => db.get('org.inkscape.output.emf') as Output;

/** The fills of the shapes of a document. */
function fills(doc: SPDocument): string[] {
  const out: string[] = [];
  const walk = (o: { children: readonly unknown[] }) => {
    for (const c of o.children) {
      if (c instanceof SPShape) out.push(c.style.fill.getColor().toString(false));
      walk(c as { children: readonly unknown[] });
    }
  };
  walk(doc.getRoot());
  return out;
}

describe('EMF input', () => {
  it('imports the shapes of an EMF file that upstream Inkscape wrote', async () => {
    const doc = await input().open('shapes.emf', fixture('shapes_expected.emf'));
    expect(doc).not.toBeNull();
    expect(fills(doc!)).toEqual(['#0000ff', '#ff0000', '#ffff00']);
    // 106 x 80 mm: the size of the 400 x 300 px drawing at 1200 dpi
    expect(doc!.getRoot().getAttribute('width')).toBe('106mm');
  });

  it('returns null for data that is not an EMF file', async () => {
    expect(await input().open('bad.emf', new TextEncoder().encode('not a metafile'))).toBeNull();
  });
});

describe('EMF output', () => {
  it('writes the same records as upstream for shapes.svg', async () => {
    const doc = SPDocument.createNewDocFromMem(SHAPES_SVG)!;
    const data = (await output().save(doc, 'shapes.emf'))!;
    const ours = emf_records(data);
    const theirs = emf_records(fixture('shapes_expected.emf'));
    expect(ours.map((r) => r[0])).toEqual(theirs.map((r) => r[0]));
    expect(ours[0]![0]).toBe(U_EMR_HEADER);
    expect(ours.at(-1)![0]).toBe(U_EMR_EOF);
    // Every record but the header (it has the version and file name) and the file size at the
    // end of the EOF record is the same.
    for (let i = 1; i < ours.length - 1; i++) expect(ours[i]![1]).toEqual(theirs[i]![1]);
    const eof = ours.at(-1)![1];
    expect(eof.subarray(0, 16)).toEqual(theirs.at(-1)![1].subarray(0, 16));
    expect(new DataView(eof.buffer, eof.byteOffset).getUint32(16, true)).toBe(data.length);
  });

  it('round-trips text as EMF text records', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <rect x="10" y="10" width="80" height="40" style="fill:#008000"/>
      <text x="20" y="80" style="font-size:20px;font-family:Arial;fill:#ff0000">Hello</text>
    </svg>`;
    const doc = SPDocument.createNewDocFromMem(svg)!;
    const out = output();
    out.set_param_bool('textToPath', false);
    let data: Uint8Array | null;
    try {
      data = await out.save(doc, 'text.emf');
    } finally {
      out.set_param_bool('textToPath', true);
    }
    expect(emf_records(data!).some((r) => r[0] === U_EMR_EXTTEXTOUTW)).toBe(true);

    const back = await input().open('text.emf', data!);
    const parts: string[] = [];
    sp_repr_visit_descendants(back!.getReprRoot(), (n) => {
      parts.push(n.content() ?? '', n.attribute('style') ?? '');
      return true;
    });
    const text = parts.join(' ');
    expect(text).toContain('Hello');
    expect(text).toContain('font-family:Arial');
    expect(fills(back!)).toContain('#008000');
  });
});
