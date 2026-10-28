// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/rect-toolbar.cpp, src/ui/toolbar/arc-toolbar.cpp, src/ui/toolbar/star-toolbar.cpp, src/ui/toolbar/spiral-toolbar.cpp
// @vitest-environment happy-dom
import { Preferences, SPDocument, type SPItem } from '@inkscape-web/core';
import { Canvas, SPDesktop } from '@inkscape-web/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { arcValueChanged, startendValueChanged, typeChanged } from './arc-toolbar.tsx';
import { rectValueChanged } from './rect-toolbar.tsx';
import { spiralValueChanged } from './spiral-toolbar.tsx';
import { magnitude_value_changed, proportion_value_changed, side_mode_changed } from './star-toolbar.tsx';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="400" height="300">' +
  '<rect id="r" x="10" y="10" width="20" height="10"/>' +
  '<ellipse id="e" cx="50" cy="50" rx="20" ry="10"/>' +
  '<path id="s" sodipodi:type="star" sodipodi:sides="5" sodipodi:cx="100" sodipodi:cy="100" sodipodi:r1="20" sodipodi:r2="10" sodipodi:arg1="0" sodipodi:arg2="0.6283" d=""/>' +
  '<path id="p" sodipodi:type="spiral" sodipodi:cx="200" sodipodi:cy="100" sodipodi:expansion="1" sodipodi:revolution="3" sodipodi:radius="30" sodipodi:argument="0" sodipodi:t0="0" d=""/>' +
  '</svg>';

/** A desktop with the object id selected. */
function setup(id: string) {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  const dt = new SPDesktop(new Canvas(host), doc);
  const item = doc.getObjectById(id) as SPItem;
  dt.getSelection().set(item);
  const attr = (name: string) => item.getRepr().attribute(name);
  const undoSteps = () => doc.undoStack.undo.map((e) => e.description);
  return { dt, attr, undoSteps };
}

const PREFS = [
  '/tools/shapes/rect/width',
  '/tools/shapes/arc/rx',
  '/tools/shapes/arc/start',
  '/tools/shapes/arc/end',
  '/tools/shapes/arc/arc_type',
  '/tools/shapes/star/magnitude',
  '/tools/shapes/star/proportion',
  '/tools/shapes/star/isflatsided',
  '/tools/shapes/spiral/revolution',
];
afterEach(() => {
  for (const p of PREFS) Preferences.get().remove(p);
});

describe('RectToolbar', () => {
  it('sets the width of the selected rect and the preference, merging repeated edits into one step', () => {
    const { dt, attr, undoSteps } = setup('r');
    rectValueChanged(dt, 'width', 50);
    rectValueChanged(dt, 'width', 60);
    expect(attr('width')).toBe('60');
    expect(Preferences.get().getDouble('/tools/shapes/rect/width')).toBe(60);
    expect(undoSteps()).toEqual(['Change rectangle']);
  });
});

describe('ArcToolbar', () => {
  it('changes the radius, start/end angles and arc type of the selected ellipse', () => {
    const { dt, attr, undoSteps } = setup('e');
    arcValueChanged(dt, 'rx', 30);
    expect(attr('rx')).toBe('30');
    startendValueChanged(dt, 'start', 90);
    expect(attr('sodipodi:type')).toBe('arc');
    expect(Number(attr('sodipodi:start'))).toBeCloseTo(Math.PI / 2);
    typeChanged(dt, 1);
    expect([attr('sodipodi:arc-type'), attr('sodipodi:open')]).toEqual(['arc', 'true']);
    expect(undoSteps()).toEqual(['Ellipse: Change radius', 'Arc: Change start/end', 'Arc: Change arc type']);
  });
});

describe('StarToolbar', () => {
  it('changes the corners, the spoke ratio and makes a polygon', () => {
    const { dt, attr, undoSteps } = setup('s');
    magnitude_value_changed(dt, 7);
    expect(attr('sodipodi:sides')).toBe('7');
    expect(Number(attr('sodipodi:arg2'))).toBeCloseTo(Math.PI / 7);
    proportion_value_changed(dt, 0.25);
    expect(attr('sodipodi:r2')).toBe('5');
    side_mode_changed(dt, true, 7);
    expect(attr('inkscape:flatsided')).toBe('true');
    expect(undoSteps()).toEqual([
      'Star: Change number of corners',
      'Star: Change spoke ratio',
      'Make polygon',
    ]);
  });
});

describe('SpiralToolbar', () => {
  it('changes the turns of the selected spiral', () => {
    const { dt, attr, undoSteps } = setup('p');
    spiralValueChanged(dt, 'revolution', 5);
    expect(attr('sodipodi:revolution')).toBe('5');
    expect(undoSteps()).toEqual(['Change spiral']);
  });
});
