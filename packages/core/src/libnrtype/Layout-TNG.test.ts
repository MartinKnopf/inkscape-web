// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/Layout-TNG-OutIter.cpp, src/libnrtype/Layout-TNG-Compute.cpp
import { Affine, Point } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { SPText } from '../object/sp-text.ts';
import type { Layout } from './Layout-TNG.ts';

SPDocument.scheduleIdle = () => {};

// FixedWidthTextMeasurer (the default): 10px font → 5px per character, ascent 8, descent 2.
// Two lines "abc" and "de" at x=10, baselines 100 and 112.5.
function twoLines(): Layout {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">' +
      '<text id="t" x="10" y="100" style="font-size:10px;line-height:1.25">' +
      '<tspan sodipodi:role="line">abc</tspan><tspan sodipodi:role="line">de</tspan></text></svg>',
  );
  doc?.ensureUpToDate();
  const t = doc?.getObjectById('t');
  if (!(t instanceof SPText)) throw new Error('no text');
  return t.layout;
}

describe('Layout output', () => {
  it('has a line break character between the lines', () => {
    const layout = twoLines();
    expect(layout._lines.map((l) => l.baseline_y)).toEqual([100, 112.5]);
    expect(layout._characters.map((c) => [c.the_char, c.x, c.y, c.in_line])).toEqual([
      ['a', 10, 100, 0],
      ['b', 15, 100, 0],
      ['c', 20, 100, 0],
      ['\n', 25, 100, 0],
      ['d', 10, 112.5, 1],
      ['e', 15, 112.5, 1],
    ]);
    expect(layout.characterAt(layout.charIndexToIterator(3))).toBe('\n');
  });

  it('gives the cursor shape from the descent to the ascent', () => {
    const layout = twoLines();
    expect(layout.queryCursorShape(layout.charIndexToIterator(1))).toEqual({
      position: new Point(15, 102),
      height: 10,
      rotation: 0,
    });
    // The end: after the last character.
    expect(layout.queryCursorShape(layout.end()).position).toEqual(new Point(20, 114.5));
  });

  it('finds the nearest cursor position to a point', () => {
    const layout = twoLines();
    expect(layout.getNearestCursorPositionTo(new Point(16, 98)).charIndex()).toBe(1);
    expect(layout.getNearestCursorPositionTo(new Point(100, 98)).charIndex()).toBe(3); // end of line 1
    expect(layout.getNearestCursorPositionTo(new Point(12, 120)).charIndex()).toBe(4);
    expect(layout.getNearestCursorPositionTo(new Point(100, 120)).equals(layout.end())).toBe(true);
  });

  it('covers the selection with one quad per span and line', () => {
    const layout = twoLines();
    const quads = layout.createSelectionShape(layout.charIndexToIterator(1), layout.end(), Affine.identity());
    expect(quads.map((p) => [p.x, p.y])).toEqual([
      [15, 92],
      [25, 92],
      [25, 102],
      [15, 102],
      [10, 104.5],
      [20, 104.5],
      [20, 114.5],
      [10, 114.5],
    ]);
  });
});

describe('Layout iterator', () => {
  it('moves left and right over the line break', () => {
    const layout = twoLines();
    const it = layout.charIndexToIterator(3);
    expect(it.cursorRight()).toBe(true);
    expect(it.charIndex()).toBe(4);
    it.cursorLeft();
    it.cursorLeft();
    expect(it.charIndex()).toBe(2);
  });

  it('moves up and down keeping the x coordinate', () => {
    const layout = twoLines();
    const it = layout.charIndexToIterator(2); // before "c"
    expect(it.cursorDown()).toBe(true);
    expect(it.equals(layout.end())).toBe(true); // x 20 is the end of "de"
    expect(it.cursorUp()).toBe(true);
    expect(it.charIndex()).toBe(2);
    expect(it.cursorUp()).toBe(false);
  });

  it('goes to the start and the end of the line', () => {
    const layout = twoLines();
    const it = layout.charIndexToIterator(5);
    it.thisStartOfLine();
    expect(it.charIndex()).toBe(4);
    const it2 = layout.charIndexToIterator(1);
    it2.thisEndOfLine();
    expect(it2.charIndex()).toBe(3);
  });

  it('moves by words', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg"><text id="t" xml:space="preserve">one two  three</text></svg>',
    );
    doc?.ensureUpToDate();
    const t = doc?.getObjectById('t');
    if (!(t instanceof SPText)) throw new Error('no text');
    const layout = t.layout;
    const it = layout.begin();
    it.nextStartOfWord();
    expect(it.charIndex()).toBe(4);
    it.nextStartOfWord();
    expect(it.charIndex()).toBe(9);
    it.prevStartOfWord();
    expect(it.charIndex()).toBe(4);
  });
});
