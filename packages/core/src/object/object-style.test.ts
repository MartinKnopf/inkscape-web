// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/object-style-test.cpp
/*
 * Tests for the style of objects: cascade from the parent, source of values, update cycle, write.
 *
 * Authors: see git history
 *
 * Copyright (C) 2020 Authors
 * Released under GNU GPL version 2 or later, read the file 'COPYING' for more information
 */
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { SPStyleSrc } from '../style.ts';
import { SP_OBJECT_WRITE_EXT } from './sp-object.ts';

SPDocument.scheduleIdle = () => {};

// The stylesheet of the upstream document is left out, it is not ported. rect becomes g.
const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const get = (doc: SPDocument, id: string) => {
  const o = doc.getObjectById(id);
  if (!o) throw new Error(`no ${id}`);
  return o;
};

const body = `
<g style='fill:blue; stroke-width:2px;font-size: 14px;'>
  <g id='one' style='fill:red; stroke:green;'/>
  <g id='two' style='stroke:green; stroke-width:4px;'/>
  <g id='five' style='font: 15px arial, sans-serif;'/>
  <g id='six' style='stroke-width:1em;'/>
  <g id='seven' style='stroke-width:1ex;'/>
  <g id='eight' style='font-size:15px; stroke-width: 50%;'/>
  <g id='nine' fill='red' stroke='green' opacity='0.5' style='stroke:blue'/>
</g>`;

describe('object style', () => {
  it('cascades the values of the parent', () => {
    const doc = open(body);
    const one = get(doc, 'one').style;
    expect(one.fill.getValue()).toBe('red');
    expect(one.stroke.getValue()).toBe('green');
    expect(one.opacity.getValue()).toBe('1');
    expect(one.stroke_width.getValue()).toBe('2px');

    const two = get(doc, 'two').style;
    expect(two.fill.getValue()).toBe('blue');
    expect(two.stroke_width.getValue()).toBe('4px');
  });

  it('tracks where a value comes from', () => {
    const doc = open(body);
    const one = get(doc, 'one').style;
    expect(one.fill.style_src).toBe(SPStyleSrc.STYLE_PROP);
    expect(one.stroke_width.set).toBe(false);
    const nine = get(doc, 'nine').style;
    expect(nine.fill.style_src).toBe(SPStyleSrc.ATTRIBUTE);
    expect(nine.opacity.style_src).toBe(SPStyleSrc.ATTRIBUTE);
    // The style attribute wins over the presentation attribute.
    expect(nine.stroke.getValue()).toBe('blue');
    expect(nine.stroke.style_src).toBe(SPStyleSrc.STYLE_PROP);
  });

  it('breaks up the font shorthand', () => {
    const style = get(open(body), 'five').style;
    // Font property is ALWAYS unset as it's converted into specific font css properties
    expect(style.font.getValue()).toBe('');
    expect(style.font_size.getValue()).toBe('15px');
    expect(style.font_family.getValue()).toBe('arial, sans-serif');
  });

  it('computes the font dependent lengths', () => {
    const doc = open(body);
    const six = get(doc, 'six').style;
    expect(six.stroke_width.getValue()).toBe('1em');
    expect(six.stroke_width.computed).toBe(14);
    const seven = get(doc, 'seven').style;
    expect(seven.stroke_width.getValue()).toBe('1ex');
    expect(seven.stroke_width.computed).toBe(7);
    // Percentages of the stroke width are relative to the viewport, which is not ported.
    expect(get(doc, 'eight').style.stroke_width.getValue()).toBe('50%');
  });

  it('follows changes of the style attribute and of the parent', () => {
    const doc = open(body);
    const one = get(doc, 'one');
    one.repr.setAttribute('style', 'fill:yellow');
    expect(one.style.fill.getValue()).toBe('yellow');
    expect(one.style.stroke.set).toBe(false);

    get(doc, 'one').parent!.repr.setAttribute('style', 'fill:blue;stroke:pink;font-size:20px');
    doc.ensureUpToDate();
    expect(one.style.stroke.getValue()).toBe('pink');
    expect(one.style.font_size.computed).toBe(20);
  });

  it('follows changes of a presentation attribute', () => {
    const doc = open(body);
    const two = get(doc, 'two');
    two.repr.setAttribute('fill', 'lime');
    expect(two.style.fill.getValue()).toBe('lime');
    expect(two.style.fill.style_src).toBe(SPStyleSrc.ATTRIBUTE);
    two.repr.removeAttribute('fill');
    expect(two.style.fill.set).toBe(false);
  });

  it('writes the style attribute back', () => {
    const doc = open(body);
    const one = get(doc, 'one');
    one.style.mergeString('opacity:0.5');
    one.style.fill.read('#00ff00');
    one.updateRepr(SP_OBJECT_WRITE_EXT);
    // The order of the properties is the order of writing of SPStyle (opacity before fill).
    expect(one.repr.attribute('style')).toBe('opacity:0.5;fill:#00ff00;stroke:green');

    // A presentation attribute is written back to the attribute.
    const nine = get(doc, 'nine');
    nine.style.fill.set = false;
    nine.style.fill.readIfUnset('#123456', SPStyleSrc.ATTRIBUTE);
    nine.updateRepr();
    expect(nine.repr.attribute('fill')).toBe('#123456');
    expect(nine.repr.attribute('style')).toBe('stroke:blue');
  });

  it('keeps the style attribute of an object when it is written unchanged', () => {
    const doc = open("<g id='a' style='fill:red;stroke-width:2px'/>");
    const a = get(doc, 'a');
    a.updateRepr();
    expect(a.repr.attribute('style')).toBe('fill:red;stroke-width:2px');
  });
});
