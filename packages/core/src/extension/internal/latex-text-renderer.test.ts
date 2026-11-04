// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../../document.ts';
import { latex_render_document_text_to_file } from './latex-text-renderer.ts';

const latex = (body: string, pdflatex = true) => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">${body}</svg>`,
  )!;
  return latex_render_document_text_to_file(doc, 'out/drawing.pdf', pdflatex)!;
};

describe('LaTeX text renderer', () => {
  it('writes the picture with its size and the text at its anchor, escaped', () => {
    const tex = latex('<text x="20" y="50" style="font-size:10px;fill:#ff0000">50% &amp; more</text>');
    expect(tex).toContain("%% Accompanies image file 'drawing.pdf' (pdf, eps, ps)");
    expect(tex).toContain('\\setlength{\\unitlength}{150bp}%'); // 200 px
    expect(tex).toContain('\\begin{picture}(1,0.5)%');
    // The anchor in units of the width, y up: (20, 50) -> (0.1, 0.25).
    expect(tex).toContain('\\put(0.1,0.25){\\color[rgb]{1,0,0}\\makebox(0,0)[lt]{');
    expect(tex).toContain('50\\% \\& more');
    expect(tex.endsWith('  \\end{picture}%\n\\endgroup%\n')).toBe(true);
  });

  it('marks bold and italic spans and rotation', () => {
    const tex = latex(
      '<text x="10" y="10" transform="rotate(-90 10 10)" style="font-size:10px">A<tspan style="font-weight:bold">B</tspan><tspan style="font-style:italic">C</tspan></text>',
    );
    expect(tex).toContain('\\rotatebox{90}{');
    expect(tex).toContain('A\\textbf{B}\\textit{C}');
  });

  it('includes one PDF page per graphic layer (pdflatex) or the whole image (PS)', () => {
    const body = '<rect width="10" height="10"/><text x="20" y="50">T</text><rect width="5" height="5"/>';
    const pdf = latex(body, true);
    expect(pdf).toContain('\\includegraphics[width=\\unitlength,page=1]{drawing.pdf}');
    expect(pdf).toContain('\\includegraphics[width=\\unitlength,page=2]{drawing.pdf}');
    const ps = latex(body, false);
    expect(ps.match(/put\(0,0\){\\includegraphics/g)).toHaveLength(1);
  });
});
