// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/svg-angle.cpp
import { describe, expect, it } from 'vitest';
import { SVGAngle, SVGAngleUnit } from './svg-angle.ts';

describe('SVGAngle.read', () => {
  it.each([
    ['45', SVGAngleUnit.NONE, 45, 45],
    ['-10.5deg', SVGAngleUnit.DEG, -10.5, -10.5],
    ['100grad', SVGAngleUnit.GRAD, 100, 90],
    ['0.5turn', SVGAngleUnit.TURN, 0.5, 180],
    ['  30 ', SVGAngleUnit.NONE, 30, 30],
  ])('reads %j', (str, unit, value, computed) => {
    const a = new SVGAngle();
    expect(a.read(str)).toBe(true);
    expect([a._set, a.unit, a.value, a.computed]).toEqual([true, unit, value, computed]);
  });

  it('converts radians to degrees', () => {
    const a = new SVGAngle();
    a.read('3.141592653589793rad');
    expect(a.unit).toBe(SVGAngleUnit.RAD);
    expect(a.computed).toBeCloseTo(180, 12);
  });

  it.each(['', 'deg', '45 deg', '45xyz', '45e'])('rejects %j', (str) => {
    expect(new SVGAngle().read(str)).toBe(false);
  });

  it('unsets to the given values on failure', () => {
    const a = new SVGAngle();
    a.read('10');
    a.readOrUnset('bad', SVGAngleUnit.DEG, 1, 2);
    expect([a._set, a.unit, a.value, a.computed]).toEqual([false, SVGAngleUnit.DEG, 1, 2]);
  });
});
