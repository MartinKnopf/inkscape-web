// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/svg-length-test.cpp
import { describe, expect, it } from 'vitest';
import {
  refXNamedToPercent,
  refYNamedToPercent,
  SVGLength,
  SVGLengthUnit,
  spSvgLengthListRead,
  spSvgNumberReadD,
  spSvgNumberWriteDe,
  spSvgReadPercentage,
} from './svg-length.ts';

const { NONE, PX, PT, PC, MM, CM, INCH, EM, EX, PERCENT } = SVGLengthUnit;

const absoluteTests: [string, SVGLengthUnit, number, number][] = [
  ['0', NONE, 0, 0],
  ['  1  ', NONE, 1, 1],
  ['\t2\n', NONE, 2, 2],
  ['\n3    ', NONE, 3, 3],
  ['1', NONE, 1, 1],
  ['1.00001', NONE, 1.00001, 1.00001],
  ['1px', PX, 1, 1],
  ['.1', NONE, 0.1, 0.1],
  ['.1px', PX, 0.1, 0.1],
  ['1.', NONE, 1, 1],
  ['1.px', PX, 1, 1],
  ['100pt', PT, 100, 133.33333333333331],
  ['1e2pt', PT, 100, 133.33333333333331],
  ['3pc', PC, 3, 48],
  ['-3.5pc', PC, -3.5, -3.5 * 16.0],
  ['1.2345678mm', MM, 1.2345678, 4.666083023622048],
  ['123.45678cm', CM, 123.45678, 4666.083023622048],
  ['73.162987in', INCH, 73.162987, 7023.646752000001],
  ['1.2345678912', NONE, 1.2345678912, 1.2345678912],
];

const relativeTests: [string, SVGLengthUnit, number, number][] = [
  ['123em', EM, 123, 123 * 7],
  ['123ex', EX, 123, 123 * 13],
  ['123%', PERCENT, 1.23, 1.23 * 19],
];

const failSingleTests = [
  '123 px',
  '123e',
  '123e+m',
  '123ec',
  '123pxt',
  '--123',
  '',
  'px',
  '1,',
  '1.0,,,',
  'inf',
  '+inf',
  '-inf',
  'nan',
];

describe('SVGLength.read', () => {
  it.each(absoluteTests)('reads %j', (str, unit, value, computed) => {
    const len = new SVGLength();
    expect(len.read(str)).toBe(true);
    expect(len.unit).toBe(unit);
    expect(len.value).toBe(value);
    expect(len.computed).toBe(computed);
  });

  it.each(relativeTests)('reads %j and updates relative units', (str, unit, value, computed) => {
    const len = new SVGLength();
    expect(len.read(str)).toBe(true);
    len.update(7, 13, 19);
    expect(len.unit).toBe(unit);
    expect(len.value).toBe(value);
    expect(len.computed).toBe(computed);
  });

  it.each(failSingleTests)('rejects %j', (str) => {
    expect(new SVGLength().read(str)).toBe(false);
  });

  it('reads units without an SVG length unit (m) as NONE and does not convert them', () => {
    const len = new SVGLength();
    expect(len.read('2m')).toBe(true);
    expect(len.unit).toBe(NONE);
    expect([len.value, len.computed]).toEqual([2, 2]);
  });
});

describe('SVGLength.readOrUnset', () => {
  it.each(absoluteTests)('reads %j', (str, unit, value, computed) => {
    const len = new SVGLength();
    len.readOrUnset(str);
    expect([len.unit, len.value, len.computed]).toEqual([unit, value, computed]);
    expect(len.isSet()).toBe(true);
  });

  it.each(failSingleTests)('unsets to the given values for %j', (str) => {
    const len = new SVGLength();
    len.readOrUnset(str, INCH, 123, 456);
    expect([len.unit, len.value, len.computed]).toEqual([INCH, 123, 456]);
    expect(len.isSet()).toBe(false);
  });
});

describe('SVGLength.readAbsolute', () => {
  it.each(absoluteTests)('reads %j', (str, unit, value, computed) => {
    const len = new SVGLength();
    expect(len.readAbsolute(str)).toBe(true);
    expect([len.unit, len.value, len.computed]).toEqual([unit, value, computed]);
  });

  it.each(relativeTests)('rejects relative %j', (str) => {
    expect(new SVGLength().readAbsolute(str)).toBe(false);
  });

  it.each(failSingleTests)('rejects %j', (str) => {
    expect(new SVGLength().readAbsolute(str)).toBe(false);
  });
});

