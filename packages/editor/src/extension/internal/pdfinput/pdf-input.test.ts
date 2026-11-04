// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { SPDocument, setCairoBackendLoader } from '@inkscape-web/core';
import { loadCairo } from '@inkscape-web/wasm/cairo';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.ts';
import type { Input } from '../../input.ts';
import type { Output } from '../../output.ts';
import { CairoRendererPdfOutput, cairo_renderer_hooks } from '../cairo-renderer-pdf-out.ts';
import { FontFallback, PdfImportDialog, PdfImportType, PdfInput } from './pdf-input.ts';

const FONT_FILE = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
].find((f) => existsSync(f));

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
  xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:cc="http://creativecommons.org/ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" width="200" height="100">
  <metadata><rdf:RDF><cc:Work><dc:title>Round trip</dc:title></cc:Work></rdf:RDF></metadata>
  <sodipodi:namedview>
    <inkscape:page id="p1" x="0" y="0" width="200" height="100"/>
    <inkscape:page id="p2" x="210" y="0" width="100" height="100"/>
  </sodipodi:namedview>
  <rect id="r" x="10" y="10" width="50" height="30" style="fill:#ff0000"/>
  <text x="20" y="80" style="font-size:16px;font-family:sans-serif;fill:#0000ff">Hello</text>
  <circle cx="260" cy="50" r="20" style="fill:#00ff00"/>
</svg>`;

/** A two-page PDF from the PDF output. */
async function makePdf(): Promise<Uint8Array> {
  const doc = SPDocument.createNewDocFromMem(SVG)!;
  const out = db.get('org.inkscape.output.pdf.cairorenderer') as Output;
  return (await out.save(doc, 'test.pdf'))!;
}

const input = () => db.get('org.inkscape.input.pdf') as Input;

beforeAll(() => {
  setCairoBackendLoader(() => loadCairo());
  CairoRendererPdfOutput.init();
  PdfInput.init();
  cairo_renderer_hooks.current = {
    loadFont: async () => (FONT_FILE ? { data: new Uint8Array(readFileSync(FONT_FILE)) } : null),
  };
});

afterEach(() => {
  PdfInput.show_dialog = null;
});

describe('PDF import', () => {
  it('imports the first page with its paths, metadata and page', async () => {
    const doc = await input().open('test.pdf', await makePdf());
    expect(doc).not.toBeNull();
    const xml = doc!.rroot;
    const all = (name: string) => {
      const out: string[] = [];
      const walk = (n: typeof xml) => {
        if (n.name() === name) out.push(n.attribute('style') ?? n.attribute('viewBox') ?? '');
        for (let c = n.firstChild(); c; c = c.next()) walk(c);
      };
      walk(xml);
      return out;
    };
    expect(all('svg:path').some((s) => s.includes('fill:#ff0000'))).toBe(true);
    expect(all('svg:view')).toHaveLength(1); // one page imported
    expect(doc!.getRoot().viewBox_set).toBe(true);
    const title = [
      ...(function* t(n: typeof xml): Generator<string> {
        if (n.name() === 'dc:title') yield n.firstChild()?.content() ?? '';
        for (let c = n.firstChild(); c; c = c.next()) yield* t(c);
      })(xml),
    ];
    expect(title).toContain('Round trip');
  });

  it('imports the pages that the dialog selects as pages', async () => {
    PdfInput.show_dialog = async (dlg) => {
      expect(dlg._total_pages).toBe(2);
      expect(dlg.setPageNumbers('x')).toBe(false);
      expect(dlg.setPageNumbers('1-2')).toBe(true);
      const preview = dlg.previewImage(100, 100);
      expect(preview && [preview.width, preview.height]).toEqual([100, 50]);
      expect(preview!.data[0]).toBeGreaterThan(200); // the white page
      return true;
    };
    const doc = await input().open('test.pdf', await makePdf());
    expect(doc!.getPageManager().getPageCount()).toBe(2);
  });

  it.skipIf(!FONT_FILE)('keeps text as text, or draws it as shapes, by font strategy', async () => {
    let strategy = FontFallback.AS_TEXT;
    PdfInput.show_dialog = async (dlg) => {
      expect(dlg._font_model.length).toBeGreaterThan(0);
      for (const row of dlg._font_model) dlg.setFontStrategy(row.id, strategy);
      return true;
    };
    const text = (doc: SPDocument | null) => {
      let s = '';
      const walk = (n: ReturnType<SPDocument['rroot']['firstChild']>) => {
        for (let c = n; c; c = c.next()) {
          if (c.type() === 'text') s += c.content();
          walk(c.firstChild());
        }
      };
      walk(doc!.rroot.firstChild());
      return s;
    };
    expect(text(await input().open('test.pdf', await makePdf()))).toContain('Hello');
    strategy = FontFallback.AS_SHAPES;
    expect(text(await input().open('test.pdf', await makePdf()))).not.toContain('Hello');
  });

  it('imports with cairo when the dialog chooses the Cairo import', async () => {
    PdfInput.show_dialog = async (dlg) => {
      expect(dlg.setImportMethod(PdfImportType.PDF_IMPORT_CAIRO)).toBe(true);
      return true;
    };
    const doc = await input().open('test.pdf', await makePdf());
    expect(doc!.getDimensions().x).toBeCloseTo(200, 0);
  });

  it('cancels when the dialog is cancelled and fails on data that is no PDF', async () => {
    PdfInput.show_dialog = async () => false;
    expect(await input().open('test.pdf', await makePdf())).toBeNull();
    expect(await input().open('bad.pdf', new TextEncoder().encode('no pdf'))).toBeNull();
  });

  it('labels the mesh precision', () => {
    const dlg = { _mod: input() } as unknown as PdfImportDialog;
    expect(PdfImportDialog.prototype.meshLabel.call(dlg, 1)).toBe('rough');
    expect(PdfImportDialog.prototype.meshLabel.call(dlg, 246)).toBe('very fine');
  });
});
