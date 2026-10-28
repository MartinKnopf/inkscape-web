// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-text.cpp, src/object/sp-tspan.cpp, src/object/sp-string.cpp, src/object/sp-flowtext.cpp
import { type Rect, Scale, Translate } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { FakeDrawing, type FakeDrawingGroup, type FakeDrawingText } from '../display/fake-drawing.ts';
import { SPDocument } from '../document.ts';
import { SPFlowtext } from './sp-flowtext.ts';
import { SPString } from './sp-string.ts';
import { SPText } from './sp-text.ts';
import { SP_TSPAN_ROLE_LINE, SP_TSPAN_ROLE_UNSPECIFIED, type SPTSpan } from './sp-tspan.ts';

SPDocument.scheduleIdle = () => {};

// The default measurer (FixedWidthTextMeasurer): every character is 0.5 em wide,
// ascent 0.8 em, descent 0.2 em.
const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">';

const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(`${SVG_OPEN}${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const textOf = (doc: SPDocument, id = 't') => {
  const o = doc.getObjectById(id);
  if (!(o instanceof SPText)) throw new Error(`no text ${id}`);
  return o;
};
const bounds = (r: Rect | null) => r && [r.left(), r.top(), r.right(), r.bottom()];

describe('SPString', () => {
  it('collapses white space by default and keeps it with xml:space="preserve"', () => {
    const strings = (body: string) =>
      textOf(open(body))
        .children.filter((c) => c instanceof SPString)
        .map((s) => s.string);
    expect(strings('<text id="t">  a \n  b  </text>')).toEqual(['a b']);
    expect(strings('<text id="t" xml:space="preserve">  a  b </text>')).toEqual(['  a  b ']);
  });
});

describe('TextTagAttributes', () => {
  it('reads and writes x, y, dx, dy and rotate lists', () => {
    const doc = open('<text id="t" x="1 2,3" y="4" dx="0.5" rotate="10 20">abc</text>');
    const t = textOf(doc);
    expect(t.attributes.attributes.x.map((l) => l.computed)).toEqual([1, 2, 3]);
    expect(t.attributes.firstXY()).toMatchObject({ x: 1, y: 4 });
    t.updateRepr();
    expect(t.getAttribute('x')).toBe('1 2 3');
    expect(t.getAttribute('rotate')).toBe('10 20');
  });

  it('inserts interpolated x values and erases values with the characters', () => {
    const t = textOf(open('<text id="t" x="0 10 20" dx="1 2 3">abc</text>'));
    t.attributes.insert(1, 2);
    expect(t.attributes.attributes.x.map((l) => l.computed)).toEqual([0, 0, 5, 10, 20]);
    expect(t.attributes.attributes.dx.map((l) => l.computed)).toEqual([1, 0, 0, 2, 3]);
    t.attributes.erase(1, 2);
    expect(t.attributes.attributes.x.map((l) => l.computed)).toEqual([0, 10, 20]);
  });

  it('gives role="line" tspans the position computed by the layout', () => {
    const doc = open(
      '<text id="t" x="10" y="100" style="font-size:20px;line-height:1.25">' +
        '<tspan id="a" sodipodi:role="line" x="999" y="999">ab</tspan>' +
        '<tspan id="b" sodipodi:role="line">cd</tspan></text>',
    );
    const a = doc.getObjectById('a') as SPTSpan;
    const b = doc.getObjectById('b') as SPTSpan;
    expect(a.role).toBe(SP_TSPAN_ROLE_LINE);
    expect(a.attributes.firstXY()).toMatchObject({ x: 10, y: 100 });
    // Line spacing: 1.25 * 20px.
    expect(b.attributes.firstXY()).toMatchObject({ x: 10, y: 125 });
    textOf(doc).updateRepr();
    expect(b.getAttribute('y')).toBe('125');
  });

  it('keeps explicit positions of tspans without role', () => {
    const doc = open('<text id="t" x="10" y="20">a<tspan id="s" x="50" dy="5">b</tspan></text>');
    const s = doc.getObjectById('s') as SPTSpan;
    expect(s.role).toBe(SP_TSPAN_ROLE_UNSPECIFIED);
    const layout = textOf(doc).layout;
    expect(layout._characters.map((c) => [c.x, c.y])).toEqual([
      [10, 20],
      [50, 25],
    ]);
  });
});

describe('SPText', () => {
  it('has bounding boxes from the layout and the text anchor as snap point', () => {
    const t = textOf(open('<text id="t" x="10" y="100" style="font-size:20px">abcd</text>'));
    // 4 characters of 10px; ascent 16, descent 4.
    expect(bounds(t.geometricBounds())).toEqual([10, 84, 50, 104]);
    expect(t.description()).toBe('(4 characters)');
    expect(t.displayName()).toBe('Text');
  });

  it('aligns lines with text-anchor', () => {
    const doc = open(
      '<text id="t" x="100" y="50" style="font-size:20px;text-anchor:middle">' +
        '<tspan sodipodi:role="line">ab</tspan><tspan sodipodi:role="line">abcd</tspan></text>',
    );
    const xs = textOf(doc)
      .layout._characters.filter((c) => !c.is_break)
      .map((c) => c.x);
    expect(xs).toEqual([90, 100, 80, 90, 100, 110]);
  });

  it('shows one text item per span with the character positions', () => {
    const doc = open('<text id="t" x="10" y="20" style="font-size:10px">ab<tspan>c</tspan></text>');
    const t = textOf(doc);
    const drawing = new FakeDrawing();
    const g = t.invokeShow(drawing, 1, 0) as FakeDrawingGroup;
    const texts = g.children as FakeDrawingText[];
    expect(texts.map((x) => x.components.map((c) => [c.text, c.x, c.y]))).toEqual([
      [
        ['a', 10, 20],
        ['b', 15, 20],
      ],
      [['c', 20, 20]],
    ]);
  });

  it('embeds scaling into the font size and translation into x and y', () => {
    const doc = open(
      '<text id="t" x="10" y="20" style="font-size:10px"><tspan id="s" sodipodi:role="line">a</tspan></text>',
    );
    const t = textOf(doc);
    t.doWriteTransform(Scale(2).multiply(Translate(5, 0)));
    doc.ensureUpToDate();
    expect(t.getAttribute('transform')).toBeNull();
    expect(t.getAttribute('x')).toBe('25');
    expect(t.getAttribute('y')).toBe('40');
    expect(t.style.font_size.computed).toBe(20);
    expect(t.getAttribute('style')).toContain('font-size:20px');
  });
});

describe('SPFlowtext', () => {
  it('wraps the paragraphs in the flow region', () => {
    const doc = open(
      '<flowRoot id="f" style="font-size:10px;line-height:1.25">' +
        '<flowRegion><rect x="0" y="0" width="22" height="100"/></flowRegion>' +
        '<flowPara>ab cd</flowPara><flowPara>e</flowPara></flowRoot>',
    );
    const f = doc.getObjectById('f');
    if (!(f instanceof SPFlowtext)) throw new Error('no flowtext');
    const lines = f.layout._characters.filter((c) => !c.is_white).map((c) => [c.the_char, c.x, c.y]);
    // "ab c" would be 20 wide, "ab cd" 25: "cd" goes to the next line. The first baseline is at
    // the ascent with half-leading (8 + 1.25), the lines are 12.5 apart.
    expect(lines).toEqual([
      ['a', 0, 9.25],
      ['b', 5, 9.25],
      ['c', 0, 21.75],
      ['d', 5, 21.75],
      ['e', 0, 34.25],
    ]);
  });
});
