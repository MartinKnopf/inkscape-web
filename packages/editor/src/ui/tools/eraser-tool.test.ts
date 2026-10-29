// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/eraser-tool.cpp
// @vitest-environment happy-dom
import { Preferences, SPPath } from '@inkscape-web/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EraserTool } from './eraser-tool.ts';
import { line, mockHitTest, setupDesktop, stroke, unmockHitTest, useWasmBackend } from './tool-test-utils.ts';

await useWasmBackend();

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="layer1" inkscape:groupmode="layer">' +
  '<rect id="r" x="100" y="80" width="40" height="40"/><rect id="s" x="100" y="200" width="40" height="40"/>' +
  '</g></svg>';

/** A 10 px wide eraser without mass. */
const PREFS: Record<string, number> = { '/tools/eraser/width': 10, '/tools/eraser/mass': 0 };

function setup(mode: number) {
  const prefs = Preferences.get();
  for (const [p, v] of Object.entries(PREFS)) prefs.setDouble(p, v);
  prefs.setInt('/tools/eraser/mode', mode);
  const d = setupDesktop(SVG, 'Eraser');
  const layer = () => [...(d.doc.getObjectById('layer1')?.getRepr().children() ?? [])];
  return { ...d, layer };
}

beforeEach(() => mockHitTest());
afterEach(() => {
  unmockHitTest();
  for (const p of [...Object.keys(PREFS), '/tools/eraser/mode', '/tools/eraser/break_apart']) {
    Preferences.get().remove(p);
  }
});

describe('EraserTool', () => {
  it('cut mode cuts the stroke out of the shapes it touches', () => {
    const { doc, svg, layer, item, undoSteps } = setup(1);
    stroke(svg, line(60, 100, 200, 100));
    // The rect is a path of two parts now, in its place; the other rect is untouched; no eraser stroke is left.
    expect(layer().map((n) => n.name())).toEqual(['svg:path', 'svg:rect']);
    expect([...doc.getRoot().getRepr().children()].map((n) => n.name())).toEqual([
      'sodipodi:namedview',
      'svg:defs',
      'svg:g',
    ]);
    const path = doc.getObjectByRepr(layer()[0] ?? null) as SPPath;
    expect(path.curve()).toHaveLength(2);
    const b = path.documentGeometricBounds();
    expect([b?.top(), b?.bottom(), b?.left(), b?.right()]).toEqual([80, 120, 100, 140]);
    expect(item('s').getRepr().name()).toBe('svg:rect');
    expect(undoSteps()).toEqual(['Draw eraser stroke']);
  });

  it('with break apart, the cut pieces are separate paths', () => {
    const { svg, layer } = setup(1);
    Preferences.get().setBool('/tools/eraser/break_apart', true);
    stroke(svg, line(60, 100, 200, 100));
    expect(layer().map((n) => n.name())).toEqual(['svg:path', 'svg:path', 'svg:rect']);
  });

  it('with a selection, only the selected objects are erased and stay selected', () => {
    const { dt, svg, item, layer } = setup(1);
    dt.getSelection().set(item('s'));
    stroke(svg, line(60, 100, 200, 100));
    stroke(svg, line(60, 220, 200, 220));
    expect(layer().map((n) => n.name())).toEqual(['svg:rect', 'svg:path']);
    expect(
      dt
        .getSelection()
        .items()
        .map((i) => i.getRepr()),
    ).toEqual([layer()[1]]);
  });

  it('delete mode deletes the objects the pointer touches', () => {
    const { doc, dt, svg, layer, undoSteps } = setup(0);
    mockHitTest(doc, dt);
    stroke(svg, line(60, 100, 200, 100));
    expect(layer().map((n) => n.attribute('id'))).toEqual(['s']);
    expect(undoSteps()).toEqual(['Draw eraser stroke']);
  });

  it('clip mode clips the selected objects with the rest of their bounding box', () => {
    const { doc, dt, svg, item } = setup(2);
    dt.getSelection().set(item('r'));
    stroke(svg, line(60, 100, 200, 100));
    const clip = item('r').getClipObject();
    expect(clip).not.toBeNull();
    // The clip path is the bounding box minus the stroke: two parts.
    const clipPath = clip?.firstChild();
    expect(clipPath instanceof SPPath ? clipPath.curve() : null).toHaveLength(2);
    expect(dt.getSelection().items()).toEqual([item('r')]);
    expect(doc.getObjectById('s')?.getRepr().attribute('clip-path')).toBeNull();
  });

  it('an empty stroke (a click) does nothing', () => {
    const { doc, svg, layer } = setup(1);
    stroke(svg, [[120, 100]]);
    expect(layer()).toHaveLength(2);
    expect(doc.undoStack.undo).toHaveLength(0);
  });
});

describe('EraserTool._isStraightSegment', () => {
  it('detects paths of collinear lines, which have no area', () => {
    const { doc, item } = setupDesktop(
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="a" d="M 0,0 L 10,10 L 5,5"/><path id="b" d="M 0,0 L 10,10 L 10,0"/></svg>',
      'Select',
    );
    doc.ensureUpToDate();
    expect(EraserTool._isStraightSegment(item('a'))).toBe(true);
    expect(EraserTool._isStraightSegment(item('b'))).toBe(false);
  });
});
