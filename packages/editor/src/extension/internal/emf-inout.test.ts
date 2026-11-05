// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FontFactory,
  PangoStretch,
  SPDocument,
  SPShape,
  sp_repr_visit_descendants,
} from '@inkscape-web/core';
import { BUNDLED_FONTS, loadText } from '@inkscape-web/wasm';
import { loadUemf } from '@inkscape-web/wasm/uemf';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../db.ts';
import type { Input } from '../input.ts';
import type { Output } from '../output.ts';
import { Emf } from './emf-inout.ts';
import { PrintEmf } from './emf-print.ts';
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

describe('EMF input fonts', () => {
  it('measures the text with the font files of the editor', async () => {
    // "Monaco" is not a bundled font: the editor has it (here: the DejaVu Sans Mono file).
    const factory = FontFactory.get();
    factory.setBackend(await loadText());
    const mono = BUNDLED_FONTS.find((f) => f.family === 'DejaVu Sans Mono' && f.weight === 400)!;
    const bytes = new Uint8Array(readFileSync(fileURLToPath(mono.url)));
    factory.addFontSource({
      family: 'Monaco',
      style: 0,
      weight: 400,
      stretch: PangoStretch.PANGO_STRETCH_NORMAL,
      display_name: 'Regular',
      load: async () => bytes,
    });

    // text right-aligned at x = 200 px: the import places its start by the width of the text
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">
      <text x="200" y="50" style="font-size:20px;font-family:Monaco">Hello</text>
    </svg>`;
    const out = output();
    out.set_param_bool('textToPath', false);
    let data: Uint8Array;
    try {
      data = (await out.save(SPDocument.createNewDocFromMem(svg)!, 'right.emf'))!;
    } finally {
      out.set_param_bool('textToPath', true);
    }
    // U_EMR_SETTEXTALIGN (22) with U_TA_BASELINE | U_TA_RIGHT instead of U_TA_LEFT
    const view = new DataView(data.buffer, data.byteOffset);
    for (const [type, rec] of emf_records(data)) {
      if (type === 22) view.setUint32(rec.byteOffset - data.byteOffset + 8, 0x18 | 0x02, true);
    }

    const doc = (await input().open('right.emf', data))!;
    let x = Number.NaN;
    sp_repr_visit_descendants(doc.getReprRoot(), (n) => {
      if (n.name() === 'svg:text' && Number.isNaN(x)) {
        // matrix(a,b,c,d,e,f) with the reference point, x relative to it
        const e = Number.parseFloat(n.attribute('transform')!.split(',')[4]!);
        x = e + Number.parseFloat(n.attribute('x')!);
      }
      return true;
    });
    // 5 characters of 0.602 em (DejaVu Sans Mono) at 20 px left of the right edge;
    // DejaVu Sans (the fallback) is narrower and gives about 149 px.
    expect(x).toBeCloseTo(200 - 5 * 0.602 * 20, 0);
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

  it('frees the file and the handle table when the print fails', async () => {
    const imp = db.get('org.inkscape.print.emf')!.get_imp() as PrintEmf;
    const doc = SPDocument.createNewDocFromMem(SHAPES_SVG)!;
    const fill = vi.spyOn(PrintEmf.prototype, 'fill').mockImplementationOnce(() => {
      throw new Error('print failed');
    });
    try {
      await expect(output().save(doc, 'fail.emf')).rejects.toThrow('print failed');
    } finally {
      fill.mockRestore();
    }
    expect([imp.et, imp.eht]).toEqual([0, 0]);
    // the next print starts clean
    const data = (await output().save(doc, 'shapes.emf'))!;
    expect(data.length).toBeGreaterThan(0);
  });
});
