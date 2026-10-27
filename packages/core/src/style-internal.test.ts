// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/style-internal-test.cpp
/*
 * Tests for Style internal classes
 *
 * Authors: see git history
 *
 * Copyright (C) 2020 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { describe, expect, it } from 'vitest';
import { SPAttr } from './attributes.ts';
import { SPDocument } from './document.ts';
import { SPStyle } from './style.ts';
import { SPCSSFontWeight } from './style-enums.ts';
import {
  extractUri,
  formatClassic,
  SPIColorInterpolation,
  SPIDashArray,
  SPIEnumFontWeight,
  SPIPaint,
  SPIPaintOrder,
  SPIString,
} from './style-internal.ts';

describe('SPIDashArray', () => {
  const read = (s: string) => {
    const a = new SPIDashArray(SPAttr.STROKE_DASHARRAY);
    a.read(s);
    return a;
  };

  it('compares', () => {
    const array = read('0 1 2 3');
    const subsetArray = read('0 1');
    expect(array.equals(subsetArray)).toBe(false);
    expect(subsetArray.equals(array)).toBe(false);
    expect(array.equals(read('0 1 2 3'))).toBe(true);
    expect(read('0 1 2 3').equals(array)).toBe(true);
  });

  it('checks validity', () => {
    // valid dash arrays
    expect(read('').isValid()).toBe(true);
    expect(read('0').isValid()).toBe(true);
    expect(read('0 1e3').isValid()).toBe(true);
    // invalid dash arrays
    expect(read('10 10 -10').isValid()).toBe(false);
    // SPIDashArray::read is geared towards happy path: a list of zeros is a solid line
    expect(read('0 0').values).toEqual([]);
    expect(read('0 0').getValue()).toBe('none');
  });
});

describe('SPIPaint', () => {
  it('reads, writes and clears', () => {
    const paint = new SPIPaint(SPAttr.INVALID);
    expect(paint.getValue()).toBe('');
    paint.read('red');
    expect(paint.getValue()).toBe('red');
    paint.clear();
    expect(paint.getValue()).toBe('');
  });

  it('keeps the url and the fallback color', () => {
    // A style needs an object or a document to hold the reference.
    const doc = SPDocument.createNewDocFromMem('<svg xmlns="http://www.w3.org/2000/svg"/>')!;
    const style = new SPStyle(doc);
    style.fill.read('url( "#grad" )  rgb(255, 0, 0)');
    expect(style.fill.set).toBe(true);
    expect(style.fill.href?.getURI()).toBe('#grad');
    expect(style.fill.href?.getObject()).toBeNull();
    expect(style.fill.getValue()).toBe('url(#grad) #ff0000');
    expect(style.fill.isPaintserver()).toBe(false);
    expect(style.fill.isColor()).toBe(true);
    style.fill.read('url(#grad) none');
    expect(style.fill.getValue()).toBe('none');
  });

  it('has black as default fill and no default stroke', () => {
    const style = new SPStyle();
    expect(style.fill.getColor().getValues()).toEqual([0, 0, 0, 1]);
    expect(style.fill.isColor()).toBe(true);
    expect(style.stroke.isNone()).toBe(true);
  });

  it('follows currentColor and color on cascade', () => {
    const parent = new SPStyle();
    parent.mergeString('color:blue;fill:currentColor');
    parent.cascade(new SPStyle()); // updates the color of the paint
    const child = new SPStyle();
    child.mergeString('color:green');
    child.cascade(parent);
    expect(child.fill.getValue()).toBe('blue');
    expect(parent.fill.getValue()).toBe('currentColor');
  });

  it('reads the context paints', () => {
    const style = new SPStyle();
    style.mergeString('fill:context-stroke;stroke:context-fill');
    expect(style.write()).toBe('fill:context-stroke;stroke:context-fill');
    expect(style.fill.isContext()).toBe(true);
  });
});

describe('SPIColorInterpolation', () => {
  it('reads the standard color spaces', () => {
    const ci = new SPIColorInterpolation(SPAttr.COLOR_INTERPOLATION);
    ci.read('sRGB');
    expect(ci.getInterpolationSpace()?.getSvgName()).toBe('sRGB');
    ci.read('linearRGB');
    expect(ci.getInterpolationSpace()?.getSvgName()).toBe('linearRGB');
    expect(ci.getValue()).toBe('linearRGB');
  });
});

describe('SPIEnum', () => {
  it('reads the numeric font weights', () => {
    const w = new SPIEnumFontWeight(SPAttr.FONT_WEIGHT, SPCSSFontWeight.SP_CSS_FONT_WEIGHT_NORMAL);
    w.read('450');
    expect(w.getValue()).toBe('450');
    w.clear();
    w.read('1001');
    expect(w.set).toBe(false);
    w.read('bold');
    expect(w.computed).toBe(SPCSSFontWeight.SP_CSS_FONT_WEIGHT_700);
  });
});

describe('SPIString', () => {
  it('quotes the font family', () => {
    const s = new SPIString(SPAttr.FONT_FAMILY);
    s.read('\'Times New Roman\', Arial, "Foo"');
    expect(s.value()).toBe('Times New Roman, Arial, Foo');
    expect(s.getValue()).toBe("'Times New Roman', Arial, Foo");
  });
});

describe('SPIPaintOrder', () => {
  it('fills up the layers in the default order', () => {
    const p = new SPIPaintOrder(SPAttr.PAINT_ORDER);
    p.read('markers');
    expect(p.get_layers()).toEqual([3, 1, 2]);
    expect(p.getValue()).toBe('markers');
  });
});

describe('extractUri', () => {
  it('extracts the uri of an url()', () => {
    expect(extractUri('url(#a)')).toEqual({ uri: '#a', end: 7 });
    expect(extractUri("url( '#a' ) red")).toEqual({ uri: '#a', end: 11 });
    expect(extractUri('url(#a ) x').uri).toBe('#a');
    expect(extractUri('url(#a')).toEqual({ uri: '', end: null });
    expect(extractUri('red')).toEqual({ uri: '', end: 0 });
  });
});

describe('formatClassic', () => {
  it('formats like a C++ stream', () => {
    expect(formatClassic(4)).toBe('4');
    expect(formatClassic(0.5)).toBe('0.5');
    expect(formatClassic(1.23456789)).toBe('1.23457');
    expect(formatClassic(1234567)).toBe('1.23457e+06');
    expect(formatClassic(0.00001)).toBe('1e-05');
    expect(formatClassic(-2.5)).toBe('-2.5');
    expect(formatClassic(100000)).toBe('100000');
  });
});
