// SPDX-License-Identifier: GPL-2.0-or-later
import { Scale, Translate } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { SPSpiral } from './sp-spiral.ts';

SPDocument.scheduleIdle = () => {};

const NS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"';
const open = (attrs: string) => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg ${NS}><path id="s" sodipodi:type="spiral" ${attrs}/></svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const o = doc.getObjectById('s');
  if (!(o instanceof SPSpiral)) throw new Error('no spiral');
  return o;
};

describe('SPSpiral attributes', () => {
  it('is created for sodipodi:type="spiral" with the upstream defaults', () => {
    const s = open('');
    expect([s.cx, s.cy, s.exp, s.revo, s.rad, s.arg, s.t0]).toEqual([0, 0, 1, 3, 1, 0, 0]);
    expect(s.typeName()).toBe('spiral');
    expect(s.description()).toBe('with 3.000000 turns');
  });

  it('clamps expansion, revolution and t0', () => {
    const s = open('sodipodi:expansion="5000" sodipodi:revolution="0" sodipodi:t0="2"');
    expect([s.exp, s.revo, s.t0]).toEqual([1000, 0.05, 0.999]);
  });

  it('keeps a radius that cannot be read at least 0.001', () => {
    const s = open('sodipodi:radius="2"');
    s.setAttribute('sodipodi:radius', 'x');
    expect(s.rad).toBe(2);
    s.rad = 0;
    s.setAttribute('sodipodi:radius', null);
    expect(s.rad).toBe(0.001);
  });
});

describe('SPSpiral geometry', () => {
  it('has the point (cx + rad cos, cy + rad sin) of the formula', () => {
    const s = open(
      'sodipodi:cx="5" sodipodi:cy="6" sodipodi:radius="10" sodipodi:revolution="2" sodipodi:expansion="2"',
    );
    // t = 0.25: rad = 10 * 0.25^2 = 0.625, arg = 2 pi * 2 * 0.25 = pi
    const p = s.getXY(0.25);
    expect(p.x).toBeCloseTo(5 - 0.625, 12);
    expect(p.y).toBeCloseTo(6, 12);
  });

  it('has a unit tangent along the derivative', () => {
    const s = open('sodipodi:revolution="3" sodipodi:expansion="1"');
    // d/dt of (t cos a, t sin a) at t = 1, a = 6 pi: (cos a - t a' sin a, sin a + t a' cos a) with a' = 6 pi
    const len = Math.hypot(1, 6 * Math.PI);
    const t = s.getTangent(1);
    expect(t.x).toBeCloseTo(1 / len, 12);
    expect(t.y).toBeCloseTo((6 * Math.PI) / len, 12);
    // exp 0 is a circle: the tangent is perpendicular to the radius
    const c = open('sodipodi:expansion="0"');
    expect(c.getTangent(0).x).toBeCloseTo(-0, 12);
    expect(c.getTangent(0).y).toBeCloseTo(1, 12);
  });

  it('is invalid for a huge radius', () => {
    expect(open('sodipodi:radius="1e6"').isInvalid()).toBe(true);
    expect(open('sodipodi:radius="10"').isInvalid()).toBe(false);
  });
});

describe('SPSpiral shape', () => {
  it('starts at t0 and ends at t = 1, within the outer radius', () => {
    const s = open('sodipodi:cx="5" sodipodi:cy="5" sodipodi:radius="10" sodipodi:revolution="3"');
    const path = s.curve()?.[0];
    expect(path?.closed()).toBe(false);
    expect(path?.initialPoint().x).toBeCloseTo(5, 12);
    expect(path?.initialPoint().y).toBeCloseTo(5, 12);
    // t = 1: rad 10 at angle 6 pi
    expect(path?.finalPoint().x).toBeCloseTo(15, 3);
    expect(path?.finalPoint().y).toBeCloseTo(5, 3);
    const b = s.geometricBounds();
    expect(b?.left()).toBeGreaterThan(5 - 10.5);
    expect(b?.right()).toBeLessThan(5 + 10.5);
    // at least one Bezier per quarter turn
    expect(path?.size()).toBeGreaterThanOrEqual(12);
  });

  it('follows the curve of the formula within the fitting tolerance', () => {
    const s = open('sodipodi:radius="10" sodipodi:revolution="2"');
    const path = s.curve()?.[0];
    // the Bezier end points are on the spiral: |p| = 10 t, so the distance to the center is at most 10
    const ends = path?.openCurves().map((c) => c.finalPoint()) ?? [];
    for (const p of ends) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(10 + 1e-6);
    expect(ends[ends.length - 1]?.x).toBeCloseTo(10, 3);
  });

  it('starts later for t0 > 0', () => {
    const s = open('sodipodi:radius="10" sodipodi:revolution="1" sodipodi:t0="0.5"');
    // t = 0.5: rad 5, angle pi
    expect(s.curve()?.[0]?.initialPoint().x).toBeCloseTo(-5, 12);
  });
});

describe('SPSpiral.write', () => {
  it('writes the parameters and d', () => {
    const s = open('');
    s.setPosition(1, 2, 3, 4, 5, 0.5, 0.25);
    s.updateRepr();
    expect(
      [
        'sodipodi:type',
        'sodipodi:cx',
        'sodipodi:cy',
        'sodipodi:expansion',
        'sodipodi:revolution',
        'sodipodi:radius',
        'sodipodi:argument',
        'sodipodi:t0',
      ].map((n) => s.getAttribute(n)),
    ).toEqual(['spiral', '1', '2', '3', '4', '5', '0.5', '0.25']);
    expect(s.getAttribute('d')?.startsWith('m ') || s.getAttribute('d')?.startsWith('M ')).toBe(true);
  });
});

describe('SPSpiral.setTransform', () => {
  it('bakes uniform scale and translation into center and radius', () => {
    const s = open('sodipodi:cx="1" sodipodi:cy="2" sodipodi:radius="10"');
    s.doWriteTransform(Scale(2).multiply(Translate(3, 4)));
    expect(['sodipodi:cx', 'sodipodi:cy', 'sodipodi:radius'].map((n) => s.getAttribute(n))).toEqual([
      '5',
      '8',
      '20',
    ]);
    expect(s.getAttribute('transform')).toBeNull();
  });

  it('keeps a non-uniform scale in the transform attribute', () => {
    const s = open('sodipodi:radius="10"');
    s.doWriteTransform(Scale(2, 1));
    expect(s.getAttribute('sodipodi:radius')).toBe('10');
    expect(s.getAttribute('transform')).toBe('scale(2,1)');
  });
});
