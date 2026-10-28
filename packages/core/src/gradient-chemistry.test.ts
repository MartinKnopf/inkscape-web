// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/gradient-chemistry.cpp, src/document.cpp
import { Point } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { Color } from './colors/color.ts';
import { SPDocument } from './document.ts';
import { DocumentUndo } from './document-undo.ts';
import {
  getGradient,
  getGradientCoords,
  sp_document_default_gradient_vector,
  sp_gradient_reverse_vector,
  sp_item_gradient_set_coords,
  sp_item_set_gradient,
} from './gradient-chemistry.ts';
import { GrPointType, PaintTarget, type SPGradient, SPGradientType } from './object/sp-gradient.ts';
import type { SPItem } from './object/sp-item.ts';
import { SPLinearGradient } from './object/sp-linear-gradient.ts';

SPDocument.scheduleIdle = () => {};

const open = (body: string, defs = '') => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><defs id="defs">${defs}</defs>${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const item = (doc: SPDocument, id: string) => doc.getObjectById(id) as SPItem;
const defsIds = (doc: SPDocument) => doc.getDefs()?.children.map((c) => c.getId()) ?? [];

describe('sp_item_set_gradient', () => {
  it('creates a collectable private gradient in user space that references the vector', () => {
    const doc = open('<rect id="r" x="10" y="20" width="100" height="50" style="fill:#ff0000"/>');
    const r = item(doc, 'r');
    const vector = sp_document_default_gradient_vector(doc, new Color(0xff0000ff), 1, false);
    const priv = sp_item_set_gradient(
      r,
      vector,
      SPGradientType.SP_GRADIENT_TYPE_LINEAR,
      PaintTarget.FOR_FILL,
    );
    doc.ensureUpToDate();

    expect(priv).toBeInstanceOf(SPLinearGradient);
    expect(getGradient(r, PaintTarget.FOR_FILL)).toBe(priv);
    expect(priv.getVector()).toBe(vector);
    const attr = (n: string) => priv.getRepr().attribute(n);
    expect(attr('inkscape:collect')).toBe('always');
    expect(attr('xlink:href')).toBe(`#${vector.getId()}`);
    expect(attr('gradientUnits')).toBe('userSpaceOnUse');
    expect([attr('x1'), attr('y1'), attr('x2'), attr('y2')]).toEqual(['10', '45', '110', '45']);
    expect(getGradientCoords(r, GrPointType.POINT_LG_END, 1, PaintTarget.FOR_FILL)).toEqual(
      new Point(110, 45),
    );
  });

  it('forks a private gradient that another object uses', () => {
    const doc = open(
      '<linearGradient id="v"><stop offset="0" style="stop-color:#000"/><stop offset="1" style="stop-color:#fff"/></linearGradient>' +
        '<linearGradient id="p" xlink:href="#v" x1="0" x2="10" gradientUnits="userSpaceOnUse"/>' +
        '<rect id="a" width="10" height="10" style="fill:url(#p)"/><rect id="b" width="10" height="10" style="fill:url(#p)"/>',
    );
    const a = item(doc, 'a');
    const v = doc.getObjectById('v') as SPGradient;
    const vector = v.getVector(true);
    const priv = sp_item_set_gradient(
      a,
      vector,
      SPGradientType.SP_GRADIENT_TYPE_LINEAR,
      PaintTarget.FOR_FILL,
    );
    expect(priv.getId()).not.toBe('p');
    expect(getGradient(a, PaintTarget.FOR_FILL)).toBe(priv);
    expect(getGradient(item(doc, 'b'), PaintTarget.FOR_FILL)?.getId()).toBe('p');
    expect(priv.getRepr().attribute('x2')).toBe('10');
  });

  it('moves the end of a linear gradient in desktop coordinates', () => {
    const doc = open('<rect id="r" transform="translate(5,0)" width="100" height="50"/>');
    const r = item(doc, 'r');
    const vector = sp_document_default_gradient_vector(doc, new Color(0x00ff00ff), 1, false);
    sp_item_set_gradient(r, vector, SPGradientType.SP_GRADIENT_TYPE_LINEAR, PaintTarget.FOR_FILL);
    sp_item_gradient_set_coords(
      r,
      GrPointType.POINT_LG_END,
      1,
      new Point(55, 50),
      PaintTarget.FOR_FILL,
      true,
      false,
    );
    doc.ensureUpToDate();
    const lg = getGradient(r, PaintTarget.FOR_FILL) as SPLinearGradient;
    expect([lg.x2.computed, lg.y2.computed]).toEqual([50, 50]);
    expect(getGradientCoords(r, GrPointType.POINT_LG_END, 1, PaintTarget.FOR_FILL)).toEqual(
      new Point(55, 50),
    );
  });

  it('reverses the stops of a vector', () => {
    const doc = open(
      '<linearGradient id="v"><stop offset="0" style="stop-color:#000000"/><stop offset="0.25" style="stop-color:#ff0000"/>' +
        '<stop offset="1" style="stop-color:#ffffff"/></linearGradient>',
    );
    const v = doc.getObjectById('v') as SPGradient;
    sp_gradient_reverse_vector(v);
    doc.ensureUpToDate();
    const stops = v.getGradientVector().stops.map((s) => [s.offset, s.color?.toString(false)]);
    expect(stops).toEqual([
      [0, '#ffffff'],
      [0.75, '#ff0000'],
      [1, '#000000'],
    ]);
  });
});

describe('orphan collection', () => {
  it('deletes a collectable private gradient when its last user changes the fill', () => {
    const doc = open('<rect id="r" width="10" height="10"/>');
    const r = item(doc, 'r');
    const vector = sp_document_default_gradient_vector(doc, new Color(0x0000ffff), 1, false);
    const priv = sp_item_set_gradient(
      r,
      vector,
      SPGradientType.SP_GRADIENT_TYPE_LINEAR,
      PaintTarget.FOR_FILL,
    );
    DocumentUndo.done(doc, 'set gradient');
    const ids = [vector.getId(), priv.getId()];
    expect(defsIds(doc)).toEqual(ids);

    r.setAttribute('style', 'fill:#000000');
    DocumentUndo.done(doc, 'set color');
    // The private goes first; then the vector (also collectable) has no user either.
    expect(defsIds(doc)).toEqual([]);

    DocumentUndo.undo(doc);
    expect(defsIds(doc)).toEqual(ids);
    expect(getGradient(r, PaintTarget.FOR_FILL)?.getId()).toBe(ids[1]);
  });

  it('vacuumDocument() removes unused defs, also without inkscape:collect', () => {
    const doc = open(
      '<rect id="r" style="fill:url(#used)"/>',
      '<linearGradient id="used"><stop offset="0"/></linearGradient><linearGradient id="unused"><stop offset="0"/></linearGradient>',
    );
    expect(defsIds(doc)).toEqual(['used', 'unused']);
    expect(doc.vacuumDocument()).toBe(2); // the gradient and its stop
    expect(defsIds(doc)).toEqual(['used']);
  });
});
