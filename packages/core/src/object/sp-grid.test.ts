// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-grid.cpp
import { Point } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { GridType, SPGrid } from './sp-grid.ts';

SPDocument.scheduleIdle = () => {};

const NS =
  'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';

const open = (attrs: string, namedview: string) => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" ${NS} ${attrs}><sodipodi:namedview>${namedview}</sodipodi:namedview></svg>`,
  );
  if (!doc) throw new Error('parse failed');
  return doc;
};

describe('SPGrid', () => {
  it('reads a rectangular grid and gives origin and spacing in desktop px', () => {
    const doc = open(
      'width="200" height="100" viewBox="0 0 100 50"',
      '<inkscape:grid id="g" type="xygrid" originx="1" originy="2" spacingx="5" spacingy="10" ' +
        'empspacing="4" color="#ff0000" opacity="0.25" empcolor="#0000ff" empopacity="0.5" dotted="true" visible="false"/>',
    );
    const [grid] = doc.getNamedView().grids;
    if (!grid) throw new Error('no grid');
    expect(grid.getType()).toBe(GridType.RECTANGULAR);
    expect(grid.getMajorLineInterval()).toBe(4);
    expect(grid.getMinorColor().toString(false)).toBe('#ff0000');
    expect(grid.getMinorColor().getOpacity()).toBe(0.25);
    expect(grid.getMajorColor().getOpacity()).toBe(0.5);
    expect(grid.getDotted()).toBe(true);
    expect(grid.isVisible()).toBe(false);
    // scale 2 of the viewBox
    const { origin, spacing } = grid.getEffectiveOriginAndSpacing();
    expect(origin.equals(new Point(2, 4))).toBe(true);
    expect(spacing.equals(new Point(10, 20))).toBe(true);
  });

  it('setShowGrids() creates a rectangular grid, then toggles its visibility', () => {
    const doc = open('width="200" height="100"', '');
    const nv = doc.getNamedView();
    expect(nv.getShowGrids()).toBe(false);
    nv.setShowGrids(true);
    const [grid] = nv.grids;
    expect(grid).toBeInstanceOf(SPGrid);
    expect(grid?.getAttribute('type')).toBe('xygrid');
    expect(grid?.getSpacing().equals(new Point(1, 1))).toBe(true);
    expect(nv.getShowGrids()).toBe(true);
    nv.toggleShowGrids();
    expect(grid?.getAttribute('visible')).toBe('false');
    expect(nv.getShowGrids()).toBe(false);
  });

  it('writes spacing, origin and colors as attributes', () => {
    const doc = open('width="200" height="100"', '<inkscape:grid id="g" type="xygrid"/>');
    const [grid] = doc.getNamedView().grids;
    if (!grid) throw new Error('no grid');
    grid.setSpacing(new Point(8, 6));
    grid.setOrigin(new Point(3, 4));
    grid.setMajorLineInterval(10);
    expect(
      ['spacingx', 'spacingy', 'originx', 'originy', 'empspacing'].map((a) => grid.getAttribute(a)),
    ).toEqual(['8', '6', '3', '4', '10']);
    expect(grid.getSpacing().equals(new Point(8, 6))).toBe(true);
  });
});
