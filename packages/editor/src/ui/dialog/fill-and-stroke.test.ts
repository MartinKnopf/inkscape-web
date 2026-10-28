// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/fill-and-stroke.cpp, src/ui/widget/stroke-style.cpp
// @vitest-environment happy-dom
import {
  Colors,
  Preferences,
  SPDocument,
  SPGradientType,
  SPLinearGradient,
  SPRadialGradient,
  type SPStop,
  spReprCssAttrNew,
} from '@inkscape-web/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import {
  gradientStops,
  PaintMode,
  queryOpacity,
  queryPaint,
  queryStrokeStyle,
  STROKE_UNITS,
  set_scaled_dash,
  setFlatColor,
  setGradient,
  setOpacity,
  setPaintMode,
  setStopColor,
  setStopOffset,
  setStrokeDash,
  setStrokeJoinOrCap,
  setStrokeWidth,
} from './fill-and-stroke.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect id="a" width="10" height="10" style="fill:#ff0000;stroke:#000000;stroke-width:2;stroke-dasharray:4,2"/>' +
  '<rect id="b" width="10" height="10" style="fill:none"/>' +
  '<rect id="c" width="10" height="10" transform="scale(2)" style="stroke:#000000;stroke-width:3"/>' +
  '</svg>';

const unit = (abbr: string) => {
  const u = STROKE_UNITS.find((x) => x.abbr === abbr);
  if (!u) throw new Error(abbr);
  return u;
};

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  const select = (...ids: string[]) => {
    dt.getSelection().clear();
    for (const id of ids) {
      const obj = doc.getObjectById(id);
      if (obj) dt.getSelection().add(obj);
    }
  };
  const styleOf = (id: string) => doc.getObjectById(id)?.getRepr().attribute('style') ?? '';
  const steps = () => doc.undoStack.undo.map((e) => e.description);
  return { dt, select, styleOf, steps };
}

beforeEach(() => {
  Preferences.get().remove('/desktop/style');
});

describe('queryPaint', () => {
  it('tells the kind of paint of the selection', () => {
    const { dt, select } = setup();
    expect(queryPaint(dt, true)).toEqual({ kind: 'empty' });
    select('a');
    const fill = queryPaint(dt, true);
    expect(fill).toMatchObject({ kind: 'paint', mode: PaintMode.Solid });
    select('b');
    expect(queryPaint(dt, true)).toMatchObject({ kind: 'paint', mode: PaintMode.None });
    select('c');
    expect(queryPaint(dt, true)).toMatchObject({ kind: 'paint', mode: PaintMode.Derived });
    select('a', 'b');
    expect(queryPaint(dt, true)).toEqual({ kind: 'multiple' });
  });
});

