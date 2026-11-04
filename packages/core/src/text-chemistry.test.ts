// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/text-chemistry.cpp
import { beforeAll, describe, expect, it } from 'vitest';
import { SPDocument } from './document.ts';
import { setupTextLayout } from './libnrtype/text-test-utils.ts';
import type { SPFlowtext } from './object/sp-flowtext.ts';
import type { SPItem } from './object/sp-item.ts';
import { SPText } from './object/sp-text.ts';
import { SP_IS_TEXT_TEXTPATH } from './object/sp-tspan.ts';
import { Selection } from './selection.ts';
import {
  flowtext_to_text,
  text_flow_into_shape,
  text_put_on_path,
  text_remove_from_path,
  text_to_glyphs,
  text_unflow,
} from './text-chemistry.ts';

SPDocument.scheduleIdle = () => {};

beforeAll(setupTextLayout);

const NS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"';

function open(body: string) {
  const doc = SPDocument.createNewDocFromMem(`<svg ${NS} width="500" height="500">${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const select = (...ids: string[]) => {
    const s = new Selection(doc);
    s.setList(ids.map((id) => doc.getObjectById(id) as SPItem));
    return s;
  };
  return { doc, select };
}

const STYLE = "font-family:'DejaVu Sans';font-size:20px";

describe('text chemistry', () => {
  it('puts a text on a path and removes it again', () => {
    const { doc, select } = open(
      `<path id="p" d="M 0,100 L 400,100"/><text id="t" x="10" y="50" style="${STYLE}">` +
        '<tspan sodipodi:role="line">ab</tspan><tspan sodipodi:role="line">cd</tspan></text>',
    );
    expect(text_put_on_path(select('t', 'p'))).toBe(true);
    doc.ensureUpToDate();
    const text = doc.getObjectById('t') as SPText;
    expect(SP_IS_TEXT_TEXTPATH(text)).toBe(true);
    // The lines are joined with a space and laid out along the path.
    expect(text.layout._lines.length).toBe(1);
    expect(text.layout.glyphTransform(text.layout._glyphs[0]!).translation().y).toBeCloseTo(100, 3);

    expect(text_remove_from_path(select('t'))).toBe(true);
    doc.ensureUpToDate();
    expect(SP_IS_TEXT_TEXTPATH(text)).toBe(false);
    expect(text.getRepr().attribute('y')).toBe('100');
  });

  it('flows a text into a shape (SVG 2) and unflows it', () => {
    const { doc, select } = open(
      `<rect id="r" x="0" y="0" width="100" height="400"/>` +
        `<text id="t" x="10" y="50" style="${STYLE}">one two three four five</text>`,
    );
    expect(text_flow_into_shape(select('t', 'r'))).toBe(true);
    doc.ensureUpToDate();
    const text = doc.getObjectById('t') as SPText;
    expect(text.has_shape_inside()).toBe(true);
    expect(text.layout._lines.length).toBeGreaterThan(1);

    expect(text_unflow(select('t'))).toBe(true);
    doc.ensureUpToDate();
    expect(text.has_shape_inside()).toBe(false);
    expect(text.layout._lines.length).toBe(1);
  });

  it('converts flowed text to regular text', () => {
    const { doc, select } = open(
      `<flowRoot id="f" style="${STYLE}"><flowRegion><rect x="0" y="0" width="100" height="400"/></flowRegion>` +
        '<flowPara>one two three four</flowPara></flowRoot>',
    );
    const flow = doc.getObjectById('f') as SPFlowtext;
    const lines = flow.layout._lines.length;
    const selection = select('f');
    expect(flowtext_to_text(selection)).toBe(true);
    doc.ensureUpToDate();
    const text = selection.singleItem();
    expect(text).toBeInstanceOf(SPText);
    expect((text as SPText).layout._lines.length).toBe(lines);
    expect(doc.getObjectById('f')).toBeNull();
  });

  it('converts text to one text per glyph', () => {
    const { doc, select } = open(`<text id="t" x="10" y="50" style="${STYLE}">ab c</text>`);
    const selection = select('t');
    expect(text_to_glyphs(selection)).toBe(true);
    doc.ensureUpToDate();
    expect(
      selection.items().map((i) => (i as SPText).layout._characters.map((c) => c.the_char).join('')),
    ).toEqual(['c', 'b', 'a']);
  });
});
