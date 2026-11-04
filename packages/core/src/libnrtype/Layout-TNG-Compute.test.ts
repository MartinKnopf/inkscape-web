// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/Layout-TNG-Compute.cpp, src/libnrtype/Layout-TNG-Output.cpp
import { Affine } from '@inkscape-web/geom';
import { beforeAll, describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { SPFlowtext } from '../object/sp-flowtext.ts';
import { SPText } from '../object/sp-text.ts';
import { Direction, type Layout } from './Layout-TNG.ts';
import { setupTextLayout } from './text-test-utils.ts';

SPDocument.scheduleIdle = () => {};

beforeAll(setupTextLayout);

const NS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"';

function doc(body: string): SPDocument {
  const d = SPDocument.createNewDocFromMem(`<svg ${NS} width="1000" height="1000">${body}</svg>`);
  if (!d) throw new Error('no document');
  d.ensureUpToDate();
  return d;
}

function layoutOf(body: string, id = 't'): Layout {
  const o = doc(body).getObjectById(id);
  if (!(o instanceof SPText) && !(o instanceof SPFlowtext)) throw new Error('no text');
  return o.layout;
}

/** x of each character (chunk + span + character offset). */
function charX(layout: Layout): number[] {
  return layout._characters.map((_c, i) => layout.characterAnchorPoint(layout.charIndexToIterator(i)).x);
}

const DEJAVU = "font-family:'DejaVu Sans';font-size:100px";

describe('Layout with HarfBuzz', () => {
  it('shapes with the font advances and kerning', () => {
    const plain = layoutOf(`<text id="t" x="0" y="100" style="${DEJAVU}">HH</text>`);
    const kerned = layoutOf(`<text id="t" x="0" y="100" style="${DEJAVU}">AV</text>`);
    // DejaVu Sans: H is 1540 and A 1401 units of 2048 wide; the AV pair is kerned.
    expect(plain._glyphs[1]!.x).toBeCloseTo((1540 / 2048) * 100, 5);
    expect(kerned._glyphs[1]!.x).toBeLessThan((1401 / 2048) * 100 - 1);
  });

  it('uses the glyph outlines for the bounding box', () => {
    const layout = layoutOf(`<text id="t" x="10" y="100" style="${DEJAVU}">x</text>`);
    const r = layout.bounds(Affine.identity());
    // x sits on the baseline: its ink bottom is the baseline, its top the x-height (54.7 px).
    expect(r!.bottom()).toBeCloseTo(100, 0);
    expect(100 - r!.top()).toBeCloseTo(54.7, 0);
  });

  it('adds letter and word spacing', () => {
    const a = layoutOf(`<text id="t" x="0" y="100" style="${DEJAVU}">a b</text>`);
    const b = layoutOf(
      `<text id="t" x="0" y="100" style="${DEJAVU};letter-spacing:10px;word-spacing:20px">a b</text>`,
    );
    const xa = charX(a);
    const xb = charX(b);
    expect(xb[1]! - xa[1]!).toBeCloseTo(10, 5);
    expect(xb[2]! - xa[2]!).toBeCloseTo(40, 5); // two letter spacings and one word spacing
  });

  it('places right to left runs in visual order', () => {
    const layout = layoutOf(`<text id="t" x="0" y="100" style="${DEJAVU}">ab אב</text>`);
    const spans = layout._spans;
    expect(spans.map((s) => s.direction)).toEqual([Direction.LEFT_TO_RIGHT, Direction.RIGHT_TO_LEFT]);
    const x = charX(layout);
    // The Hebrew letters run right to left: the first one is right of the second.
    expect(x[3]!).toBeGreaterThan(x[4]!);
    expect(x[4]!).toBeGreaterThan(x[2]!);
  });

  it('aligns with text-anchor', () => {
    const start = layoutOf(`<text id="t" x="500" y="100" style="${DEJAVU}">abc</text>`);
    const middle = layoutOf(`<text id="t" x="500" y="100" style="${DEJAVU};text-anchor:middle">abc</text>`);
    const end = layoutOf(`<text id="t" x="500" y="100" style="${DEJAVU};text-anchor:end">abc</text>`);
    const width = start.getActualLength();
    expect(middle._chunks[0]!.left_x).toBeCloseTo(500 - width / 2, 5);
    expect(end._chunks[0]!.left_x).toBeCloseTo(500 - width, 5);
  });

  it('applies dx, dy and rotate', () => {
    const layout = layoutOf(
      `<text id="t" x="0" y="100" dx="0 10" dy="0 5" rotate="0 30" style="${DEJAVU}">ab</text>`,
    );
    const plain = layoutOf(`<text id="t" x="0" y="100" style="${DEJAVU}">ab</text>`);
    expect(layout._glyphs[1]!.x - plain._glyphs[1]!.x).toBeCloseTo(10, 5);
    expect(layout._glyphs[1]!.y).toBeCloseTo(5, 5);
    expect(layout._glyphs[1]!.rotation).toBeCloseTo(Math.PI / 6, 5);
  });

  it('stretches to textLength', () => {
    const layout = layoutOf(`<text id="t" x="0" y="100" textLength="500" style="${DEJAVU}">abc</text>`);
    // The last glyph ends at the text length (upstream adds the increment after each character).
    const last = layout._glyphs.at(-1)!;
    expect(last.x + last.advance - (layout.textLengthIncrement ? 0 : 0)).toBeGreaterThan(0);
    const plain = layoutOf(`<text id="t" x="0" y="100" style="${DEJAVU}">abc</text>`);
    const natural = plain.getActualLength();
    expect(last.x + last.advance).toBeCloseTo(natural + ((500 - natural) / 2) * 2, 3);
  });

  it('shifts the baseline', () => {
    const layout = layoutOf(
      `<text id="t" x="0" y="100" style="${DEJAVU}">a<tspan id="s" style="baseline-shift:20px">b</tspan></text>`,
    );
    expect(layout._glyphs[1]!.y - layout._glyphs[0]!.y).toBeCloseTo(-20, 5);
  });

  it('lays out vertical text top to bottom', () => {
    const layout = layoutOf(`<text id="t" x="100" y="0" style="${DEJAVU};writing-mode:tb-rl">漢字</text>`);
    const a = layout.characterAnchorPoint(layout.charIndexToIterator(0));
    const b = layout.characterAnchorPoint(layout.charIndexToIterator(1));
    expect(b.x).toBeCloseTo(a.x, 5);
    expect(b.y).toBeGreaterThan(a.y);
  });

  it('breaks lines at word boundaries with inline-size', () => {
    const layout = layoutOf(
      `<text id="t" x="0" y="100" style="${DEJAVU};inline-size:400px">one two three four five</text>`,
    );
    expect(layout._lines.length).toBeGreaterThan(1);
    for (const g of layout._glyphs)
      expect(layout._chunks[layout._characters[g.in_character]!.in_span]).toBeDefined();
    // Every line starts with a word.
    const starts = layout._lines.map((_l, i) => layout._characters[layout._lineToCharacter(i)]!.the_char);
    expect(starts.every((c) => /\S/.test(c))).toBe(true);
  });

  it('flows text into a shape-inside rectangle', () => {
    const layout = layoutOf(
      `<rect id="r" x="100" y="100" width="300" height="1000"/>` +
        `<text id="t" style="${DEJAVU};shape-inside:url(#r);white-space:pre-wrap">one two three four</text>`,
    );
    expect(layout._lines.length).toBeGreaterThan(1);
    expect(layout._lines[0]!.baseline_y).toBeGreaterThan(100);
    for (const c of layout._chunks) expect(c.left_x).toBeGreaterThanOrEqual(100);
  });

  it('flows SVG 1.2 flowRoot text into its region', () => {
    const layout = layoutOf(
      `<flowRoot id="t" style="${DEJAVU}"><flowRegion><rect x="0" y="0" width="300" height="1000"/></flowRegion>` +
        '<flowPara>one two three four</flowPara></flowRoot>',
    );
    expect(layout._lines.length).toBeGreaterThan(1);
    expect(layout.inputTruncated()).toBe(false);
  });

  it('puts text on a path', () => {
    const layout = layoutOf(
      `<path id="p" d="M 0,500 L 1000,500"/>` +
        `<text id="t" style="${DEJAVU}"><textPath xlink:href="#p" startOffset="100">ab</textPath></text>`,
    );
    const m = layout.glyphTransform(layout._glyphs[0]!);
    expect(m.c4).toBeCloseTo(100, 3);
    expect(m.c5).toBeCloseTo(500, 3);
  });
});
