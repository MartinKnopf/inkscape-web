// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/spaces-rgb-test.cpp
import { describe, expect, it } from 'vitest';
import { Manager } from '../manager.ts';
import { ProfileSpace } from './base.ts';
import { SpaceType as T } from './enum.ts';
import {
  badColorStringTests,
  componentIds,
  convertTests,
  fromStringTests,
  normalizeTests,
  randomPassthrough,
  toStringTests,
} from './testbase.ts';

describe('RGB', () => {
  fromStringTests([
    ['#f0f', [1, 0, 1], 0xff00ffff],
    ['#FFC', [1, 1, 0.8], 0xffffccff],
    ['#0F3c', [0, 1, 0.2, 0.8], 0x00ff33cc],
    ['#5533Cc', [0.333, 0.2, 0.8], 0x5533ccff],
    ['#5533Cc66', [0.333, 0.2, 0.8, 0.4], 0x5533cc66],
    ['   #55Cc42  ', [0.333, 0.8, 0.258], 0x55cc42ff],
    ['rgb(100%, 50%, 1)', [1.0, 0.5, 0.004], 0xff8001ff],
    ['rgb(100% 50% 51)', [1.0, 0.5, 0.2], 0xff8033ff],
    ['rgb(100% ,50% , 51   )', [1.0, 0.5, 0.2], 0xff8033ff],
    ['rgb(100% 50% 102 / 50%)', [1.0, 0.5, 0.4, 0.5], 0xff806680],
    ['   rgb(128, 128, 128)', [0.501, 0.501, 0.501], 0x808080ff],
    ['rgba(255, 255, 128,   0.5) ', [1.0, 1.0, 0.501, 0.5], 0xffff8080],
    ['RGBA(255, 255, 128,   0.5) ', [1.0, 1.0, 0.501, 0.5], 0xffff8080],
    ['rgba(255  255  128)', [1.0, 1.0, 0.501], 0xffff80ff],
    ['color(srgb 1 0.5 0.4 / 50%)', [1.0, 0.5, 0.4, 0.5], 0xff806680],
    ['color(sRGb 1 0.5 0.4 / 50%)', [1.0, 0.5, 0.4, 0.5], 0xff806680],
  ]);

  badColorStringTests([
    '',
    '#',
    '#1',
    '#12',
    'rgb',
    'rgb(',
    'rgb(255,',
    'rgb(1 2 3',
    'rgb(1 2 3 / 4',
    'rgba(1 2 3',
    'color(srgb 3',
  ]);

  toStringTests([
    [T.RGB, [0.333, 0.2, 0.8], '#5533cc'],
    [T.RGB, [0.333, 0.8, 0.258], '#55cc42'],
    [T.RGB, [1.0, 0.5, 0.004], '#ff8001'],
    [T.RGB, [0, 1, 0.2, 0.8], '#00ff33cc'],
  ]);

  convertTests([
    [T.RGB, [1.0, 0.0, 0.0], T.RGB, [1.0, 0.0, 0.0], false],
    [T.RGB, [1.0, 0.0, 0.0, 0.5], T.RGB, [1.0, 0.0, 0.0, 0.5], false],
    // All other tests are in their respective color space test, for example hsl.test.ts
    [T.RGB, [1.0, 0.0, 0.0], T.HSL, [0.0, 1.0, 0.5]],
    [T.RGB, [1.0, 0.0, 0.0, 0.5], T.HSL, [0.0, 1.0, 0.5, 0.5]],
  ]);

  normalizeTests([
    [T.RGB, [0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
    [T.RGB, [1.2, 1.2, 1.2, 1.2], [1.0, 1.0, 1.0, 1.0]],
    [T.RGB, [-0.2, -0.2, -0.2, -0.2], [0.0, 0.0, 0.0, 0.0]],
  ]);

  it('converts to itself', () => randomPassthrough(T.RGB, T.RGB, 1));

  it('has components', () => {
    expect(componentIds(T.RGB)).toEqual(['r', 'g', 'b']);
    const c = Manager.get().find(T.RGB)!.getComponents(true);
    expect(c.size).toBe(4);
    expect(c.at(3).id).toBe('alpha');
    expect(c.at(3).index).toBe(3);
  });

  it('is a direct profile space', () => {
    expect(Manager.get().find(T.RGB)).toBeInstanceOf(ProfileSpace);
    expect((Manager.get().find(T.RGB) as ProfileSpace).isDirect()).toBe(true);
    expect((Manager.get().find(T.HSL) as ProfileSpace).isDirect()).toBe(false);
  });
});
