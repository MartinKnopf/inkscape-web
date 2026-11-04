// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/svg-fonts-dialog.cpp
import { DocumentUndo, ObjectSet, SPDocument, SvgFont } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import {
  add_font,
  add_glyph,
  add_kerning_pair,
  document_fonts,
  font_face,
  font_glyphs,
  set_glyph_description_from_selected_path,
  set_kerning_value,
} from './svg-fonts-dialog.ts';

SPDocument.scheduleIdle = () => {};

function doc(): SPDocument {
  const d = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg"><defs/><path id="p" d="M0,0 H500 V700 H0 Z"/><rect id="r"/></svg>',
  )!;
  d.ensureUpToDate();
  return d;
}

describe('SVG Font Editor', () => {
  it('adds a font with defaults, and undo removes it', () => {
    const d = doc();
    const font = add_font(d);
    expect(document_fonts(d)).toEqual([font]);
    expect(font.label()).toBe('font 0');
    expect(font.horiz_adv_x).toBe(1000);
    expect(font_face(font)?.getAttribute('font-family')).toBe('SVGFont 0');
    expect(font_face(font)?.getAttribute('units-per-em')).toBe('1000');
    DocumentUndo.undo(d);
    expect(document_fonts(d)).toEqual([]);
  });

  it('adds glyphs with the next character and takes curves from the selection', () => {
    const d = doc();
    const font = add_font(d);
    const a = add_glyph(font);
    expect(a.unicode).toBe(' ');
    a.setAttribute('unicode', '~');
    expect(add_glyph(font).unicode).toBe(' '); // skips the control chars 7f-9f
    expect(font_glyphs(font)).toHaveLength(2);

    const selection = new ObjectSet(d);
    expect(set_glyph_description_from_selected_path(selection, font, a)).toMatch(/Select a <b>path<\/b>/);
    selection.set(d.getObjectById('r')!);
    expect(set_glyph_description_from_selected_path(selection, font, a)).toMatch(
      /does not have a <b>path<\/b>/,
    );
    selection.set(d.getObjectById('p')!);
    expect(set_glyph_description_from_selected_path(selection, font, a)).toBeNull();
    d.ensureUpToDate();
    // y flipped with the baseline at units-per-em: the glyph stands on the baseline
    expect(new SvgFont(font).text_path('~', 1000).length).toBe(1);
    expect(a.d).toBe('M 0,1000 H 500 V 300 H 0 Z');
  });

  it('adds a kerning pair once and sets k from the slider', () => {
    const d = doc();
    const font = add_font(d);
    const pair = add_kerning_pair(font, 'A', 'V')!;
    expect(add_kerning_pair(font, 'A', 'V')).toBe(pair);
    expect(pair.k).toBe(0);
    set_kerning_value(font, pair, 900);
    expect(pair.k).toBe(100);
  });
});