describe('setPaintMode and setFlatColor', () => {
  it('removes and unsets paint with the upstream undo messages', () => {
    const { dt, select, styleOf, steps } = setup();
    select('a');
    setPaintMode(dt, true, PaintMode.None);
    expect(styleOf('a')).toContain('fill:none');
    setPaintMode(dt, false, PaintMode.Derived);
    expect(styleOf('a')).not.toContain('stroke:');
    expect(steps()).toEqual(['Remove fill', 'Unset stroke']);
  });

  it('merges the steps of a color drag into one undo step', () => {
    const { dt, select, styleOf, steps } = setup();
    select('a');
    setFlatColor(dt, new Colors.Color(0x00ff00ff), true);
    setFlatColor(dt, new Colors.Color(0x00ee00ff), true);
    expect(styleOf('a')).toContain('fill:#00ee00');
    expect(steps()).toEqual(['Set fill color']);
  });

  it('writes the color opacity', () => {
    const { dt, select, styleOf } = setup();
    select('a');
    setFlatColor(dt, new Colors.Color(0x00ff0080), false);
    expect(styleOf('a')).toMatch(/stroke:#00ff00/);
    expect(styleOf('a')).toMatch(/stroke-opacity:0\.50/);
  });
});

describe('stroke style', () => {
  it('converts the typed width and scales the dashes with it', () => {
    const { dt, select, styleOf, steps } = setup();
    select('a');
    setStrokeWidth(dt, 4, unit('px'));
    expect(styleOf('a')).toContain('stroke-width:4');
    // 4,2 at width 2 are 2,1 times the width.
    expect(styleOf('a')).toContain('stroke-dasharray:8,4');
    setStrokeWidth(dt, 1, unit('mm'));
    expect(queryStrokeStyle(dt)?.width).toBeCloseTo(96 / 25.4);
    expect(steps()).toEqual(['Set stroke width', 'Set stroke width']);
  });

  it('sets a percent of the old width, compensating the item transform', () => {
    const { dt, select, styleOf } = setup();
    select('c');
    setStrokeWidth(dt, 200, unit('%'));
    // Desktop width 6 -> 12; in the item (scale 2) the width is 6.
    expect(queryStrokeStyle(dt)?.width).toBeCloseTo(12);
    expect(styleOf('c')).toContain('stroke-width:6');
  });

  it('reads and writes the dash pattern in units of the stroke width', () => {
    const { dt, select, styleOf } = setup();
    select('a');
    expect(queryStrokeStyle(dt)).toMatchObject({ dash: [2, 1], dashOffset: 0 });
    setStrokeDash(dt, [1, 3], 0);
    expect(styleOf('a')).toContain('stroke-dasharray:2,6');
    setStrokeDash(dt, [], 0);
    expect(styleOf('a')).toContain('stroke-dasharray:none');
  });

  it('sets join and cap', () => {
    const { dt, select, styleOf } = setup();
    select('a');
    setStrokeJoinOrCap(dt, 'stroke-linejoin', 'round');
    setStrokeJoinOrCap(dt, 'stroke-linecap', 'square');
    expect(styleOf('a')).toContain('stroke-linejoin:round');
    expect(styleOf('a')).toContain('stroke-linecap:square');
    expect(queryStrokeStyle(dt)).toMatchObject({ join: 1, cap: 2 });
  });

  it('disables the stroke style if no selected object has a stroke', () => {
    const { dt, select } = setup();
    expect(queryStrokeStyle(dt)).toBeNull();
    select('b');
    expect(queryStrokeStyle(dt)?.enabled).toBe(false);
    select('a');
    expect(queryStrokeStyle(dt)?.enabled).toBe(true);
  });
});

describe('set_scaled_dash', () => {
  it('writes the dashes scaled, or none', () => {
    const css = spReprCssAttrNew();
    set_scaled_dash(css, [1, 2], 0.5, 3);
    expect(css.attribute('stroke-dasharray')).toBe('3,6');
    expect(css.attribute('stroke-dashoffset')).toBe('1.5');
    set_scaled_dash(css, [], 0, 3);
    expect(css.attribute('stroke-dasharray')).toBe('none');
  });
});

describe('opacity', () => {
  it('merges the steps of a slider drag', () => {
    const { dt, select, styleOf, steps } = setup();
    select('a');
    setOpacity(dt, 0.8);
    setOpacity(dt, 0.4);
    expect(styleOf('a')).toContain('opacity:0.4');
    expect(queryOpacity(dt)).toBeCloseTo(0.4, 3);
    expect(steps()).toEqual(['Change opacity']);
  });
});

describe('gradient mode', () => {
  it('sets a new gradient from the flat color, switches to radial and edits a stop', () => {
    const { dt, select, steps } = setup();
    select('a');
    setPaintMode(dt, true, PaintMode.Gradient);
    const info = queryPaint(dt, true);
    if (info.kind !== 'paint' || !info.gradient) throw new Error('no gradient');
    expect(info.mode).toBe(PaintMode.Gradient);
    expect(info.gradient).toBeInstanceOf(SPLinearGradient);
    const stops = gradientStops(info.gradient);
    expect(stops.map((s) => s.getColor().toString())).toEqual(['#ff0000ff', '#ff0000ff']);

    setGradient(dt, true, info.gradient.getVector(), SPGradientType.SP_GRADIENT_TYPE_RADIAL);
    const radial = queryPaint(dt, true);
    expect(radial.kind === 'paint' && radial.gradient).toBeInstanceOf(SPRadialGradient);

    setStopColor(stops[1] as SPStop, new Colors.Color(0x0000ffff));
    setStopOffset(stops[1] as SPStop, 0.8);
    expect(steps()).toEqual([
      'Set gradient on fill',
      'Set gradient on fill',
      'Change gradient stop color',
      'Change gradient stop offset',
    ]);
  });
});
