// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/printer-test.cpp
import { describe, expect, it } from 'vitest';
import { CssColorPrinter, CssFuncPrinter, CssLegacyPrinter, CssPrinter } from './printer.ts';

describe('CssPrinter', () => {
  it('prints with a separator', () => {
    const oo = new CssPrinter(3, 'prefix', '', ' ');
    oo.addInt(1).add(3.3).add(0.0);
    expect(oo.toString()).toBe('prefix(1 3.3 0)');
  });

  it('prints three digits and no negative zero', () => {
    const oo = new CssPrinter(4, 'prefix', '', ' ');
    oo.add(1.2).add(3.3).add(0.0234).add(-0.0001);
    expect(oo.toString()).toBe('prefix(1.2 3.3 0.023 0)');
  });

  it('prints legacy functions', () => {
    let oo = new CssLegacyPrinter(3, 'leg', false);
    oo.add(1.0).add(3.3).add(0.0);
    expect(oo.toString()).toBe('leg(1, 3.3, 0)');
    oo = new CssLegacyPrinter(3, 'leg', true);
    oo.add(1.2).add(3.3).add(0.0).add(0.5);
    expect(oo.toString()).toBe('lega(1.2, 3.3, 0, 0.5)');
  });

  it('prints functions with an opacity', () => {
    let oo = new CssFuncPrinter(4, 'func');
    oo.add(1.0).add(3.3).add(0.0).add(1.2);
    expect(oo.toString()).toBe('func(1 3.3 0 1.2)');
    oo = new CssFuncPrinter(4, 'func');
    oo.add(1.0).add(3.3).add(0.0).add(1.2).add(0.5);
    expect(oo.toString()).toBe('func(1 3.3 0 1.2 / 50%)');
  });

  it('prints color functions', () => {
    const oo = new CssColorPrinter(3, 'ident');
    oo.add(1.0).add(3.3).add(0.0).add(0.5);
    expect(oo.toString()).toBe('color(ident 1 3.3 0 / 50%)');
  });

  it('gives an empty string if numbers are missing', () => {
    const oo = new CssFuncPrinter(3, 'func');
    oo.add(1).add(2);
    expect(oo.toString()).toBe('');
  });
});
