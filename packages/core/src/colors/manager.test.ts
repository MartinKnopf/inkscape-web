// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/manager-test.cpp
import { describe, expect, it } from 'vitest';
import { ColorError } from './forward.ts';
import { Manager } from './manager.ts';
import { Traits } from './spaces/components.ts';
import { SpaceType as T } from './spaces/enum.ts';
import { RGB } from './spaces/rgb.ts';

describe('Manager', () => {
  it('has space components', () => {
    const cm = Manager.get();
    let comp = cm.find(T.RGB)!.getComponents();
    expect(comp.size).toBe(3);
    expect(comp.getAll().map((c) => c.name)).toEqual(['_R', '_G', '_B']);
    comp = cm.find(T.HSL)!.getComponents(true);
    expect(comp.getAll().map((c) => c.name)).toEqual(['_H', '_S', '_L', '_A']);
    comp = cm.find(T.CMYK)!.getComponents(false);
    expect(comp.getAll().map((c) => c.name)).toEqual(['_C', '_M', '_Y', '_K']);
  });

  it('knows which spaces are unbounded', () => {
    const cm = Manager.get();
    for (const type of [T.RGB, T.HSL, T.CMYK]) expect(cm.find(type)!.isUnbounded()).toBe(false);
    for (const type of [T.XYZ, T.LAB, T.OKLAB]) expect(cm.find(type)!.isUnbounded()).toBe(true);
  });

  it('finds spaces by name', () => {
    expect(Manager.get().find('HSL')!.getType()).toBe(T.HSL);
    expect(Manager.get().find('hsl')).toBeUndefined();
  });

  it('gets spaces by traits', () => {
    const cm = Manager.get();
    expect(cm.spaces(Traits.None).length).toBe(0);
    const internal = cm.spaces(Traits.Internal);
    expect(internal.length).toBeGreaterThan(0);
    expect(internal[0]!.getComponents().traits() & Traits.Internal).toBe(Traits.Internal);
    const pickers = cm.spaces(Traits.Picker);
    expect(pickers.length).toBeGreaterThan(0);
    expect(cm.spaces(Traits.Picker | Traits.Internal).length).toBe(internal.length + pickers.length);
  });

  it('adds and removes spaces', () => {
    const cm = Manager.get();
    const rgb = cm.find(T.RGB)!;
    expect(() => cm.addSpace(rgb)).toThrow(ColorError);
    expect(cm.removeSpace(rgb)).toBe(true);
    expect(cm.removeSpace(rgb)).toBe(false);
    expect(cm.find(T.RGB)).toBeUndefined();
    expect(cm.findSvgColorSpace('sRGB')).toBeUndefined();
    cm.addSpace(rgb);
    expect(cm.find(T.RGB)).toBe(rgb);
    expect(new RGB().getName()).toBe('RGB');
  });

  it('finds the space of an svg name', () => {
    const find = (name: string) => Manager.get().findSvgColorSpace(name)?.getName();
    // SVG 2.0 specification interpolations
    expect(find('sRGB')).toBe('RGB');
    expect(find('linearRGB')).toBe('linearRGB');
    // CSS Color Module 4 interpolations
    expect(find('srgb')).toBe('RGB');
    expect(find('srgb-linear')).toBe('linearRGB');
    for (const name of ['display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020'])
      expect(find(name)).toBeUndefined();
    expect(find('lab')).toBe('Lab');
    expect(find('oklab')).toBe('OkLab');
    expect(find('xyz')).toBe('XYZ');
    expect(find('xyz-d50')).toBe('XYZ D50');
    expect(find('xyz-d65')).toBe('XYZ');
    // CSS Color Module 4 Polar
    expect(find('hsl')).toBe('HSL');
    expect(find('hwb')).toBeUndefined();
    expect(find('lch')).toBe('Lch');
    expect(find('oklch')).toBe('OkLch');
    // Extra values for other interpolations not in SVG spec
    expect(find('device-cmyk')).toBe('DeviceCMYK');
    // Things we want to protect against
    for (const name of ['', 'rgb', 'cmyk', 'icc-color', 'auto']) expect(find(name)).toBeUndefined();
  });

  it('prints the svg name of a space', () => {
    const name = (type: T) => Manager.get().find(type)!.getSvgName();
    expect(name(T.RGB)).toBe('sRGB');
    expect(name(T.linearRGB)).toBe('linearRGB');
    expect(name(T.XYZ)).toBe('xyz-d65');
    expect(name(T.XYZ50)).toBe('xyz-d50');
    expect(name(T.CMYK)).toBe('device-cmyk');
  });
});
