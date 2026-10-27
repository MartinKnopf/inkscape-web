// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/parser-test.cpp
import { describe, expect, it } from 'vitest';
import './manager.ts';
import { HexParser, Parser, Parsers, StringStream } from './parser.ts';
import { SpaceType as T } from './spaces/enum.ts';
import { expectNear } from './spaces/testbase.ts';

describe('Parser', () => {
  it('parses prefixes', () => {
    const tests = new StringStream('#rgb(hsl( color( srgb icc-color(profile');
    expect(Parser.getCssPrefix(tests)).toBe('#');
    expect(Parser.getCssPrefix(tests)).toBe('rgb');
    expect(Parser.getCssPrefix(tests)).toBe('hsl');
    expect(Parser.getCssPrefix(tests)).toBe('srgb');
    expect(Parser.getCssPrefix(tests)).toBe('icc-color');
    expect(Parser.getCssPrefix(new StringStream('rgb fail'))).toBe('');
  });

  it('parses numbers', () => {
    const tests = new StringStream('1.2 .2 5turn 120deg 20%,5,5, 2cm ,4 9000) 0.0002 5t) 42  )  ');
    const check = (value: number, unit: string, end = false) => {
      const n = Parser.css_number(tests, ',');
      expect(n).toBeDefined();
      expect(n!.value).toBeCloseTo(value, 3);
      expect(n!.unit).toBe(unit);
      expect(n!.end).toBe(end);
    };
    check(1.2, '');
    check(0.2, '');
    check(5, 'turn');
    check(120, 'deg');
    check(20, '%');
    check(5, '');
    check(5, '');
    check(2, 'cm');
    check(4, '');
    check(9000, '', true);
    check(0.0002, '');
    check(5, 't', true);
    check(42, '', true);
  });

  it('parses css values with their units', () => {
    const parseValues = (input: string) => {
      const ss = new StringStream(input);
      const output: number[] = [];
      const state = { end: false };
      Parser.append_css_value(ss, output, state, ',', 2) && // Value 1
        Parser.append_css_value(ss, output, state, ',', 3) && // Value 2
        Parser.append_css_value(ss, output, state, ',', 0.1) && // Value 3
        Parser.append_css_value(ss, output, state, '/', 5) && // Value 4
        Parser.append_css_value(ss, output, state); // Opacity
      return { output, end: state.end };
    };
    let r = parseValues('2.0 200% .3, 20  / 5.0)');
    expect(r.end).toBe(true);
    expectNear(r.output, [1, 2, 3, 4, 5], 0.001);
    // The opacity is optional
    r = parseValues('2.0 200% .3, 20)');
    expect(r.end).toBe(true);
    expectNear(r.output, [1, 2, 3, 4], 0.001);
    r = parseValues('360deg 3turn .3, 20)');
    expect(r.end).toBe(true);
    expectNear(r.output, [1, 3, 3, 4], 0.001);
  });

  it('rejects unknown units', () => {
    const output: number[] = [];
    expect(Parser.append_css_value(new StringStream('5px)'), output, { end: false })).toBe(false);
    expect(output).toEqual([]);
  });

  it('parses hex and finds an icc-color after it', () => {
    const parser = new HexParser();
    expect(parser.getPrefix()).toBe('#');
    const more = { more: false };
    const output: number[] = [];
    expect(parser.parseColor(new StringStream('000001 icc-profile(foo'), output, more)).toBe('');
    expect(more.more).toBe(true);
    expect(output.length).toBe(3);
  });

  it('parses a color', () => {
    const parsed = Parsers.get().parse('rgb(128, 255, 255)')!;
    expect(parsed.type).toBe(T.RGB);
    expect(parsed.cms).toBe('');
    expect(parsed.fallback).toEqual([]);
    expectNear(parsed.values, [0.5, 1.0, 1.0], 0.01);
  });

  it('keeps the icc-color name, values and fallback color', () => {
    const parsed = Parsers.get().parse('#ff0000 icc-color(Some-Profile, 0.1, 0.5, 1)')!;
    expect(parsed.type).toBe(T.CMS);
    expect(parsed.cms).toBe('Some-Profile');
    expectNear(parsed.values, [0.1, 0.5, 1], 1e-9);
    expectNear(parsed.fallback, [1, 0, 0], 1e-9);
  });
});
