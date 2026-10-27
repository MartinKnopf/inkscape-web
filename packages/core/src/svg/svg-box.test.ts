// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/svg-box-test.cpp
import { describe, expect, it } from 'vitest';
import { BoxSide, SVGBox } from './svg-box.ts';

const unit = { x: 1, y: 1 };

describe('SVGBox.read', () => {
  it.each([
    ['0', [0, 0, 0, 0]],
    ['1', [1, 1, 1, 1]],
    ['1 2 3 4', [1, 2, 3, 4]],
    ['1,2,3,4', [1, 2, 3, 4]],
    ['2cm 4cm', [76, 151, 76, 151]],
  ])('reads %j', (str, [top, right, bottom, left]) => {
    const box = new SVGBox();
    expect(box.read(str as string, unit)).toBe(true);
    expect(box.isSet()).toBe(true);
    expect([top, right, bottom, left]).toEqual(
      [box.top(), box.right(), box.bottom(), box.left()].map((l) => Math.round(l.computed)),
    );
  });

  it.each(['', 'a b c d', '12miles', '14mmm'])('rejects %j', (str) => {
    expect(new SVGBox().read(str, unit)).toBe(false);
  });
});

describe('SVGBox.write', () => {
  it.each([
    ['0', '0'],
    ['1', '1'],
    ['1 1 1 1', '1'],
    ['1cm', '37.79527559'],
    ['4cm 2in', '151.1811024 192'],
    ['7 2 4cm', '7 2 151.1811024'],
    ['1,2,3', '1 2 3'],
  ])('writes %j as %j', (input, expected) => {
    const box = new SVGBox();
    expect(box.read(input, unit)).toBe(true);
    expect(box.write()).toBe(expected);
  });
});

describe('SVGBox.set', () => {
  it.each([
    [[1], '1'],
    [[1, 2], '1 2'],
    [[1, 2, 3], '1 2 3'],
    [[1, 2, 3, 4], '1 2 3 4'],
  ] as const)('set(%j) writes %j', (args, expected) => {
    const box = new SVGBox();
    box.set(...(args as unknown as [number]));
    expect(box.write()).toBe(expected);
  });

  it('confine sets the sides that share the length', () => {
    const box = new SVGBox();
    box.set(10, 20, 10, 20);
    expect(box.write()).toBe('10 20');
    box.setSide(BoxSide.TOP, 5, true);
    expect(box.write()).toBe('5 20');
    box.setSide(BoxSide.LEFT, 10, true);
    expect(box.write()).toBe('5 10');
    box.setSide(BoxSide.LEFT, 5, true);
    expect(box.write()).toBe('5');
    box.setSide(BoxSide.BOTTOM, 7, true);
    expect(box.write()).toBe('7');
  });

  it('is built from a rectangle as top, right, bottom, left', () => {
    const box = new SVGBox({ x0: 4, y0: 1, x1: 2, y1: 3 });
    expect([
      box.get(BoxSide.TOP),
      box.get(BoxSide.RIGHT),
      box.get(BoxSide.BOTTOM),
      box.get(BoxSide.LEFT),
    ]).toEqual([1, 2, 3, 4]);
    expect(new SVGBox(null).isSet()).toBe(false);
  });
});

describe('SVGBox user input', () => {
  it('converts between display units and px with the document scale per axis', () => {
    const box = new SVGBox();
    expect(box.fromString('10mm 5', 'mm', { x: 5, y: 5 })).toBe(true);
    expect(box.toString('mm', { x: 5, y: 5 })).toBe('10mm 5mm');
    // mm to px (internal conversion) plus scale
    expect(box.write()).toBe('7.559055118 3.779527559');
  });

  it('uses the x scale for left and right and the y scale for top and bottom', () => {
    const box = new SVGBox();
    box.fromString('1 2 3 4', '', { x: 2, y: 10 });
    expect(box.write()).toBe('1 2 3 4');
    expect(box.toString('px', { x: 2, y: 10 }, undefined, false)).toBe('10 4 30 8');
  });

  it('isZero is true for a set box of zeros only', () => {
    const box = new SVGBox();
    expect(box.isZero()).toBe(false);
    box.set(0);
    expect(box.isZero()).toBe(true);
    box.set(0, 1);
    expect(box.isZero()).toBe(false);
  });

  it('update computes relative units per axis', () => {
    const box = new SVGBox();
    box.read('10% 20%', unit);
    box.update(16, 8, 200, 100);
    expect([box.get(BoxSide.TOP), box.get(BoxSide.RIGHT)]).toEqual([10, 40]);
  });
});
