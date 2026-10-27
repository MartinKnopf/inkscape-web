// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/desktop-style.cpp
// @vitest-environment happy-dom
import { Preferences, SPDocument, SPStyle, spReprCssAttrNew, spReprCssSetProperty } from '@inkscape-web/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { SPDesktop } from './desktop.ts';
import {
  QUERY_STYLE_MULTIPLE_AVERAGED,
  QUERY_STYLE_MULTIPLE_DIFFERENT,
  QUERY_STYLE_MULTIPLE_SAME,
  QUERY_STYLE_NOTHING,
  QUERY_STYLE_PROPERTY_FILL,
  QUERY_STYLE_PROPERTY_MASTEROPACITY,
  QUERY_STYLE_PROPERTY_STROKE,
  QUERY_STYLE_PROPERTY_STROKEWIDTH,
  QUERY_STYLE_SINGLE,
  type QueryStyleProperty,
  sp_desktop_query_style,
  sp_desktop_set_style,
} from './desktop-style.ts';
import { Canvas } from './ui/widget/canvas.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="g1"><rect id="a" width="10" height="10" style="fill:#ff0000;stroke:#000000;stroke-width:2"/></g>' +
  '<rect id="b" width="10" height="10" style="fill:#0000ff;stroke:none;opacity:0.5"/>' +
  '<rect id="c" width="10" height="10" transform="scale(2)" style="fill:#ff0000;stroke:#000000;stroke-width:3"/>' +
  '</svg>';

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  const select = (...ids: string[]) => {
    const sel = dt.getSelection();
    sel.clear();
    for (const id of ids) {
      const obj = doc.getObjectById(id);
      if (obj) sel.add(obj);
    }
  };
  const query = (property: QueryStyleProperty) => {
    const style = new SPStyle(doc);
    const result = sp_desktop_query_style(dt, style, property);
    return { style, result };
  };
  const css = (props: Record<string, string>) => {
    const c = spReprCssAttrNew();
    for (const [k, v] of Object.entries(props)) spReprCssSetProperty(c, k, v);
    return c;
  };
  const styleOf = (id: string) => doc.getObjectById(id)?.getRepr().attribute('style') ?? '';
  return { dt, select, query, css, styleOf };
}

beforeEach(() => {
  for (const p of ['/desktop/style', '/desktop/rect/style', '/desktop/group/style'])
    Preferences.get().remove(p);
});

describe('sp_desktop_query_style', () => {
  it('returns nothing without selection', () => {
    const { query } = setup();
    expect(query(QUERY_STYLE_PROPERTY_FILL).result).toBe(QUERY_STYLE_NOTHING);
  });

  it('reports a single fill color', () => {
    const { select, query } = setup();
    select('a');
    const { style, result } = query(QUERY_STYLE_PROPERTY_FILL);
    expect(result).toBe(QUERY_STYLE_SINGLE);
    expect(style.fill.getColor().toString(false)).toBe('#ff0000');
  });

  it('reports multiple same and averaged fills', () => {
    const { select, query } = setup();
    select('a', 'c');
    expect(query(QUERY_STYLE_PROPERTY_FILL).result).toBe(QUERY_STYLE_MULTIPLE_SAME);
    select('a', 'b');
    const { style, result } = query(QUERY_STYLE_PROPERTY_FILL);
    expect(result).toBe(QUERY_STYLE_MULTIPLE_AVERAGED);
    expect(style.fill.getColor().toString(false)).toBe('#800080');
  });

  it('reports different paint types (color and none)', () => {
    const { select, query } = setup();
    select('a', 'b');
    expect(query(QUERY_STYLE_PROPERTY_STROKE).result).toBe(QUERY_STYLE_MULTIPLE_DIFFERENT);
  });

  it('averages the opacity', () => {
    const { select, query } = setup();
    select('a', 'b');
    const { style, result } = query(QUERY_STYLE_PROPERTY_MASTEROPACITY);
    expect(result).toBe(QUERY_STYLE_MULTIPLE_AVERAGED);
    expect(style.opacity.as_double()).toBeCloseTo(0.75, 3);
  });

  it('applies the item transform to the stroke width', () => {
    const { select, query } = setup();
    select('c');
    expect(query(QUERY_STYLE_PROPERTY_STROKEWIDTH).style.stroke_width.computed).toBeCloseTo(6);
    select('a', 'c');
    const { style, result } = query(QUERY_STYLE_PROPERTY_STROKEWIDTH);
    expect(result).toBe(QUERY_STYLE_MULTIPLE_AVERAGED);
    expect(style.stroke_width.computed).toBeCloseTo(4);
  });
});

describe('sp_desktop_set_style', () => {
  it('applies the style to the selection and remembers it for new objects', () => {
    const { dt, select, css, styleOf } = setup();
    select('b');
    sp_desktop_set_style(dt, css({ fill: '#00ff00' }));
    expect(styleOf('b')).toContain('fill:#00ff00');
    expect(Preferences.get().getStyle('/desktop/style').attribute('fill')).toBe('#00ff00');
    expect(Preferences.get().getStyle('/desktop/rect/style').attribute('fill')).toBe('#00ff00');
    expect(dt.getCurrentOrToolStyle('/tools/shapes/rect', false)?.attribute('fill')).toBe('#00ff00');
  });

  it('sets the style on the children of a group, but not opacity', () => {
    const { dt, select, css, styleOf } = setup();
    select('g1');
    sp_desktop_set_style(dt, css({ fill: '#00ff00', opacity: '0.5' }));
    expect(styleOf('a')).toContain('fill:#00ff00');
    expect(styleOf('a')).not.toContain('opacity');
    expect(styleOf('g1')).toContain('opacity:0.5');
    // A group has no style of its own for new objects.
    expect(Preferences.get().getStyle('/desktop/group/style').attributeList()).toEqual([]);
  });

  it('scales the stroke width by the inverse item transform', () => {
    const { dt, select, css, styleOf } = setup();
    select('c');
    sp_desktop_set_style(dt, css({ 'stroke-width': '8' }));
    expect(styleOf('c')).toContain('stroke-width:4');
  });

  it('does not touch the objects without change, and lets a slot intercept', () => {
    const { dt, select, css, styleOf } = setup();
    select('b');
    sp_desktop_set_style(dt, css({ fill: '#00ff00' }), false);
    expect(styleOf('b')).toContain('fill:#0000ff');
    const off = dt.connectSetStyle(() => true);
    sp_desktop_set_style(dt, css({ fill: '#00ff00' }));
    expect(styleOf('b')).toContain('fill:#0000ff');
    off();
  });
});
