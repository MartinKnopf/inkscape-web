// SPDX-License-Identifier: GPL-2.0-or-later
// Test helper: read the structure of the PDF files that cairo writes (pages, media boxes and the
// content of the compressed streams). Uses node:zlib; not used by the app.
// biome-ignore lint/correctness/noNodejsModules: only the tests (in Node) use this helper
import { inflateSync } from 'node:zlib';

/**
 * The text of the PDF with every FlateDecode stream inflated in place: object streams (PDF 1.5)
 * and content streams become readable.
 */
export function pdfText(pdf: Uint8Array): string {
  const latin1 = Buffer.from(pdf).toString('latin1');
  let out = '';
  let pos = 0;
  const re = /(?<!end)stream\r?\n/g;
  for (let m = re.exec(latin1); m; m = re.exec(latin1)) {
    const start = m.index + m[0].length;
    const end = latin1.indexOf('endstream', start);
    if (end < 0) break;
    const dict = latin1.slice(Math.max(0, latin1.lastIndexOf('<<', m.index)), m.index);
    out += latin1.slice(pos, start);
    if (dict.includes('/FlateDecode')) {
      try {
        out += inflateSync(Buffer.from(pdf.subarray(start, end))).toString('latin1');
      } catch {
        out += latin1.slice(start, end);
      }
    } else {
      out += latin1.slice(start, end);
    }
    pos = end;
    re.lastIndex = end;
  }
  return out + latin1.slice(pos);
}

/** The media boxes of the pages, in order of appearance: [x0, y0, x1, y1] in pt. */
export function pdfMediaBoxes(pdf: Uint8Array): number[][] {
  const text = pdfText(pdf);
  const boxes: number[][] = [];
  for (const m of text.matchAll(/\/Type\s*\/Page\b[^>]*?\/MediaBox\s*\[([^\]]*)\]/g)) {
    boxes.push(m[1]!.trim().split(/\s+/).map(Number));
  }
  return boxes;
}
