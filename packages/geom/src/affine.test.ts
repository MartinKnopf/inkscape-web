// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Affine } from './affine.ts';
import { Point } from './point.ts';
import { Rotate, Scale, Translate, Zoom } from './transforms.ts';

const at = (m: Affine, x: number, y: number) => new Point(x, y).transformed(m);

describe('Affine', () => {
  it('multiplies like lib2geom: a.multiply(b) applies a first', () => {
    const p = at(Translate(10, 0).multiply(Scale(2)), 1, 0);
    expect([p.x, p.y]).toEqual([22, 0]);
    const q = at(Scale(2).multiply(Translate(10, 0)), 1, 0);
    expect([q.x, q.y]).toEqual([12, 0]);
  });

  it('inverts', () => {
    const m = Translate(3, 4).multiply(Rotate.from_degrees(30)).multiply(Scale(2, 5));
    expect(m.multiply(m.inverse()).isNear(new Affine(), 1e-12)).toBe(true);
  });

  it('inverts a singular matrix to the identity', () => {
    expect(new Affine(1, 1, 1, 1, 5, 5).inverse().isIdentity()).toBe(true);
  });

  it('classifies', () => {
    expect(Translate(1, 2).isTranslation()).toBe(true);
    expect(Scale(-2, 2).isUniformScale()).toBe(true);
    expect(Scale(-2, 2).flips()).toBe(true);
    expect(Scale(2, 3).isUniformScale()).toBe(false);
    expect(Scale(0, 3).isScale()).toBe(false);
    expect(Rotate(Math.PI / 3).isRotation()).toBe(true);
    expect(Rotate(Math.PI / 3).preservesDistances()).toBe(true);
  });

  it('measures expansion', () => {
    const m = Scale(3, 4);
    expect([m.expansionX(), m.expansionY(), m.descrim()]).toEqual([3, 4, Math.sqrt(12)]);
    expect(m.withExpansionX(6).c0).toBe(6);
  });
});

describe('transform factories', () => {
  it('rotate by an angle in radians or degrees, positive from +X towards +Y', () => {
    const p = at(Rotate.from_degrees(90), 1, 0);
    expect([p.x, p.y]).toEqual([0, 1]);
    const q = at(Rotate(new Point(0, 5)), 1, 0);
    expect([q.x, q.y]).toEqual([0, 1]);
  });

  it('rotates around a point', () => {
    const p = at(Rotate.around(new Point(1, 1), Math.PI), 2, 1);
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBeCloseTo(1, 12);
  });

  it('zoom translates first, then scales', () => {
    const p = at(Zoom(2, new Point(1, 1)), 1, 1);
    expect([p.x, p.y]).toEqual([4, 4]);
  });
});
