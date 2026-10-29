// SPDX-License-Identifier: GPL-2.0-or-later
import { type Rect, Scale, Translate } from '@inkscape-web/geom';
import { afterEach, describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { Preferences } from '../preferences.ts';
import type { SPGroup } from './sp-item-group.ts';
import { SPPath } from './sp-path.ts';

SPDocument.scheduleIdle = () => {};

const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const path = (doc: SPDocument, id = 'p') => {
  const o = doc.getObjectById(id);
  if (!(o instanceof SPPath)) throw new Error(`no path ${id}`);
  return o;
};
const rect = (r: Rect | null) => r && [r.left(), r.top(), r.right(), r.bottom()];

describe('SPPath', () => {
  it('reads d into the curve and writes it back', () => {
    const doc = open(
      '<path id="p" d="M 0,0 L 10,0 10,20 Z" inkscape:original-d="M 1,1" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"/>',
    );
    const p = path(doc);
    expect(p.curve()?.[0]?.size()).toBe(3);
    expect(p.description()).toBe('3 nodes');
    p.setAttribute('d', 'M 1,2 3,4');
    expect(p.curve()?.[0]?.size()).toBe(1);
    p.updateRepr();
    expect(p.getAttribute('d')).toBe('M 1,2 3,4');
    // Without a path effect, inkscape:original-d is dropped (upstream SPShape::build).
    expect(p.getAttribute('inkscape:original-d')).toBeNull();
  });

  it('adds an empty d when it is missing', () => {
    const doc = open('<path id="p"/>');
    expect(path(doc).curve()).toEqual([]);
    expect(path(doc).geometricBounds()).toBeNull();
  });

  it('has bounds in its own, a given and document coordinates', () => {
    const doc = open(
      '<g id="g" transform="scale(2)"><path id="p" d="M 0,0 H 10 V 20" transform="translate(5,5)" style="stroke:#000;stroke-width:2"/></g>',
    );
    const p = path(doc);
    expect(rect(p.geometricBounds())).toEqual([0, 0, 10, 20]);
    expect(rect(p.geometricBounds(Translate(1, 1)))).toEqual([1, 1, 11, 21]);
    expect(rect(p.documentGeometricBounds())).toEqual([10, 10, 30, 50]);
    // The visual bounds include the stroke: half of the width on each side.
    expect(rect(p.visualBounds())).toEqual([-1, -1, 11, 21]);
    expect(rect(p.documentVisualBounds())).toEqual([8, 8, 32, 52]);
    // The group bounds are the union of the children in the group's coordinates.
    const g = doc.getObjectById('g') as SPGroup;
    expect(rect(g.geometricBounds())).toEqual([5, 5, 15, 25]);
  });
});

describe('SPItem.doWriteTransform on a path', () => {
  afterEach(() => {
    Preferences.get().remove('/options/preservetransform/value');
    Preferences.get().remove('/options/transform/stroke');
  });

  it('bakes the transform into d and scales the stroke', () => {
    const doc = open('<path id="p" d="M 0,0 H 10" style="stroke-width:2"/>');
    const p = path(doc);
    p.doWriteTransform(Translate(5, 5).multiply(Scale(2)));
    expect(p.getAttribute('d')).toBe('M 10,10 H 30');
    expect(p.getAttribute('transform')).toBeNull();
    expect(p.transform.isIdentity()).toBe(true);
    expect(p.style.stroke_width.computed).toBe(4);
    expect(p.getAttribute('style')).toBe('stroke-width:4');
  });

  it('keeps the stroke width when /options/transform/stroke is false', () => {
    Preferences.get().setBool('/options/transform/stroke', false);
    const doc = open('<path id="p" d="M 0,0 H 10" style="stroke-width:2"/>');
    const p = path(doc);
    p.doWriteTransform(Scale(2));
    expect(p.getAttribute('d')).toBe('M 0,0 H 20');
    expect(p.style.stroke_width.computed).toBe(2);
  });

  it('keeps the transform attribute when /options/preservetransform/value is set', () => {
    Preferences.get().setBool('/options/preservetransform/value', true);
    const doc = open('<path id="p" d="M 0,0 H 10"/>');
    const p = path(doc);
    p.doWriteTransform(Translate(5, 5));
    expect(p.getAttribute('d')).toBe('M 0,0 H 10');
    expect(p.getAttribute('transform')).toBe('translate(5,5)');
  });
});
