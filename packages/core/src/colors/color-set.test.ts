// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/color-set-test.cpp
import { describe, expect, it } from 'vitest';
import type { Signal } from '../util/signal.ts';
import { Color } from './color.ts';
import { ColorSet } from './color-set.ts';
import { Manager } from './manager.ts';
import { SpaceType as T } from './spaces/enum.ts';
import { expectClose, expectNear } from './spaces/testbase.ts';

const parse = (s: string): Color => Color.parse(s)!;

/** The number of times the signal is emitted while running `thenRun`. */
function signalCount(signal: Signal<[]>, thenRun: () => void): number {
  let calls = 0;
  const disconnect = signal.connect(() => calls++);
  thenRun();
  disconnect();
  return calls;
}

describe('ColorSet', () => {
  it('sets colors by id', () => {
    const colors = new ColorSet();
    expect(colors.isEmpty()).toBe(true);
    expect(colors.getAlphaConstraint()).toBeUndefined();
    expect(colors.getSpaceConstraint()).toBeUndefined();
    colors.set('i1', parse('red'));
    colors.set('i2', parse('#ff0000'));
    expect(colors.isEmpty()).toBe(false);
    expect(colors.isSame()).toBe(false);
    colors.set('i3', parse('#0000ffff'));
    expect(colors.isSame()).toBe(false);
    expect(colors.get('i1')!.toString()).toBe('red');
    expect(colors.get('i2')!.toString()).toBe('#ff0000');
    expect(colors.get('i3')!.toString()).toBe('#0000ffff');
    expect(colors.size()).toBe(3);
    expect(colors.get('i4')).toBeUndefined();
    colors.set('i1', parse('green'));
    expect(colors.size()).toBe(3);
    expect(colors.get('i1')!.toString()).toBe('green');
  });

  it('sets a single color', () => {
    const color = new ColorSet();
    expect(color.get()).toBeUndefined();
    color.set(parse('red'));
    expect(color.isEmpty()).toBe(false);
    expect(color.size()).toBe(1);
    expect(color.get()!.toString()).toBe('red');
    expect(color.getAverage().toString()).toBe('#ff0000ff');
    color.set(parse('blue'));
    expect(color.size()).toBe(1);
    expect(color.get()!.toString()).toBe('blue');
    expect(color.getAverage().toString()).toBe('#0000ffff');
  });

  it('converts colors to the constraints', () => {
    const colors = new ColorSet(Manager.get().find(T.RGB), false);
    expect(colors.getSpaceConstraint()).toBeDefined();
    expect(colors.getAlphaConstraint()).toBe(false);
    colors.set('i1', parse('red'));
    colors.set('i2', parse('#ff000080'));
    expect(colors.isSame()).toBe(true);
    colors.set('i3', parse('#0000ffff'));
    expect(colors.isSame()).toBe(false);
    expect(colors.get('i1')!.toString()).toBe('#ff0000');
    expect(colors.get('i2')!.toString()).toBe('#ff0000');
    expect(colors.get('i3')!.toString()).toBe('#0000ff');

    const hsl = new ColorSet(Manager.get().find(T.HSL), true);
    hsl.set('i1', parse('red'));
    expect(hsl.get('i1')!.toString()).toBe('hsla(0, 100%, 50%, 1)');
  });

  it('sets all colors from another set', () => {
    const a = new ColorSet();
    a.set('i1', parse('red'));
    a.set('i2', parse('blue'));
    const b = new ColorSet();
    b.set('i1', parse('green'));
    b.set('i3', parse('purple'));
    expect(signalCount(b.signal_changed, () => b.setAll(a))).toBe(1);
    // No change to other object
    expect(a.size()).toBe(2);
    expect(a.get('i1')!.toString()).toBe('red');
    // Addative changes to B
    expect(b.size()).toBe(3);
    expect(b.get('i1')!.toString()).toBe('red');
    expect(b.get('i2')!.toString()).toBe('blue');
    expect(b.get('i3')!.toString()).toBe('purple');
  });

  it('clears and iterates', () => {
    const colors = new ColorSet();
    colors.set('i1', parse('red'));
    expect([...colors].map(([id, color]) => [id, color.toString()])).toEqual([['i1', 'red']]);
    colors.set('i2', parse('green'));
    expect(colors.size()).toBe(2);
    colors.clear();
    expect(colors.size()).toBe(0);
  });

  it('sends grab and release signals once', () => {
    const colors = new ColorSet(Manager.get().find(T.RGB), false);
    expect(signalCount(colors.signal_grabbed, () => colors.grab())).toBe(1);
    expect(signalCount(colors.signal_grabbed, () => colors.grab())).toBe(0);
    expect(signalCount(colors.signal_released, () => colors.release())).toBe(1);
    expect(signalCount(colors.signal_released, () => colors.release())).toBe(0);
  });

  it('sends the changed signal only for changes', () => {
    const colors = new ColorSet(Manager.get().find(T.RGB));
    colors.set('0', new Color(0xff0000ff));
    colors.set('1', new Color(0x00ff00ff));
    const comp = colors.getBestSpace()!.getComponents().at(0);
    const changed = (run: () => void) => signalCount(colors.signal_changed, run);
    expect(changed(() => expect(colors.setAll(comp, 0.5)).toBe(2))).toBe(1);
    expect(changed(() => expect(colors.setAll(comp, 0.5)).toBe(0))).toBe(0);
    expect(changed(() => expect(colors.set('0', parse('blue'))).toBe(true))).toBe(1);
    expect(changed(() => expect(colors.set('0', parse('blue'))).toBe(false))).toBe(0);
    expect(changed(() => expect(colors.setAll(parse('blue'))).toBe(1))).toBe(1);
    expect(changed(() => expect(colors.setAll(parse('blue'))).toBe(0))).toBe(0);
  });

  it('sends the cleared signal only when colors are removed', () => {
    const colors = new ColorSet();
    expect(signalCount(colors.signal_cleared, () => colors.clear())).toBe(0);
    expect(signalCount(colors.signal_cleared, () => colors.set('new', parse('red')))).toBe(0);
    expect(signalCount(colors.signal_cleared, () => colors.clear())).toBe(1);
  });

  it('moves the average of a component', () => {
    const space = Manager.get().find(T.RGB)!;
    const colors = new ColorSet(space, false);
    colors.set('0', new Color(space, [0.4, 0.5, 1.0]));
    colors.set('1', new Color(space, [0.5, 0.5, 0.5]));
    colors.set('2', new Color(space, [0.6, 0.5, 0.0]));
    const comp = space.getComponents();
    // Red starts off in the middle, Green is our control
    expectClose(colors.getAverage(comp.at(0)), 0.5, 0.01);
    expectClose(colors.getAverage(comp.at(1)), 0.5, 0.01);
    expectNear(colors.getAll(comp.at(0)), [0.4, 0.5, 0.6], 0.05);
    // Move red to 0.75, green doesn't change
    expect(signalCount(colors.signal_changed, () => colors.setAverage(comp.at(0), 0.75))).toBe(1);
    expectClose(colors.getAverage(comp.at(0)), 0.75, 0.01);
    expectClose(colors.getAverage(comp.at(1)), 0.5, 0.01);
    expectNear(colors.getAll(comp.at(0)), [0.65, 0.75, 0.85], 0.05);
    // Move red to 1.0 pushing some values out of bounds
    colors.setAverage(comp.at(0), 1.0);
    expectClose(colors.getAverage(comp.at(0)), 1.0, 0.01);
    expectNear(colors.getAll(comp.at(0)), [0.9, 1, 1], 0.05);
    // Move red to 0.25, green doesn't change, but red remembers it's previous range
    colors.setAverage(comp.at(0), 0.25);
    expectClose(colors.getAverage(comp.at(0)), 0.25, 0.01);
    expectNear(colors.getAll(comp.at(0)), [0.15, 0.25, 0.35], 0.05);
  });

  it('gets the average color', () => {
    const colors = new ColorSet(undefined, false);
    colors.set('c1', parse('black'));
    colors.set('c2', parse('white'));
    expect(colors.getBestSpace()!.getName()).toBe('CSSNAME');
    expect(colors.getAverage().toString()).toBe('gray');
    expect(colors.isSame()).toBe(false);
    colors.set('c1', parse('red'));
    colors.set('c2', parse('red'));
    expect(colors.getAverage().toString()).toBe('red');
    expect(colors.isSame()).toBe(true);
    colors.clear();
    colors.set('c1', parse('hsl(180,100,100)'));
    colors.set('c2', parse('hsla(60,0,0, 50)'));
    expect(colors.getBestSpace()!.getName()).toBe('HSL');
    expect(colors.getAverage().toString()).toBe('hsl(120, 50%, 50%)');
    colors.set('c1', parse('hsl(180,100,100)'));
    colors.set('c2', parse('hsl(0,50,100)'));
    colors.set('c3', parse('blue'));
    expect(colors.getAverage().toString()).toBe('hsl(139, 83.333%, 83.333%)');
    expect(() => new ColorSet().getAverage()).toThrow();
  });

  it('gets the average of colors in other spaces', () => {
    const colors = new ColorSet(undefined, false);
    colors.set('cmyk1', parse('device-cmyk(0.5 0.5 0.0 0.2 / 0.5)'));
    colors.set('rgb1', parse('red'));
    expect(colors.getBestSpace()!.getName()).toBe('DeviceCMYK');
    expect(colors.getAverage().toString()).toBe('device-cmyk(0.25 0.75 0.5 0.1)');
  });
});
