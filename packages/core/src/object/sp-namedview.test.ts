// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-namedview.cpp
import { describe, expect, it } from 'vitest';
import { Color } from '../colors/color.ts';
import { SPDocument } from '../document.ts';

SPDocument.scheduleIdle = () => {};

const open = (inner: string) => {
  const doc = SPDocument.createNewDocFromMem(`<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);
  if (!doc) throw new Error('parse failed');
  return doc;
};

describe('SPNamedView', () => {
  it('reads colors, units and flags', () => {
    const doc = open(
      '<sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
        'pagecolor="#ff0000" bordercolor="#00ff00" borderopacity="0.5" inkscape:deskcolor="#102030" ' +
        'inkscape:document-units="mm" showguides="false" showborder="false"/>',
    );
    const nv = doc.getNamedView();
    expect(nv.getBackgroundColor().toString(false)).toBe('#ff0000');
    expect(nv.getBorderColor().toString(false)).toBe('#00ff00');
    expect(nv.getBorderColor().getOpacity()).toBeCloseTo(0.5);
    expect(nv.getDeskColor().toString(false)).toBe('#102030');
    expect(nv.getDisplayUnit()).toBe('mm');
    expect(nv.getShowGuides()).toBe(false);
    expect(nv.border_show.value).toBe(false);
  });

  it('uses the defaults, and falls back to px for relative units', () => {
    const doc = open('');
    const nv = doc.getNamedView();
    expect(nv.getBackgroundColor().toString(false)).toBe('#ffffff');
    expect(nv.getDeskColor().toString(false)).toBe('#d1d1d1');
    expect(nv.getDisplayUnit()).toBe('px');
    expect(nv.getShowGuides()).toBe(true);
    nv.setDisplayUnit('em');
    expect(nv.getDisplayUnit()).toBe('px');
  });

  it('creates the element as first child and writes attributes to the repr', () => {
    const doc = open('<g id="g"/>');
    const nv = doc.getNamedView();
    expect(doc.rroot.firstChild()?.name()).toBe('sodipodi:namedview');
    nv.setPageColor(new Color(0x336699ff, false));
    nv.setBorderColor(new Color(0x112233ff, false));
    nv.setShowGuides(false);
    nv.setDisplayUnit('in');
    expect(nv.getAttribute('pagecolor')).toBe('#336699');
    expect(nv.getAttribute('bordercolor')).toBe('#112233');
    expect(nv.getAttribute('showguides')).toBe('false');
    expect(nv.getAttribute('inkscape:document-units')).toBe('in');
    expect(nv.getBackgroundColor().toString(false)).toBe('#336699');
    expect(doc.getNamedView()).toBe(nv);
  });
});
