// SPDX-License-Identifier: GPL-2.0-or-later
import { Scale, Translate } from '@inkscape-web/geom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPDocument } from '../document.ts';
import { PATHSTRING_FORMAT } from '../svg/path-string.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import { SPLine } from './sp-line.ts';
import { SP_OBJECT_WRITE_BUILD } from './sp-object.ts';
import { SPPolygon, sp_poly_parse_curve } from './sp-polygon.ts';
import { SPPolyLine } from './sp-polyline.ts';
import type { SPShape } from './sp-shape.ts';

SPDocument.scheduleIdle = () => {};

const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const get = <T extends SPShape>(doc: SPDocument, cls: new () => T, id = 's') => {
  const o = doc.getObjectById(id);
  if (!(o instanceof cls)) throw new Error(`no ${cls.name} ${id}`);
  return o;
};
const d = (s: SPShape) =>
  sp_svg_write_path(s.curve() ?? [], { pathString: { format: PATHSTRING_FORMAT.PATHSTRING_ABSOLUTE } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SPLine', () => {
  it('is a segment between its end points', () => {
    const l = get(open('<line id="s" x1="1" y1="2" x2="1in" y2="4"/>'), SPLine);
    expect(d(l)).toBe('M 1,2 96,4');
  });

  it('writes the computed end points as numbers', () => {
    const l = get(open('<line id="s" x1="1" y1="2" x2="1in" y2="4"/>'), SPLine);
    l.updateRepr();
    expect(['x1', 'y1', 'x2', 'y2'].map((n) => l.getAttribute(n))).toEqual(['1', '2', '96', '4']);
  });

  it('bakes any transform into the end points', () => {
    const doc = open('<line id="s" x1="0" y1="0" x2="10" y2="20" style="stroke-width:2"/>');
    const l = get(doc, SPLine);
    l.doWriteTransform(Scale(2).multiply(Translate(1, 1)));
    expect(['x1', 'y1', 'x2', 'y2'].map((n) => l.getAttribute(n))).toEqual(['1', '1', '21', '41']);
    expect(l.getAttribute('transform')).toBeNull();
    expect(l.style.stroke_width.computed).toBe(4);
  });

  it('has the display name Line', () => {
    expect(get(open('<line id="s"/>'), SPLine).displayName()).toBe('Line');
  });
});

describe('sp_poly_parse_curve', () => {
  it('reads pairs separated by commas and white space', () => {
    const p = sp_poly_parse_curve(' 1,2\n3 4,5e0 ,6 ');
    expect(p && sp_svg_write_path(p, { pathString: { format: PATHSTRING_FORMAT.PATHSTRING_ABSOLUTE } })).toBe(
      'M 1,2 3,4 5,6',
    );
  });

  it('gives nothing for no points', () => {
    expect(sp_poly_parse_curve('  ')).toBeNull();
  });

  it('warns and keeps the points before a broken pair', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = sp_poly_parse_curve('1,2 3,4 5');
    expect(p?.sizeOpen()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(sp_poly_parse_curve('1,2 x')?.sizeOpen()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('SPPolyLine', () => {
  it('is an open path through the points', () => {
    const p = get(open('<polyline id="s" points="1,2 3,4 5,6"/>'), SPPolyLine);
    expect(d(p)).toBe('M 1,2 3,4 5,6');
    expect(p.curve()?.[0]?.closed()).toBe(false);
    expect(p.description()).toBe('<b>Polyline</b>');
  });

  it('follows changes of points', () => {
    const doc = open('<polyline id="s" points="1,2 3,4"/>');
    const p = get(doc, SPPolyLine);
    p.setAttribute('points', '0,0 9,9');
    expect(d(p)).toBe('M 0,0 9,9');
  });

  it('copies the repr on a build write, because it does not write points itself', () => {
    const doc = open('<polyline id="s" points="1,2 3,4" fill="red"/>');
    const p = get(doc, SPPolyLine);
    const repr = p.write(doc.getReprDoc(), null, SP_OBJECT_WRITE_BUILD);
    expect(repr?.name()).toBe('svg:polyline');
    expect(repr?.attribute('points')).toBe('1,2 3,4');
    expect(repr?.attribute('fill')).toBe('red');
  });
});

describe('SPPolygon', () => {
  it('is a closed path through the points', () => {
    const p = get(open('<polygon id="s" points="0,0 10,0 10,10"/>'), SPPolygon);
    expect(d(p)).toBe('M 0,0 H 10 V 10 Z');
    expect(p.curve()?.[0]?.closed()).toBe(true);
    expect(p.description()).toBe('<b>Polygon</b>');
  });

  it('writes the end point of each segment, including the closing one', () => {
    const doc = open('<polygon id="s" points="0,0 10,0 10,10"/>');
    const p = get(doc, SPPolygon);
    p.updateRepr();
    expect(p.getAttribute('points')).toBe('10,0 10,10 0,0 ');
    // The list starts with the second vertex, as upstream (it writes the end of each segment).
    // Read back, the same vertices follow in the same order, from another start.
    const again = open(`<polygon id="s" points="${p.getAttribute('points')}"/>`);
    expect(d(get(again, SPPolygon))).toBe('M 10,0 V 10 L 0,0 Z');
  });

  it('keeps the old curve when points is removed', () => {
    const doc = open('<polygon id="s" points="0,0 10,0 10,10"/>');
    const p = get(doc, SPPolygon);
    p.removeAttribute('points');
    expect(d(p)).toBe('M 0,0 H 10 V 10 Z');
  });
});
