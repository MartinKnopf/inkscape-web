// SPDX-License-Identifier: GPL-2.0-or-later
import { type Rect, Rotate, Scale, Translate } from '@inkscape-web/geom';
import { afterEach, describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { Preferences } from '../preferences.ts';
import { PATHSTRING_FORMAT } from '../svg/path-string.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import { SP_OBJECT_WRITE_BUILD } from './sp-object.ts';
import { SPRect } from './sp-rect.ts';

SPDocument.scheduleIdle = () => {};

const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const rectOf = (doc: SPDocument, id = 'r') => {
  const o = doc.getObjectById(id);
  if (!(o instanceof SPRect)) throw new Error(`no rect ${id}`);
  return o;
};
const d = (r: SPRect) =>
  sp_svg_write_path(r.curve() ?? [], { pathString: { format: PATHSTRING_FORMAT.PATHSTRING_ABSOLUTE } });
const bounds = (r: Rect | null) => r && [r.left(), r.top(), r.right(), r.bottom()];

describe('SPRect shape', () => {
  it('is a closed rectangle without radii', () => {
    const r = rectOf(open('<rect id="r" x="10" y="20" width="100" height="50"/>'));
    expect(d(r)).toBe('M 10,20 H 110 V 70 H 10 Z');
  });

  it('has no curve for a zero width or height', () => {
    expect(rectOf(open('<rect id="r" width="0" height="5"/>')).curve()).toBeNull();
    expect(rectOf(open('<rect id="r" width="5"/>')).curve()).toBeNull();
  });

  it('rounds the corners with Beziers (control point factor 1 - 0.554)', () => {
    const r = rectOf(open('<rect id="r" x="10" y="20" width="100" height="50" rx="10" ry="5"/>'));
    expect(d(r)).toBe(
      'M 20,20 H 100 C 105.54,20 110,22.23 110,25 V 65 C 110,67.77 105.54,70 100,70 H 20 ' +
        'C 14.46,70 10,67.77 10,65 V 25 C 10,22.23 14.46,20 20,20 Z',
    );
  });

  it('uses rx for ry when only one is set, and clamps to half the size', () => {
    const r = rectOf(open('<rect id="r" width="20" height="100" rx="50"/>'));
    // rx = min(50, 10) = 10, ry = min(50, 50) = 50: no straight sides remain
    expect(d(r)).toBe(
      'M 10,0 C 15.54,0 20,22.3 20,50 20,77.7 15.54,100 10,100 4.46,100 0,77.7 0,50 0,22.3 4.46,0 10,0 Z',
    );
  });

  it('resolves units to px', () => {
    const r = rectOf(open('<rect id="r" width="1in" height="10mm" x="1cm"/>'));
    expect(r.width.computed).toBe(96);
    expect(bounds(r.geometricBounds())?.map((v) => Math.round(v * 1000) / 1000)).toEqual([
      37.795, 0, 133.795, 37.795,
    ]);
  });

  it('ignores a negative width and an rx of 0', () => {
    const r = rectOf(open('<rect id="r" width="-5" height="5" rx="0"/>'));
    expect(r.width._set).toBe(false);
    expect(r.rx._set).toBe(false);
    expect(r.curve()).toBeNull();
  });

  it('follows attribute changes', () => {
    const r = rectOf(open('<rect id="r" width="10" height="10"/>'));
    r.setAttribute('width', '30');
    r.document.ensureUpToDate();
    expect(d(r)).toBe('M 0,0 H 30 V 10 H 0 Z');
  });
});

describe('SPRect.write', () => {
  it('writes the lengths with their units and only the radii that are set', () => {
    const doc = open('<rect id="r" x="1mm" y="2" width="3" height="4" rx="1"/>');
    const r = rectOf(doc);
    r.updateRepr();
    expect(r.getAttribute('x')).toBe('1mm');
    expect(r.getAttribute('y')).toBe('2');
    expect(r.getAttribute('width')).toBe('3');
    expect(r.getAttribute('rx')).toBe('1');
    expect(r.getAttribute('ry')).toBeNull();
  });

  it('builds a new svg:rect repr that reads back the same', () => {
    const doc = open('<rect id="r" x="5" y="6" width="7" height="8" rx="1" ry="2" style="fill:#f00"/>');
    const r = rectOf(doc);
    const repr = r.write(doc.getReprDoc(), null, SP_OBJECT_WRITE_BUILD);
    expect(repr?.name()).toBe('svg:rect');
    for (const name of ['x', 'y', 'width', 'height', 'rx', 'ry']) {
      expect(repr?.attribute(name)).toBe(r.getAttribute(name));
    }
  });

  it('setPosition and setRx write through updateRepr', () => {
    const doc = open('<rect id="r" width="1" height="1"/>');
    const r = rectOf(doc);
    r.setPosition(1, 2, 30, 40);
    r.setRx(true, 3);
    r.updateRepr();
    expect(['x', 'y', 'width', 'height', 'rx'].map((n) => r.getAttribute(n))).toEqual([
      '1',
      '2',
      '30',
      '40',
      '3',
    ]);
  });
});

describe('SPRect transform baking', () => {
  afterEach(() => {
    Preferences.get().remove('/options/transform/stroke');
  });

  it('bakes scale and translation into the attributes', () => {
    const doc = open(
      '<rect id="r" x="10" y="20" width="100" height="50" rx="4" ry="2" style="stroke-width:2"/>',
    );
    const r = rectOf(doc);
    r.doWriteTransform(Scale(2, 3).multiply(Translate(5, 5)));
    // pos = (10,20) * (2,3) + (5,5) = (25, 65); rx = 4 * 2, ry = 2 * 3
    expect(['x', 'y', 'width', 'height', 'rx', 'ry'].map((n) => r.getAttribute(n))).toEqual([
      '25',
      '65',
      '200',
      '150',
      '8',
      '6',
    ]);
    expect(r.getAttribute('transform')).toBeNull();
    // stroke scales with sqrt(sw * sh)
    expect(r.style.stroke_width.computed).toBeCloseTo(2 * Math.sqrt(6), 4);
  });

  it('keeps the rotation in the transform attribute', () => {
    const doc = open('<rect id="r" x="0" y="0" width="10" height="20"/>');
    const r = rectOf(doc);
    r.doWriteTransform(Rotate.from_degrees(90).multiply(Scale(2)));
    expect(r.getAttribute('width')).toBe('20');
    expect(r.getAttribute('height')).toBe('40');
    expect(r.getAttribute('transform')).toBe('rotate(90)');
  });

  it('keeps the stroke width when /options/transform/stroke is false', () => {
    Preferences.get().setBool('/options/transform/stroke', false);
    const doc = open('<rect id="r" width="10" height="10" style="stroke-width:2"/>');
    const r = rectOf(doc);
    r.doWriteTransform(Scale(2));
    expect(r.getAttribute('width')).toBe('20');
    expect(r.style.stroke_width.computed).toBe(2);
  });
});

describe('SPRect.getVisible*', () => {
  it('multiplies by the stretch of the item to document transform', () => {
    const doc = open('<g transform="scale(2,3)"><rect id="r" width="10" height="10" rx="1" ry="1"/></g>');
    const r = rectOf(doc);
    expect(r.getVisibleWidth()).toBe(20);
    expect(r.getVisibleHeight()).toBe(30);
    expect(r.getVisibleRx()).toBe(2);
    r.setVisibleWidth(40);
    expect(r.width.computed).toBe(20);
  });
});
