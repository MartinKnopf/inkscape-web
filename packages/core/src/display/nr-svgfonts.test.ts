// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/nr-svgfonts.cpp
import { PathVector } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import type { SPFont } from '../object/sp-font.ts';
import { SvgFont } from './nr-svgfonts.ts';

SPDocument.scheduleIdle = () => {};

const FONT =
  '<svg xmlns="http://www.w3.org/2000/svg"><defs><font id="f" horiz-adv-x="500">' +
  '<font-face font-family="Test" units-per-em="1000"/>' +
  '<missing-glyph d="M0,0 h400 v700 h-400 z"/>' +
  '<glyph unicode="ff" glyph-name="ff" horiz-adv-x="900" d="M0,0 h800 v700 h-800 z"/>' +
  '<glyph unicode="f" glyph-name="f" d="M0,0 h300 v700 h-300 z"/>' +
  '<glyph unicode="A" glyph-name="A" horiz-adv-x="600" d="M0,0 L300,700 L600,0 z"/>' +
  '<glyph unicode="V" glyph-name="V" horiz-adv-x="600" d="M0,700 L300,0 L600,700 z"/>' +
  '<hkern u1="A" u2="V" k="100"/>' +
  '</font></defs></svg>';

function font(): SvgFont {
  const doc = SPDocument.createNewDocFromMem(FONT)!;
  doc.ensureUpToDate();
  return new SvgFont(doc.getObjectById('f') as SPFont);
}

describe('SvgFont', () => {
  it('maps text to glyphs with ligatures, kerning and the missing-glyph', () => {
    const f = font();
    expect(f.units_per_em()).toBe(1000);
    expect(f.scaled_font_text_to_glyphs('ffAVx').map((g) => [g.index, g.x])).toEqual([
      [0, 0], // ff
      [2, 0.9], // A
      [3, 1.4], // V, kerned by 100
      [4, 2.0], // missing-glyph
    ]);
  });

  it('gives the glyph outlines with the baseline at y = size', () => {
    const f = font();
    const box = PathVector.boundsExact(f.text_path('A', 100, 10, 50))!;
    expect([box.left(), box.top(), box.right(), box.bottom()].map((v) => Math.round(v))).toEqual([
      10, -20, 70, 50,
    ]);
  });
});
