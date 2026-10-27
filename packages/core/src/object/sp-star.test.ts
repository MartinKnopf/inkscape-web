// SPDX-License-Identifier: GPL-2.0-or-later
import { Point, Scale, Translate } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { PATHSTRING_FORMAT } from '../svg/path-string.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import { SPStar } from './sp-star.ts';

SPDocument.scheduleIdle = () => {};

const NS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';
const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(`<svg ${NS}>${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const star = (attrs: string) =>
  open(`<path id="s" sodipodi:type="star" sodipodi:cx="0" sodipodi:cy="0" ${attrs}/>`);
const starOf = (doc: SPDocument) => {
  const o = doc.getObjectById('s');
  if (!(o instanceof SPStar)) throw new Error('no star');
  return o;
};
const d = (s: SPStar) =>
  sp_svg_write_path(s.curve() ?? [], { pathString: { format: PATHSTRING_FORMAT.PATHSTRING_ABSOLUTE } });

describe('SPStar attributes', () => {
  it('is created for sodipodi:type="star" with the upstream defaults', () => {
    const s = starOf(open('<path id="s" sodipodi:type="star"/>'));
    // r2 is 0 and not the constructor value 0.001, because build() reads the missing attribute
    expect([s.sides, s.r[0], s.r[1], s.flatsided, s.rounded, s.randomized]).toEqual([5, 1, 0, false, 0, 0]);
    expect(s.description()).toBe('with 5 vertices');
    expect(s.typeName()).toBe('star');
  });

  it('clamps the number of sides; a flat-sided star has at least three', () => {
    expect(starOf(star('sodipodi:sides="2000"')).sides).toBe(1024);
    expect(starOf(star('sodipodi:sides="1"')).sides).toBe(2);
    const flat = starOf(star('sodipodi:sides="2" inkscape:flatsided="true"'));
    expect(flat.sides).toBe(3);
    expect(flat.typeName()).toBe('polygon');
    expect(flat.displayName()).toBe('Polygon');
  });
});

describe('SPStar shape', () => {
  it('alternates between outer and inner points, closed', () => {
    const s = starOf(
      star(
        'sodipodi:sides="4" sodipodi:r1="10" sodipodi:r2="5" sodipodi:arg1="0" sodipodi:arg2="0.785398163397448"',
      ),
    );
    const a = 5 * Math.SQRT1_2; // 5 cos(45 degrees)
    const f = (v: number) => Number(v.toFixed(9));
    expect(d(s)).toBe(
      [
        'M 10,0',
        `L ${f(a)},${f(a)}`,
        `L 0,10`,
        `L ${f(-a)},${f(a)}`,
        `L -10,0`,
        `L ${f(-a)},${f(-a)}`,
        `L 0,-10`,
        `L ${f(a)},${f(-a)}`,
        'Z',
      ]
        .join(' ')
        .replace(/ L /g, ' '),
    );
  });

  it('draws only the outer points for a flat-sided star', () => {
    const s = starOf(star('sodipodi:sides="3" sodipodi:r1="10" inkscape:flatsided="true" sodipodi:arg1="0"'));
    expect(s.curve()?.[0]?.sizeOpen()).toBe(2);
    expect(d(s)).toBe('M 10,0 -5,8.660254038 -5,-8.660254038 Z');
  });

  it('rounds with Beziers whose handles are at rounded * the neighbour distance', () => {
    // Square with corners (10,0), (0,10), ...: the handles of the first side are at 0.5 * 14.142
    const s = starOf(
      star('sodipodi:sides="4" sodipodi:r1="10" inkscape:flatsided="true" inkscape:rounded="0.5"'),
    );
    const h = 0.5 * Math.hypot(10, 10);
    const first = s.curve()?.[0]?.at(0);
    expect(first?.isLineSegment()).toBe(false);
    const f = (v: number) => Number(v.toFixed(9));
    expect(d(s).startsWith(`M 10,0 C 10,${f(h)} ${f(h)},10 0,10`)).toBe(true);
    // all four sides are curves
    expect(s.curve()?.[0]?.size()).toBe(4);
  });

  it('displaces the points by a seeded pseudorandom amount', () => {
    // Seed of the point (10,0): 65536 * 640 = 41943040. Two LCG steps give rnd = 0.0019531252 and
    // -0.0995932934 (x = 10 + 0.1 * 20 * rnd1, y = 0.1 * 20 * rnd2).
    const s = starOf(star('sodipodi:sides="4" sodipodi:r1="10" sodipodi:r2="5" inkscape:randomized="0.1"'));
    const p = s.curve()?.[0]?.initialPoint();
    expect(p?.x).toBeCloseTo(10.00390625, 8);
    expect(p?.y).toBeCloseTo(-0.19918659, 7);
    // the same input gives the same shape
    expect(
      d(starOf(star('sodipodi:sides="4" sodipodi:r1="10" sodipodi:r2="5" inkscape:randomized="0.1"'))),
    ).toBe(d(s));
  });
});

describe('SPStar.write', () => {
  it('writes the parameters and d', () => {
    const doc = open('<path id="s"/>');
    const s = starOf(
      open(
        '<path id="s" sodipodi:type="star" sodipodi:cx="1" sodipodi:cy="2" sodipodi:r1="10" sodipodi:r2="5" sodipodi:sides="6"/>',
      ),
    );
    void doc;
    s.setPosition(7, new Point(3, 4), 20, 8, 0.5, 0.25, false, 0.1, 0);
    s.updateRepr();
    const attr = (n: string) => s.getAttribute(n);
    expect([
      attr('sodipodi:type'),
      attr('inkscape:flatsided'),
      attr('sodipodi:sides'),
      attr('sodipodi:cx'),
      attr('sodipodi:cy'),
      attr('sodipodi:r1'),
      attr('sodipodi:r2'),
      attr('sodipodi:arg1'),
      attr('sodipodi:arg2'),
      attr('inkscape:rounded'),
      attr('inkscape:randomized'),
    ]).toEqual(['star', 'false', '7', '3', '4', '20', '8', '0.5', '0.25', '0.1', '0']);
    expect(attr('d')).toBe(sp_svg_write_path(s.curve() ?? []));
  });

  it('clamps in setPosition: r2 to r1 and the flat-sided radius to cos(pi / sides) * r1', () => {
    const s = starOf(star('sodipodi:sides="5"'));
    s.setPosition(5, new Point(0, 0), 10, 30, 0, 0, false, 0, 0);
    expect(s.r).toEqual([10, 10]);
    s.setPosition(4, new Point(0, 0), 10, 0, 0, 0, true, 0, 0);
    expect(s.r[1]).toBeCloseTo(10 * Math.cos(Math.PI / 4), 12);
  });
});

describe('SPStar.setTransform', () => {
  it('bakes uniform scale and translation into center and radii', () => {
    const doc = star('sodipodi:r1="10" sodipodi:r2="5"');
    const s = starOf(doc);
    s.doWriteTransform(Scale(2).multiply(Translate(3, 4)));
    expect(
      ['sodipodi:cx', 'sodipodi:cy', 'sodipodi:r1', 'sodipodi:r2'].map((n) => s.getAttribute(n)),
    ).toEqual(['3', '4', '20', '10']);
    expect(s.getAttribute('transform')).toBeNull();
  });

  it('keeps a non-uniform scale in the transform attribute', () => {
    const s = starOf(star('sodipodi:r1="10" sodipodi:r2="5"'));
    s.doWriteTransform(Scale(2, 1));
    expect(s.getAttribute('sodipodi:r1')).toBe('10');
    expect(s.getAttribute('transform')).toBe('scale(2,1)');
  });
});
