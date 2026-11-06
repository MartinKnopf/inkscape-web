// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SPDocument, SPShape, sp_repr_visit_descendants } from '@inkscape-web/core';
import { loadUemf } from '@inkscape-web/wasm/uemf';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../db.ts';
import type { Input } from '../input.ts';
import type { Output } from '../output.ts';
import { SHAPES_SVG } from './fixtures/shapes.ts';
import { setUemfBackendLoader } from './uemf-backend.ts';
import { Wmf } from './wmf-inout.ts';
import { PrintWmf } from './wmf-print.ts';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));

/** Size of the placeable (Aldus) header and of the WMF header, in bytes. */
const U_SIZE_WMRPLACEABLE = 22;
const U_SIZE_WMRHEADER = 18;
const U_WMR_EOF = 0x0000;
const U_WMR_EXTTEXTOUT = 0x0a32;
const U_WMR_CREATEFONTINDIRECT = 0x02fb;
const U_WMR_CREATEPENINDIRECT = 0x02fa;
const U_WMR_CREATEBRUSHINDIRECT = 0x02fc;

/** A WMF file: its two headers and its records ([function, data]). */
function wmf_parts(bytes: Uint8Array): { headers: Uint8Array; records: [number, Uint8Array][] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = U_SIZE_WMRPLACEABLE + U_SIZE_WMRHEADER;
  const records: [number, Uint8Array][] = [];
  for (let off = start; off + 6 <= bytes.length; ) {
    const size = view.getUint32(off, true) * 2; // in 16 bit words
    records.push([view.getUint16(off + 4, true), bytes.subarray(off, off + size)]);
    if (!size) break;
    off += size;
  }
  return { headers: bytes.subarray(0, start), records };
}

beforeAll(() => {
  setUemfBackendLoader(() =>
    loadUemf({ readFont: async (url) => new Uint8Array(readFileSync(fileURLToPath(url))) }),
  );
  Wmf.init();
});

const input = () => db.get('org.inkscape.input.wmf') as Input;
const output = () => db.get('org.inkscape.output.wmf') as Output;

/** The fill colors of the shapes of a document. */
function fills(doc: SPDocument): string[] {
  const out: string[] = [];
  const walk = (o: { children: readonly unknown[] }) => {
    for (const c of o.children) {
      if (c instanceof SPShape && c.style.fill.isColor()) out.push(c.style.fill.getColor().toString(false));
      walk(c as { children: readonly unknown[] });
    }
  };
  walk(doc.getRoot());
  return out;
}

describe('WMF input', () => {
  it('imports the shapes of a WMF file that upstream Inkscape wrote', async () => {
    const doc = await input().open('shapes.wmf', fixture('shapes_expected.wmf'));
    expect(doc).not.toBeNull();
    // the ellipse is two polygons in this file: the fill, then the stroke (no fill)
    expect(fills(doc!)).toEqual(['#0000ff', '#ff0000', '#ffff00']);
  });
});

