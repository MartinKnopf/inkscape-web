// SPDX-License-Identifier: GPL-2.0-or-later
import { Scale, Translate } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { PATHSTRING_FORMAT } from '../svg/path-string.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import { GenericEllipseArcType, GenericEllipseType, SPGenericEllipse } from './sp-ellipse.ts';

SPDocument.scheduleIdle = () => {};

const NS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"';
const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(`<svg ${NS}>${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const ellipseOf = (doc: SPDocument, id = 'e') => {
  const o = doc.getObjectById(id);
  if (!(o instanceof SPGenericEllipse)) throw new Error(`no ellipse ${id}`);
  return o;
};
const d = (e: SPGenericEllipse) =>
  sp_svg_write_path(e.curve() ?? [], { pathString: { format: PATHSTRING_FORMAT.PATHSTRING_ABSOLUTE } });
const arc = (attrs: string) =>
  `<path id="e" sodipodi:type="arc" sodipodi:cx="0" sodipodi:cy="0" sodipodi:rx="10" sodipodi:ry="10" ${attrs}/>`;

describe('SPGenericEllipse factory', () => {
  it('selects the type from the element or sodipodi:type', () => {
    expect(ellipseOf(open('<circle id="e" r="1"/>')).type).toBe(GenericEllipseType.SP_GENERIC_ELLIPSE_CIRCLE);
    expect(ellipseOf(open('<ellipse id="e" rx="1" ry="2"/>')).type).toBe(
      GenericEllipseType.SP_GENERIC_ELLIPSE_ELLIPSE,
    );
    expect(ellipseOf(open(arc(''))).type).toBe(GenericEllipseType.SP_GENERIC_ELLIPSE_ARC);
  });
});

describe('SPGenericEllipse shape', () => {
  it('draws a circle as four quarter arcs from angle 0, closed', () => {
    const e = ellipseOf(open('<circle id="e" cx="50" cy="60" r="10"/>'));
    expect(d(e)).toBe('M 60,60 A 10,10 0 0 1 50,70 10,10 0 0 1 40,60 10,10 0 0 1 50,50 10,10 0 0 1 60,60 Z');
    expect(e.geometricBounds()?.left()).toBeCloseTo(40);
    expect(e.geometricBounds()?.bottom()).toBeCloseTo(70);
  });

  it('scales the radii of an ellipse separately', () => {
    const e = ellipseOf(open('<ellipse id="e" cx="0" cy="0" rx="20" ry="10"/>'));
    expect(d(e)).toBe('M 20,0 A 20,10 0 0 1 0,10 20,10 0 0 1 -20,0 20,10 0 0 1 0,-10 20,10 0 0 1 20,0 Z');
  });

  it('has no curve for a zero radius', () => {
    expect(ellipseOf(open('<ellipse id="e" rx="0" ry="10"/>')).curve()).toBeNull();
  });

  it('draws a slice with a line to the center', () => {
    const e = ellipseOf(open(arc(`sodipodi:start="0" sodipodi:end="${Math.PI / 2}"`)));
    expect(e.arcType()).toBe(GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_SLICE);
    // upstream: 1 + int(extent * 2 / pi) segments, so a quarter is two arcs of 45 degrees
    expect(d(e)).toBe('M 10,0 A 10,10 0 0 1 7.071067812,7.071067812 10,10 0 0 1 0,10 V 0 Z');
    expect(e.displayName()).toBe('Slice');
  });

  it('draws an open arc and a chord', () => {
    const range = `sodipodi:start="0" sodipodi:end="${Math.PI / 2}"`;
    const a = ellipseOf(open(arc(`${range} sodipodi:arc-type="arc"`)));
    expect(d(a)).toBe('M 10,0 A 10,10 0 0 1 7.071067812,7.071067812 10,10 0 0 1 0,10');
    expect(a.curve()?.[0]?.closed()).toBe(false);
    const c = ellipseOf(open(arc(`${range} sodipodi:arc-type="chord"`)));
    expect(d(c)).toBe('M 10,0 A 10,10 0 0 1 7.071067812,7.071067812 10,10 0 0 1 0,10 Z');
  });

  it('reads the old sodipodi:open as an arc', () => {
    const e = ellipseOf(open(arc(`sodipodi:end="1" sodipodi:open="true"`)));
    expect(e.arcType()).toBe(GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_ARC);
  });

  it('takes the long way round for an angle over 180 degrees', () => {
    // 270 degrees: 1 + int(3) = 4 segments of 67.5 degrees
    const e = ellipseOf(
      open(arc(`sodipodi:start="0" sodipodi:end="${1.5 * Math.PI}" sodipodi:arc-type="arc"`)),
    );
    expect(e.curve()?.[0]?.size()).toBe(4);
    expect(e.geometricBounds()?.bottom()).toBeCloseTo(10);
    expect(e.geometricBounds()?.top()).toBeCloseTo(-10);
  });
});

describe('SPGenericEllipse.write', () => {
  it('writes a circle as svg:circle', () => {
    const e = ellipseOf(open('<circle id="e" cx="5" cy="6" r="7"/>'));
    e.updateRepr();
    expect(e.getRepr().name()).toBe('svg:circle');
    expect(['cx', 'cy', 'r', 'rx'].map((n) => e.getAttribute(n))).toEqual(['5', '6', '7', null]);
  });

  it('turns a circle into an ellipse when the radii differ', () => {
    const e = ellipseOf(open('<circle id="e" cx="5" cy="6" r="7"/>'));
    e.ry.assign(3);
    e.updateRepr();
    expect(e.getRepr().name()).toBe('svg:ellipse');
    expect(['cx', 'cy', 'r', 'rx', 'ry'].map((n) => e.getAttribute(n))).toEqual(['5', '6', null, '7', '3']);
    expect(e.type).toBe(GenericEllipseType.SP_GENERIC_ELLIPSE_ELLIPSE);
  });

  it('turns a circle into an arc path when start and end are set', () => {
    const e = ellipseOf(open('<circle id="e" cx="0" cy="0" r="10"/>'));
    e.end = Math.PI / 2;
    e.updateRepr();
    const repr = e.getRepr();
    expect(repr.name()).toBe('svg:path');
    expect(repr.attribute('sodipodi:type')).toBe('arc');
    expect(repr.attribute('sodipodi:cx')).toBe('0');
    expect(repr.attribute('sodipodi:rx')).toBe('10');
    expect(repr.attribute('sodipodi:end')).toBe('1.570796327');
    expect(repr.attribute('sodipodi:arc-type')).toBe('slice');
    expect(repr.attribute('sodipodi:open')).toBeNull();
    expect(repr.attribute('r')).toBeNull();
    expect(repr.attribute('d')).toMatch(
      /^M 10,0 A 10,10 0 0 1 7\.07106781\d,7\.07106781\d 10,10 0 0 1 0,10 V 0 Z$/,
    );
  });

  it('turns a full arc back into a circle', () => {
    const e = ellipseOf(open(arc('sodipodi:arc-type="arc" sodipodi:open="true"')));
    e.updateRepr();
    expect(e.getRepr().name()).toBe('svg:circle');
    expect(e.getAttribute('sodipodi:type')).toBeNull();
    expect(e.getAttribute('r')).toBe('10');
    expect(e.getAttribute('d')).toBeNull();
  });

  it('writes chord and arc with the old open attribute', () => {
    const e = ellipseOf(open(arc('sodipodi:end="1"')));
    e.setArcType(GenericEllipseArcType.SP_GENERIC_ELLIPSE_ARC_TYPE_CHORD);
    e.updateRepr();
    expect([e.getAttribute('sodipodi:arc-type'), e.getAttribute('sodipodi:open')]).toEqual(['chord', 'true']);
  });
});

describe('SPGenericEllipse.setTransform', () => {
  it('bakes scale and translation into the center and radii', () => {
    const e = ellipseOf(open('<ellipse id="e" cx="10" cy="20" rx="4" ry="2"/>'));
    e.doWriteTransform(Scale(2, 3).multiply(Translate(5, 5)));
    expect(['cx', 'cy', 'rx', 'ry'].map((n) => e.getAttribute(n))).toEqual(['25', '65', '8', '6']);
    expect(e.getAttribute('transform')).toBeNull();
  });
});
