// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/latex-pstricks.cpp, src/extension/internal/latex-pstricks-out.cpp
import { SPDocument } from '@inkscape-web/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db.ts';
import type { Output } from '../output.ts';
import { LatexOutput } from './latex-pstricks-out.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">' +
  '<g transform="translate(10,0)">' +
  '<rect x="0" y="0" width="20" height="10" style="fill:#ff0000;fill-opacity:0.5;stroke:#0000ff;stroke-width:2;stroke-dasharray:4,2"/>' +
  '</g>' +
  '<path d="M 0,0 C 10,0 20,10 20,20" style="fill:none;stroke:#000000"/>' +
  '<rect width="5" height="5" style="display:none;fill:#00ff00"/>' +
  '</svg>';

async function tex(): Promise<string> {
  const doc = SPDocument.createNewDocFromMem(SVG)!;
  const data = await (db.get('org.inkscape.output.latex') as Output).save(doc, 'a.tex');
  return new TextDecoder().decode(data!);
}

beforeAll(() => LatexOutput.init());

describe('LaTeX PSTricks output', () => {
  it('starts the picture in the size of the document', async () => {
    const out = await tex();
    expect(out.startsWith('%LaTeX with PSTricks extensions\n%%Creator: Inkscape ')).toBe(true);
    expect(out).toContain('\\psset{xunit=.5pt,yunit=.5pt,runit=.5pt}\n\\begin{pspicture}(100,50)\n');
    expect(out.endsWith('\\end{pspicture}\n')).toBe(true);
  });

  it('fills a transformed rectangle with its opacity, in flipped y coordinates', async () => {
    const out = await tex();
    expect(out).toContain(
      '{\n\\newrgbcolor{curcolor}{1 0 0}\n\\pscustom[linestyle=none,fillstyle=solid,fillcolor=curcolor,opacity=0.5]\n{\n' +
        '\\newpath\n\\moveto(10,50)\n\\lineto(30,50)\n\\lineto(30,40)\n\\lineto(10,40)\n\\closepath\n}\n}\n',
    );
  });

  it('strokes with width, color and dashes, and draws a cubic as curveto', async () => {
    const out = await tex();
    expect(out).toContain('\\pscustom[linewidth=2,linecolor=curcolor,linestyle=dashed,dash=4 2]');
    expect(out).toContain('\\curveto(10,50)(20,40)(20,30)\n');
    // no fill for fill:none and nothing for the hidden rectangle
    expect(out.match(/fillstyle=solid/g)).toHaveLength(1);
    expect(out).not.toContain('{0 1 0}');
  });
});