describe('WMF output', () => {
  // shapes_expected.wmf is from 2020 (upstream compares it by rendering, with a fuzz). The
  // upstream of today writes two things differently, and so does this port:
  // - toColorRef puts the alpha (255) in the reserved byte of the brush and pen colors (2020: 0);
  // - the ellipse is a closed path, so its fill waits for the stroke and one POLYGON draws
  //   both (2020: one POLYGON with the brush, then one with the pen).
  it('writes the same headers and records as upstream for shapes.svg', async () => {
    const doc = SPDocument.createNewDocFromMem(SHAPES_SVG)!;
    const data = (await output().save(doc, 'shapes.wmf'))!;
    const ours = wmf_parts(data);
    const theirs = wmf_parts(fixture('shapes_expected.wmf'));
    // the same placeable header (bounds, 1200 dpi, checksum); the WMF header has the file size
    expect(ours.headers.subarray(0, U_SIZE_WMRPLACEABLE)).toEqual(
      theirs.headers.subarray(0, U_SIZE_WMRPLACEABLE),
    );
    expect(new DataView(data.buffer, data.byteOffset).getUint32(U_SIZE_WMRPLACEABLE + 6, true) * 2).toBe(
      data.length,
    );

    const reserved = (r: [number, Uint8Array]) => {
      const b = r[1].slice();
      if (r[0] === U_WMR_CREATEBRUSHINDIRECT) b[11] = 0;
      if (r[0] === U_WMR_CREATEPENINDIRECT) b[15] = 0;
      return b;
    };
    const o = ours.records.map(reserved);
    const t = theirs.records.map(reserved);
    // the setup, the rectangle; the ellipse (brush, pen, POLYGON, then delete both); the star and the end
    const ELLIPSE = 24;
    expect(o.slice(0, ELLIPSE)).toEqual(t.slice(0, ELLIPSE));
    expect(o[ELLIPSE]).toEqual(t[ELLIPSE]); // the brush
    expect(o[ELLIPSE + 2]).toEqual(t[ELLIPSE + 5]); // the pen
    expect(o[ELLIPSE + 4]).toEqual(t[ELLIPSE + 2]); // the points of the POLYGON
    expect(o[ELLIPSE + 4]).toEqual(t[ELLIPSE + 7]);
    expect(o.slice(ELLIPSE + 9)).toEqual(t.slice(ELLIPSE + 10));
    expect(ours.records.at(-1)![0]).toBe(U_WMR_EOF);
  });

  it('round-trips text as WMF text records', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <rect x="10" y="10" width="80" height="40" style="fill:#008000"/>
      <text x="20" y="80" style="font-size:20px;font-family:Arial;fill:#ff0000">Hello</text>
    </svg>`;
    const doc = SPDocument.createNewDocFromMem(svg)!;
    const out = output();
    out.set_param_bool('textToPath', false);
    let data: Uint8Array | null;
    try {
      data = await out.save(doc, 'text.wmf');
    } finally {
      out.set_param_bool('textToPath', true);
    }
    expect(wmf_parts(data!).records.some((r) => r[0] === U_WMR_EXTTEXTOUT)).toBe(true);

    const back = await input().open('text.wmf', data!);
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

  /** Save the text as WMF text records, without the mapping to the Symbol, Wingdings and Zapf Dingbats fonts. */
  async function save_text(text: string, family: string): Promise<Uint8Array> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <text x="20" y="80" style="font-size:20px;font-family:'${family}'">${text}</text>
    </svg>`;
    const out = output();
    const params = ['TnrToSymbol', 'TnrToWingdings', 'TnrToZapfDingbats'];
    out.set_param_bool('textToPath', false);
    for (const p of params) out.set_param_bool(p, false);
    try {
      return (await out.save(SPDocument.createNewDocFromMem(svg)!, 'latin1.wmf'))!;
    } finally {
      out.set_param_bool('textToPath', true);
      for (const p of params) out.set_param_bool(p, true);
    }
  }

  /** The strings of the text records (Layout::print may split the text into several). */
  function record_text(data: Uint8Array): string {
    return wmf_parts(data)
      .records.filter((r) => r[0] === U_WMR_EXTTEXTOUT)
      .map(([, rec]) => {
        const length = rec[10]! | (rec[11]! << 8); // U_WMREXTTEXTOUT: size, function, y, x, Length, Opts
        const opts = rec[12]! | (rec[13]! << 8);
        const start = opts & 0x6 ? 22 : 14; // a rectangle with U_ETO_OPAQUE or U_ETO_CLIPPED
        return new TextDecoder('latin1').decode(rec.subarray(start, start + length));
      })
      .join('');
  }

  /** The face names of the font records. */
  function face_names(data: Uint8Array): string[] {
    return wmf_parts(data)
      .records.filter((r) => r[0] === U_WMR_CREATEFONTINDIRECT)
      .map(([, rec]) => {
        const name = rec.subarray(24); // size, function, 18 bytes of U_FONT before FaceName
        return new TextDecoder('latin1').decode(name.subarray(0, name.indexOf(0)));
      });
  }

  it('transliterates text to Latin1 as iconv LATIN1//TRANSLIT', async () => {
    // decomposed letters lose their accents, symbols get their ASCII forms, the rest becomes '?'.
    // (A form of more than one character, like "..." for "…", is cut off: as upstream, the
    // record keeps as many bytes as the text has characters.)
    expect(record_text(await save_text('Āčě‘x’β', 'Arial'))).toBe("Ace'x'?");
  });

  it('transliterates full-width and compatibility forms', async () => {
    const data = await save_text('ＡＢ１２\u3000x', 'Ｍyﬁ⁴₃');
    expect(record_text(data)).toBe('AB12 x');
    // ligatures become their letters, superscript and subscript digits plain digits
    expect(face_names(data)).toContain('Myfi43');
  });

  it('frees the file and the handle table when the print fails', async () => {
    const imp = db.get('org.inkscape.print.wmf')!.get_imp() as PrintWmf;
    const doc = SPDocument.createNewDocFromMem(SHAPES_SVG)!;
    const fill = vi.spyOn(PrintWmf.prototype, 'fill').mockImplementationOnce(() => {
      throw new Error('print failed');
    });
    try {
      await expect(output().save(doc, 'fail.wmf')).rejects.toThrow('print failed');
    } finally {
      fill.mockRestore();
    }
    expect([imp.wt, imp.wht]).toEqual([0, 0]);
    // the next print starts clean
    const data = (await output().save(doc, 'shapes.wmf'))!;
    expect(data.length).toBeGreaterThan(0);
  });
});
