// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-gradient.cpp, src/object/uri-references.cpp
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { type SPGradient, sp_gradient_ensure_vector_normalized } from './sp-gradient.ts';
import type { SPItem } from './sp-item.ts';
import { SPLinearGradient } from './sp-linear-gradient.ts';
import { SPGradientSpread, SPGradientUnits } from './sp-paint-server-data.ts';
import type { SPRadialGradient } from './sp-radial-gradient.ts';

SPDocument.scheduleIdle = () => {};

const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const byId = <T>(doc: SPDocument, id: string) => doc.getObjectById(id) as T;
const stops = (g: SPGradient) =>
  g.getGradientVector().stops.map((s) => [s.offset, s.color?.toString() ?? null]);

const VECTOR =
  '<linearGradient id="v" spreadMethod="reflect"><stop offset="0" style="stop-color:#ff0000"/>' +
  '<stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/></linearGradient>';

describe('paint server references', () => {
  it('resolves fill url() to the gradient and counts the reference', () => {
    const doc = open(`<defs>${VECTOR}</defs><rect id="r" width="10" height="10" style="fill:url(#v)"/>`);
    const r = byId<SPItem>(doc, 'r');
    const v = byId<SPGradient>(doc, 'v');
    expect(r.style.getFillPaintServer()).toBe(v);
    expect(r.style.fill.isPaintserver()).toBe(true);
    expect(v.hrefcount).toBe(1);
    expect(v.hrefList).toEqual([r]);

    r.setAttribute('style', 'fill:#00ff00');
    expect(r.style.getFillPaintServer()).toBeNull();
    expect(v.hrefcount).toBe(0);
  });

  it('resolves a reference to a gradient that comes later in the file', () => {
    const doc = open(`<rect id="r" style="stroke:url(#v)"/><defs>${VECTOR}</defs>`);
    expect(byId<SPItem>(doc, 'r').style.getStrokePaintServer()).toBe(byId(doc, 'v'));
  });

  it('does not resolve url() to an object that is not a paint server; keeps the fallback color', () => {
    const doc = open('<rect id="x"/><rect id="r" style="fill:url(#x) #123456"/>');
    const r = byId<SPItem>(doc, 'r');
    expect(r.style.getFillPaintServer()).toBeNull();
    expect(r.style.fill.isColor()).toBe(true);
    expect(r.style.fill.getValue()).toBe('url(#x) #123456');
  });

  it('follows the removal and the re-creation of the referenced gradient', () => {
    const doc = open(`<defs>${VECTOR}</defs><rect id="r" style="fill:url(#v)"/>`);
    const r = byId<SPItem>(doc, 'r');
    const repr = byId<SPGradient>(doc, 'v').getRepr();
    const defs = repr.parent();
    defs?.removeChild(repr);
    expect(r.style.getFillPaintServer()).toBeNull();
    defs?.appendChild(repr);
    expect(r.style.getFillPaintServer()).toBe(byId(doc, 'v'));
  });
});

describe('SPGradient', () => {
  it('builds the vector from the stops with stop-opacity', () => {
    const doc = open(`<defs>${VECTOR}</defs>`);
    const v = byId<SPGradient>(doc, 'v');
    expect(stops(v)).toEqual([
      [0, '#ff0000ff'],
      [1, '#0000ff80'],
    ]);
    expect(v.getSpread()).toBe(SPGradientSpread.SP_GRADIENT_SPREAD_REFLECT);
  });

  it('inherits stops, units, spread and coordinates through an href chain', () => {
    const doc = open(
      `<defs>${VECTOR}<linearGradient id="a" xlink:href="#v" x1="5" gradientUnits="userSpaceOnUse" gradientTransform="translate(1,2)"/>` +
        '<radialGradient id="b" href="#a" cx="20"/><linearGradient id="c" xlink:href="#a"/></defs>',
    );
    const a = byId<SPLinearGradient>(doc, 'a');
    const b = byId<SPRadialGradient>(doc, 'b');
    const c = byId<SPLinearGradient>(doc, 'c');
    expect(a.getVector()).toBe(byId(doc, 'v'));
    expect(b.getVector()).toBe(byId(doc, 'v'));
    expect(stops(b)).toEqual(stops(byId<SPGradient>(doc, 'v')));
    expect(b.getUnits()).toBe(SPGradientUnits.SP_GRADIENT_UNITS_USERSPACEONUSE);
    expect(b.getSpread()).toBe(SPGradientSpread.SP_GRADIENT_SPREAD_REFLECT);
    expect(b.gradientTransform.translation().y).toBe(2);
    expect(c.x1.computed).toBe(5);
    expect(c.x1._set).toBe(false);
    expect(byId<SPGradient>(doc, 'v').hrefcount).toBe(1);
    expect(a.hrefcount).toBe(2);
  });

  it('updates the referencing gradient when a stop of the vector changes', () => {
    const doc = open(`<defs>${VECTOR}<linearGradient id="a" xlink:href="#v"/></defs>`);
    const a = byId<SPGradient>(doc, 'a');
    expect(stops(a)[0]).toEqual([0, '#ff0000ff']);
    byId<SPGradient>(doc, 'v').getFirstStop()?.setAttribute('style', 'stop-color:#00ff00');
    doc.ensureUpToDate();
    expect(stops(a)[0]).toEqual([0, '#00ff00ff']);
  });

  it('ignores href cycles', () => {
    const doc = open(
      '<defs><linearGradient id="a" xlink:href="#b"/><linearGradient id="b" xlink:href="#a"/></defs>',
    );
    const a = byId<SPGradient>(doc, 'a');
    expect(a.getVector()).toBe(a);
    expect(stops(a)).toEqual([
      [0, null],
      [1, null],
    ]);
  });

  it('normalizes a private gradient to a vector with own stops and no href', () => {
    const doc = open(`<defs>${VECTOR}<linearGradient id="a" xlink:href="#v" x1="3"/></defs>`);
    const a = byId<SPGradient>(doc, 'a');
    expect(sp_gradient_ensure_vector_normalized(a)).toBe(a);
    expect(a.getRepr().attribute('xlink:href')).toBeNull();
    expect(a.getStopCount()).toBe(2);
    expect(a.getRepr().attribute('spreadMethod')).toBe('reflect');
    expect(a).toBeInstanceOf(SPLinearGradient);
  });
});
