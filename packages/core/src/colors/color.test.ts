// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/color-test.cpp
import { describe, expect, it } from 'vitest';
import { Color } from './color.ts';
import { Manager } from './manager.ts';
import { SpaceType as T } from './spaces/enum.ts';
import { expectClose, expectNear } from './spaces/testbase.ts';

const parse = (s: string): Color => Color.parse(s)!;

describe('Color', () => {
  it('is constructed from a space or its type', () => {
    expect(new Color(Manager.get().find(T.HSL)!, [0, 1, 0.5]).toString()).toBe('hsl(0, 100%, 50%)');
    expect(new Color(T.HSL, [0, 1, 0.5]).toString()).toBe('hsl(0, 100%, 50%)');
    expect(() => new Color(T.HSL, [0, 1])).toThrow();
  });

  it('is constructed from a packed number', () => {
    expect(new Color(0xff00ff00, false).toString()).toBe('#ff00ff');
    expect(new Color(0xff00ff00, true).toString()).toBe('#ff00ff00');
  });

  it('is copied', () => {
    const other = parse('red').clone();
    expect(other.toString()).toBe('red');
  });

  it('parses', () => {
    expect(Color.parse('red')).toBeDefined();
    expect(Color.parse('none')).toBeUndefined();
    expect(Color.parse(null)).toBeUndefined();
  });

  it('sets', () => {
    let color = parse('green');
    expect(color.toString()).toBe('green');
    expect(color.set(new Color(0x0000ffff), true)).toBe(true);
    expect(color.toString()).toBe('blue');
    expect(color.set(new Color(0x0000ffff, false), false)).toBe(true);
    expect(color.toString()).toBe('#0000ff');
    expect(color.set(1, 1.0)).toBe(true);
    expect(color.set(1, 1.0)).toBe(false);
    expect(color.toString()).toBe('#00ffff');
    expect(color.set('red', true)).toBe(true);
    expect(color.set('red', true)).toBe(false);
    expect(color.toString()).toBe('#ff0000');
    expect(color.set('red', false)).toBe(true);
    expect(color.set('red', false)).toBe(false);
    expect(color.toString()).toBe('red');
    expect(color.set(0x0, false)).toBe(true);
    expect(color.set(0x0, false)).toBe(false);
    expect(color.toString()).toBe('#000000');
    expect(color.set(0x00ff00ff, true)).toBe(true);
    expect(color.toString()).toBe('#00ff00ff');
    expect(color.set(0x00ff00, false)).toBe(true);
    expect(color.toString()).toBe('#0000ff');
    color.setValues([0.2, 1.0, 0.5]);
    expect(color.toString()).toBe('#33ff80');
    color = parse('purple');
    expect(color.set('not a color')).toBe(false);
    expect(color.toString()).toBe('purple');
  });

  it('compares', () => {
    expect(parse('red').equals(parse('red'))).toBe(true);
    expect(parse('green').equals(new Color(0xff0000))).toBe(false);
  });

  it('has a space and values', () => {
    const color = parse('red');
    expect(color.getSpace().getName()).toBe('CSSNAME');
    expectNear(color.getValues(), [1, 0, 0], 0.01);
  });

  it('has an opacity', () => {
    const color = parse('red');
    expect(color.hasOpacity()).toBe(false);
    expect(color.converted(T.HSL)!.hasOpacity()).toBe(false);
    expect(color.setOpacity(1.0)).toBe(true);
    expect(color.setOpacity(1.0)).toBe(false);
    expect(color.addOpacity(1.0)).toBe(false);
    expect(color.hasOpacity()).toBe(true);
    expect(color.getOpacity()).toBe(1.0);
    expect(color.toString()).toBe('#ff0000ff');
    expect(color.setOpacity(0.5)).toBe(true);
    expect(color.setOpacity(0.5)).toBe(false);
    expect(color.toString()).toBe('#ff000080');
    expect(color.addOpacity(0.5)).toBe(true);
    expect(color.getOpacity()).toBe(0.25);
    expect(color.toString()).toBe('#ff000040');
    color.enableOpacity(false);
    expect(color.hasOpacity()).toBe(false);
    expect(color.toString()).toBe('red');
    expect(color.addOpacity(0.5)).toBe(true);
    expect(color.getOpacity()).toBe(0.5);
    expect(color.stealOpacity()).toBe(0.5);
    expect(color.hasOpacity()).toBe(false);
    const copy = color.withOpacity(0.5);
    expect(copy.hasOpacity()).toBe(true);
    expect(color.hasOpacity()).toBe(false);
    expect(copy.toString()).toBe('#ff000080');
    expect(copy.withOpacity(0.5).toString()).toBe('#ff000040');
  });

  it('has an opacity channel and pins', () => {
    const color = parse('red');
    expect(color.getOpacityChannel()).toBe(3);
    expect(color.getPin(3)).toBe(8);
    color.convert(T.CMYK);
    expect(color.getOpacityChannel()).toBe(4);
    expect(color.getPin(4)).toBe(16);
  });

  it('has a difference', () => {
    const color = parse('green');
    expectClose(color.difference(parse('red')), 1.251, 0.001);
    expectClose(color.difference(parse('blue')), 1.251, 0.001);
    expectClose(color.difference(parse('black')), 0.251, 0.001);
  });

  it('is similar and close', () => {
    const oneHexAway = 0.004;
    const c1 = new Color(0xff0000ff, false);
    let c2 = new Color(0x0000ffff, false);
    expect(c1.isClose(c2)).toBe(false);
    expect(c1.isSimilar(c2)).toBe(false);
    expect(c1.isClose(c1)).toBe(true);
    expect(c1.isSimilar(c1)).toBe(true);
    c2 = parse('red');
    expect(c1.isClose(c2)).toBe(false);
    expect(c1.isSimilar(c2)).toBe(true);
    c2 = new Color(0xfe0101ff, false);
    expect(c1.isClose(c2, oneHexAway)).toBe(true);
    expect(c1.isSimilar(c2, oneHexAway)).toBe(true);
    c2 = new Color(0xfe0102ff, false);
    expect(c1.isClose(c2, oneHexAway)).toBe(false);
    expect(c1.isSimilar(c2, oneHexAway)).toBe(false);
  });

  it('converts to the space of another color', () => {
    const other = parse('red');
    const color = parse('hsl(120, 100, 25.1)');
    color.convert(other);
    expect(color.toString()).toBe('green');
    other.addOpacity();
    color.convert(other);
    expect(color.toString()).toBe('#008000ff');
    expect(parse('hsl(120, 100, 25.1)').converted(other)!.toString()).toBe('#008000ff');
  });

  it('converts to a space or space type', () => {
    const color = new Color(0xff0000ff, false);
    color.convert(Manager.get().find(T.HSL)!);
    expect(color.toString()).toBe('hsl(0, 100%, 50%)');
    const other = new Color(0xff0000ff, false);
    expect(other.convert(T.HSL)).toBe(true);
    expect(other.toString()).toBe('hsl(0, 100%, 50%)');
    expect(other.convert(T.NONE)).toBe(false);
    expect(other.toString()).toBe('hsl(0, 100%, 50%)');
    expect(parse('red').converted(T.HSL)!.toString()).toBe('hsl(0, 100%, 50%)');
    expect(parse('red').converted(T.NONE)).toBeUndefined();
  });

  it('prints', () => {
    expect(parse('red').toString()).toBe('red');
    expect(parse('#ff0').toString()).toBe('#ffff00');
    expect(parse('rgb(80 90 255 / 0.5)').toString(true)).toBe('#505aff80');
    expect(parse('rgb(80 90 255 / 0.5)').toString(false)).toBe('#505aff');
  });

  it('converts to packed numbers', () => {
    expect(new Color(0x123456cc).toRGBA(1.0)).toBe(0x123456cc);
    expect(new Color(0x123456cc).toRGBA(0.5)).toBe(0x12345666);
    expect(new Color(0xfffffffe).toRGBA()).toBe(0xfffffffe);
    expect(new Color(0x123456cc).toARGB(1.0)).toBe(0xcc123456);
    expect(new Color(0x123456cc).toARGB(0.5)).toBe(0x66123456);
    expect(new Color(0x123456cc).toABGR(1.0)).toBe(0xcc563412);
    expect(new Color(0x123456cc).toABGR(0.5)).toBe(0x66563412);
  });

  it('has a name that conversion resets', () => {
    const color = parse('red');
    expect(color.getName()).toBe('');
    color.setName('Rouge');
    expect(color.getName()).toBe('Rouge');
    color.convert(T.HSL);
    expect(color.getName()).toBe('');
  });

  it('normalizes', () => {
    const color = parse('rgb(0, 0, 0)');
    color.set(0, 2.0);
    expect(color.get(0)).toBe(2.0);
    color.set(1, 1.0);
    color.set(2, -0.5);
    color.normalize();
    expect([color.get(0), color.get(1), color.get(2)]).toEqual([1, 1, 0]);
    color.convert(T.HSL);
    color.set(0, 4.1);
    color.normalize();
    expectClose(color.get(0), 0.1, 0.001);
    color.set(0, -0.2);
    color.normalize();
    expectClose(color.get(0), 0.8, 0.001);
    color.set(0, -2.2);
    color.normalize();
    expectClose(color.get(0), 0.8, 0.001);
    color.setOpacity(4.2);
    const copy = color.normalized();
    expectClose(color.get(3), 4.2, 0.001);
    expectClose(copy.get(3), 1.0, 0.001);
  });

  it('inverts', () => {
    let color = parse('red');
    color.invert();
    expect(color.toString()).toBe('aqua');
    color.invert();
    expect(color.toString()).toBe('red');
    color = parse('hsl(90,50,10)');
    color.invert();
    expect(color.toString()).toBe('hsl(270, 50%, 90%)');
    color.invert(2);
    expect(color.toString()).toBe('hsl(90, 50%, 10%)');
    color = parse('rgb(255 255 255 0.2)');
    expectClose(color.get(0), 1, 0.001);
    color.invert();
    expectClose(color.get(0), 0, 0.001);
    expectClose(color.get(3), 0.2, 0.001);
    color.invert(0);
    expectClose(color.get(0), 1, 0.001);
    expectClose(color.get(3), 0.8, 0.001);
  });

  it('jitters, except pinned channels', () => {
    const color = parse('gray');
    color.jitter(0.1, 0xff);
    expect(color.toString()).toBe('gray');
    color.jitter(0.5);
    expect(color.toString()).not.toBe('gray');
    color.setOpacity(0.5);
    color.jitter(0.5, color.getPin(color.getOpacityChannel()));
    expect(color.getOpacity()).toBe(0.5);
  });

  it('composes', () => {
    const c1 = parse('#ff0000');
    const c2 = parse('#0000ff');
    expect(c1.composed(c2).toString()).toBe('#0000ffff');
    expect(c2.composed(c1).toString()).toBe('#ff0000ff');
    c1.setOpacity(0.5);
    expect(c1.composed(c2).toString()).toBe('#0000ffff');
    expect(c2.composed(c1).toString()).toBe('#800080ff');
    c2.setOpacity(0.5);
    expect(c1.composed(c2).toString()).toBe('#800080bf');
    expect(c2.composed(c1).toString()).toBe('#800080bf');
  });

  it('averages', () => {
    let c1 = parse('#ff0000');
    const c2 = parse('#0000ff');
    expect(c1.averaged(c2).toString()).toBe('#800080');
    expect(c2.averaged(c1).toString()).toBe('#800080');
    c1.setOpacity(0.5);
    expect(c1.averaged(c2, 0.25).toString()).toBe('#bf00409f');
    c1.enableOpacity(false);
    c2.setOpacity(0.5);
    expect(c1.averaged(c2, 0.75).toString()).toBe('#4000bf');
    c1 = new Color(0x0);
    c1.average(new Color(0xffffffff), 0.25, 1);
    expect(c1.toString()).toBe('#00404040');
    c1 = new Color(0x0);
    c1.average(new Color(0xffffffff), 0.25, 2);
    expect(c1.toString()).toBe('#40004040');
    c1 = new Color(0x0);
    c1.average(new Color(0xffffffff), 0.25, 4 + 2);
    expect(c1.toString()).toBe('#40000040');
    c1 = new Color(0x0);
    c1.average(new Color(0xffffffff), 0.25, c1.getPin(3));
    expect(c1.toString()).toBe('#40404000');
    const c3 = new Color(0x1a1a1a1a);
    c3.average(new Color(0xffffffff), 0.2, 2);
    expect(c3.toString()).toBe('#481a4848');
    c3.average(new Color(0xffffffff), 0.3, 4 + 2);
    expect(c3.toString()).toBe('#7f1a487f');
    c3.average(new Color(0xffffffff), 0.5, c3.getPin(3));
    expect(c3.toString()).toBe('#bf8da37f');
    c1 = new Color(0x00000000);
    c1.average(new Color(0xffffffff), 0.1, 0);
    expectClose(c1.get(0), 0.1, 0.001);
    expect(c1.toString()).toBe('#1a1a1a1a');
  });

  it('checks the gamut and over-inking', () => {
    const lab = Manager.get().find(T.LAB)!;
    const rgb = Manager.get().find(T.RGB)!;
    expect(new Color(T.LAB, [0.6, 0.99, 0.5]).isOutOfGamut(rgb)).toBe(true);
    expect(new Color(T.LAB, [0.6, 0.5, 0.5]).isOutOfGamut(rgb)).toBe(false);
    expect(new Color(0xff0000ff).isOutOfGamut(lab)).toBe(false);
    expect(new Color(T.CMYK, [0.1, 0.1, 0.1, 0.1]).isOverInked()).toBe(false);
  });
});
