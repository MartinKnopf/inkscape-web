// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/global-palettes.cpp, src/ui/dialog/swatches.cpp, src/ui/dialog/color-item.cpp
// @vitest-environment happy-dom
import { SPDocument, type SPItem } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import { GlobalPalettes, type PaletteFileData, parseGimpPalette } from './global-palettes.ts';
import {
  colorItemKey,
  colorItemOfColor,
  currentPaintKeys,
  isPinned,
  noneColorItem,
  paletteCells,
  setColorItem,
  swatchMatches,
} from './swatches.ts';

SPDocument.scheduleIdle = () => {};

const GPL = `GIMP Palette
Name: Test palette
Columns: 3
# a comment

  0   0   0  Black
255 128   0
 50%  not a color line? no
`;

describe('GIMP palette parsing', () => {
  it('reads the header, names and unnamed colors', () => {
    const p = parseGimpPalette(GPL.split('\n').slice(0, 7).join('\n'), 'palettes/test.gpl');
    expect(p.name).toBe('Test palette');
    expect(p.columns).toBe(3);
    expect(p.id).toBe('palettes/test.gpl');
    const colors = p.colors.flatMap((c) => (c.kind === 'color' ? [c.color] : []));
    expect(colors.map((c) => c.getName())).toEqual(['Black', '#FF8000']);
    expect(colors.map((c) => c.toString(false))).toEqual(['#000000', '#ff8000']);
  });

  it('uses the file name without Name: and 1 column, and clamps columns', () => {
    const p = parseGimpPalette('GIMP Palette\n10 20 30 Blue\n', 'palettes/x.gpl');
    expect([p.name, p.columns]).toEqual(['x.gpl', 1]);
    expect(parseGimpPalette('GIMP Palette\nColumns: 5000\n', 'a').columns).toBe(1000);
  });

  it('refuses a wrong first line and an invalid line', () => {
    expect(() => parseGimpPalette('Not a palette\n', 'a')).toThrow('First line is wrong');
    expect(() => parseGimpPalette('GIMP Palette\nnonsense here\n', 'a')).toThrow(
      'Invalid line nonsense here',
    );
  });

  it('finds palettes by id first, then by name, sorted by name', () => {
    const globals = GlobalPalettes.get();
    globals.set([
      parseGimpPalette('GIMP Palette\nName: B\n', 'p/b.gpl'),
      parseGimpPalette('GIMP Palette\nName: A\n', 'p/a.gpl'),
    ]);
    expect(globals.palettes().map((p) => p.name)).toEqual(['A', 'B']);
    expect(globals.findPalette('A')?.id).toBe('p/a.gpl');
    expect(globals.findPalette('p/b.gpl')?.name).toBe('B');
    expect(globals.findPalette('C')).toBeUndefined();
  });
});

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect id="a" width="20" height="20" style="fill:#00ff00"/></svg>';

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const desktop = new SPDesktop(new Canvas(host), doc);
  doc.ensureUpToDate();
  const a = doc.getObjectById('a') as SPItem;
  desktop.getSelection().set(a);
  return { doc, desktop, a };
}

/** The swatch for the i-th color of palette. */
function swatchOf(palette: PaletteFileData, i: number) {
  const entry = palette.colors[i];
  if (entry?.kind !== 'color') throw new Error('no color');
  return colorItemOfColor(entry.color);
}

describe('swatches', () => {
  const palette = parseGimpPalette('GIMP Palette\n255 0 0 Red\n0 0 255 50% Gray\n', 'p.gpl');

  it('lists "none" first, then the colors, with ids from their names', () => {
    const cells = paletteCells(palette, null);
    const ids = cells.flatMap((c) => (c.kind === 'swatch' ? [c.item.id] : []));
    expect(ids).toEqual(['none', 'red', 'gray-50']);
    expect(colorItemKey(noneColorItem())).toBe('none');
  });

  it('click sets the fill, shift+click the stroke, each as one undo step', () => {
    const { doc, desktop, a } = setup();
    const red = swatchOf(palette, 0);
    setColorItem(desktop, red, false);
    expect(a.style.fill.getColor().toString(false)).toBe('#ff0000');
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Set fill color from swatch');
    setColorItem(desktop, red, true);
    expect(a.style.stroke.getColor().toString(false)).toBe('#ff0000');
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Set stroke color from swatch');
    setColorItem(desktop, noneColorItem(), false);
    expect(a.style.fill.isNone()).toBe(true);
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Set fill color to none');
  });

  it('marks the swatch of the current fill and stroke', () => {
    const { desktop } = setup();
    const red = swatchOf(palette, 0);
    // The rect has the green fill of its style, which is no swatch of the palette.
    expect(currentPaintKeys(desktop).fill).not.toBe(colorItemKey(red));
    setColorItem(desktop, red, false);
    expect(currentPaintKeys(desktop).fill).toBe(colorItemKey(red));
    setColorItem(desktop, noneColorItem(), true);
    expect(currentPaintKeys(desktop).stroke).toBe('none');
  });

  it('pins none, black, gray-50 and white by default; search hides groups', () => {
    expect(isPinned(noneColorItem(), '/embedded/swatches')).toBe(true);
    expect(swatchMatches({ key: 'g1', kind: 'group', name: 'x' }, 'x')).toBe(false);
    const cell = paletteCells(palette, null)[1];
    expect(cell && swatchMatches(cell, 'RED')).toBe(true);
    expect(cell && swatchMatches(cell, 'blue')).toBe(false);
  });
});
