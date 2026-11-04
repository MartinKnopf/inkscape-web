// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { SPDocument, setCairoBackendLoader } from '@inkscape-web/core';
import { loadCairo } from '@inkscape-web/wasm/cairo';
import { beforeAll, describe, expect, it } from 'vitest';
import { pdfMediaBoxes, pdfText } from '../../../../core/src/extension/internal/pdf-test-utils.ts';
import { db } from '../db.ts';
import type { Output } from '../output.ts';
import { CairoEpsOutput, CairoPsOutput, SP_MODULE_KEY_PRINT_CAIRO_EPS } from './cairo-ps-out.ts';
import { CairoRendererPdfOutput, cairo_renderer_hooks } from './cairo-renderer-pdf-out.ts';

/** A TrueType font of the system for the text tests (Linux CI: DejaVu; macOS: Arial). */
const FONT_FILE = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
].find((f) => existsSync(f));

const DOC = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
  xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
  width="210mm" height="297mm" viewBox="0 0 210 297">
  <sodipodi:namedview>
    <inkscape:page id="p1" x="0" y="0" width="210" height="297" inkscape:label="First"/>
    <inkscape:page id="p2" x="220" y="0" width="100" height="50" bleed="5"/>
  </sodipodi:namedview>
  <rect id="r1" x="10" y="10" width="50" height="30" style="fill:#ff0000"/>
  <text id="t1" x="230" y="30" style="font-size:10px;font-family:sans-serif;fill:#000000">Hello</text>
</svg>`;

function output(id: string): Output {
  const o = db.get(id) as Output | null;
  if (!o) throw new Error(`no output ${id}`);
  return o;
}

async function save(id: string, params: Record<string, string> = {}): Promise<Uint8Array> {
  const doc = SPDocument.createNewDocFromMem(DOC);
  if (!doc) throw new Error('parse failed');
  const out = output(id);
  for (const [k, v] of Object.entries(params)) out.set_param_any(k, v);
  const data = await out.save(doc, 'drawing');
  if (!data) throw new Error('save failed');
  return data;
}

beforeAll(() => {
  setCairoBackendLoader(() => loadCairo());
  CairoRendererPdfOutput.init();
  CairoPsOutput.init();
  CairoEpsOutput.init();
  cairo_renderer_hooks.current = {
    loadFont: async () => (FONT_FILE ? { data: new Uint8Array(readFileSync(FONT_FILE)) } : null),
  };
});

describe('PDF output', () => {
  it('writes one page per page, sized in pt with the bleed', async () => {
    const pdf = await save('org.inkscape.output.pdf.cairorenderer', {
      PDFversion: 'PDF-1.5',
      stretch: 'relative',
    });
    expect(new TextDecoder().decode(pdf.subarray(0, 8))).toBe('%PDF-1.5');
    // A4 (595.28 x 841.89 pt) rounded up; 110 x 60 mm (page with 5 mm bleed) = 311.8 x 170.08 pt.
    expect(pdfMediaBoxes(pdf)).toEqual([
      [0, 0, 596, 842],
      [0, 0, 312, 171],
    ]);
    const text = pdfText(pdf);
    expect(text).toContain('/Creator (Inkscape');
    expect(text).toContain('/Count 2');
    expect(text).toContain('1 0 0 rg'); // the red rect
  });

  it('writes PDF 1.4 when restricted', async () => {
    const pdf = await save('org.inkscape.output.pdf.cairorenderer', { PDFversion: 'PDF-1.4' });
    expect(new TextDecoder().decode(pdf.subarray(0, 8))).toBe('%PDF-1.4');
  });

  it.skipIf(!FONT_FILE)('embeds the font and the text', async () => {
    const text = pdfText(await save('org.inkscape.output.pdf.cairorenderer', { textToPath: 'embed' }));
    expect(text).toMatch(/\/FontFile[23]?/);
    expect(text).toMatch(/\bTJ\b|\bTj\b/);
    // The ToUnicode map lets viewers copy "Hello".
    for (const code of ['0048', '0065', '006c', '006f']) expect(text.toLowerCase()).toContain(`<${code}>`);
  });

  it.skipIf(!FONT_FILE)('draws text as paths when converting text to paths', async () => {
    const text = pdfText(await save('org.inkscape.output.pdf.cairorenderer', { textToPath: 'paths' }));
    expect(text).not.toMatch(/\/FontFile/);
    expect(text).not.toMatch(/\bTJ\b|\bTj\b/);
  });

  it('omits the text and writes the LaTeX file with the LaTeX option', async () => {
    const out = output('org.inkscape.output.pdf.cairorenderer');
    out.set_param_any('textToPath', 'LaTeX');
    const doc = SPDocument.createNewDocFromMem(DOC)!;
    const pdf = pdfText((await out.save(doc, 'figure.pdf'))!);
    out.set_param_any('textToPath', 'embed');
    expect(pdf).not.toMatch(/\bTJ\b|\bTj\b/);
    expect(out.extra_files.map((f) => f.name)).toEqual(['figure.pdf_tex']);
    const tex = new TextDecoder().decode(out.extra_files[0]!.data);
    expect(tex).toContain('{figure.pdf}');
    expect(tex).toContain('Hello');
  });

  it('writes links to URIs and to objects of the document', async () => {
    const doc = SPDocument.createNewDocFromMem(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100">
        <a xlink:href="https://inkscape.org"><rect width="50" height="20" style="fill:#000"/></a>
        <a xlink:href="#target"><rect y="40" width="50" height="20" style="fill:#000"/></a>
        <rect id="target" x="150" y="40" width="20" height="20" style="fill:#f00"/>
      </svg>`,
    )!;
    const text = pdfText((await output('org.inkscape.output.pdf.cairorenderer').save(doc, 'links.pdf'))!);
    expect(text).toMatch(/\/Subtype \/Link/);
    expect(text).toContain('(https://inkscape.org)');
    // The local link goes to a named destination at the object.
    expect(text).toMatch(/\/Dest(s)? *\(target\)|\(target\) *\[/);
  });
});

describe('PS and EPS output', () => {
  it('writes one PostScript page per page', async () => {
    const ps = new TextDecoder().decode(await save('org.inkscape.print.ps.cairo', { PSlevel: 'PS3' }));
    expect(ps.startsWith('%!PS-Adobe-3.0\n')).toBe(true);
    // Cairo uses level 3 only when the drawing needs it.
    expect(ps).toContain('%%Pages: 2');
    expect(ps).toContain('%%+ 110x60mm 312 171');
  });

  it('writes EPS', async () => {
    const eps = new TextDecoder().decode(await save(SP_MODULE_KEY_PRINT_CAIRO_EPS, { PSlevel: 'PS2' }));
    expect(eps.startsWith('%!PS-Adobe-3.0 EPSF-3.0')).toBe(true);
    expect(eps).toContain('%%LanguageLevel: 2');
  });

  it('is offered by the Export dialog only for PDF (is_exported)', () => {
    expect(output('org.inkscape.output.pdf.cairorenderer').is_exported()).toBe(true);
    expect(output('org.inkscape.print.ps.cairo').is_exported()).toBe(false);
  });
});