describe('SVGLength to and from string', () => {
  const scale = 96.0 / 25.4;

  it('converts user input and back', () => {
    const len = new SVGLength();
    expect(len.fromString('10', 'mm', scale)).toBe(true);
    expect(len.unit).toBe(NONE);
    expect(len.write()).toBe('10');
    expect(len.toString('mm', scale)).toBe('10mm');
    expect(len.toString('in', scale)).toBe('0.3937007874in');
    expect(len.toString('', scale)).toBe('37.79527559');
  });

  it('formats with a fixed number of digits and without the unit', () => {
    const len = new SVGLength();
    len.read('10mm');
    expect(len.toString('mm', 1, 3)).toBe('10mm');
    expect(len.toString('in', 1, 2)).toBe('0.39in');
    expect(len.toString('in', 1, 2, false)).toBe('0.39');
  });

  it('writes percentages as such', () => {
    const len = new SVGLength();
    len.read('50%');
    expect(len.write()).toBe('50%');
    expect(len.toString('mm', 3)).toBe('50%');
  });

  it('writes px without unit, other units with it', () => {
    const len = new SVGLength();
    len.read('12.5px');
    expect(len.write()).toBe('12.5');
    len.read('12.5pt');
    expect(len.write()).toBe('12.5pt');
  });
});

describe('SVGLength.equals', () => {
  it.each([
    ['', '', true],
    ['1', '1', true],
    ['10mm', '10mm', true],
    ['20mm', '10mm', false],
    ['10mm', '10', false],
  ])('%j == %j is %s', (a, b, equal) => {
    const lenA = new SVGLength();
    const lenB = new SVGLength();
    lenA.read(a);
    lenB.read(b);
    expect(lenA.equals(lenB)).toBe(equal);
  });
});

describe('SVGLength.set, unset, scale', () => {
  it('set computes px from the unit', () => {
    const len = new SVGLength();
    len.set(INCH, 2);
    expect([len.isSet(), len.computed]).toEqual([true, 192]);
  });

  it('unset from another length keeps its fields but is not set', () => {
    const a = new SVGLength();
    a.read('3cm');
    const b = new SVGLength();
    b.unset(a);
    expect([b.isSet(), b.unit, b.value, b.computed]).toEqual([false, CM, 3, a.computed]);
  });

  it('scale keeps the unit', () => {
    const len = new SVGLength();
    len.read('2in');
    len.scale(2);
    expect([len.unit, len.value, len.computed]).toEqual([INCH, 4, 384]);
  });

  it('isAbsolute is false for no unit and relative units', () => {
    const len = new SVGLength();
    const results = ['1', '1px', '1em', '1%'].map((s) => {
      len.read(s);
      return len.isAbsolute();
    });
    expect(results).toEqual([false, true, false, false]);
  });
});

describe('spSvgNumberWriteDe', () => {
  it.each([
    [761.92918978947023, 2, -8, '760'],
    [761.92918978947023, 4, -8, '761.9'],
    [0, 8, -8, '0'],
    [1e-9, 8, -8, '0'],
    [-0.5, 8, -8, '-0.5'],
    [1.5e-5, 4, -8, '1.5e-5'],
    [123456789, 3, -8, '1.23e8'],
    [123456, 6, -8, '123456'],
    [1e20, 8, -8, '1e20'],
  ])('%s with %s digits', (val, prec, minExp, expected) => {
    expect(spSvgNumberWriteDe(val, prec, minExp)).toBe(expected);
  });
});

describe('spSvgLengthListRead', () => {
  it('reads a list with units, commas and mixed white space', () => {
    const items = spSvgLengthListRead('56px \t-4in, 99.73738 9% 34.0em\n2e+2pt \n  3e-4px ');
    expect(items.map((i) => [i.unit, i.value])).toEqual([
      [PX, 56],
      [INCH, -4],
      [NONE, 99.73738],
      [PERCENT, 0.09],
      [EM, 34],
      [PT, 200],
      [PX, 0.0003],
    ]);
    expect(items[0]?.isSet()).toBe(true);
  });

  it.each(['1 2rm', '4 ,', '\n3\n,,, 2', '3 trees wave goodbye,'])(
    'stops at the first failure in %j',
    (str) => {
      expect(spSvgLengthListRead(str)).toHaveLength(1);
    },
  );
});

describe('number helpers', () => {
  it('spSvgNumberReadD', () => {
    expect(spSvgNumberReadD('1.5abc')).toBe(1.5);
    expect(spSvgNumberReadD('abc')).toBeNull();
    expect(spSvgNumberReadD(null)).toBeNull();
  });

  it('spSvgReadPercentage', () => {
    expect(spSvgReadPercentage('50%', 1)).toBe(0.5);
    expect(spSvgReadPercentage('0.25', 1)).toBe(0.25);
    expect(spSvgReadPercentage('3mm', 1)).toBe(1);
  });

  it('named refX and refY positions become percentages', () => {
    expect(refXNamedToPercent('left')).toBe('0%');
    expect(refXNamedToPercent('center')).toBe('50%');
    expect(refXNamedToPercent('top')).toBe('top');
    expect(refYNamedToPercent('bottom')).toBe('100%');
    expect(refYNamedToPercent(null)).toBeNull();
  });
});
