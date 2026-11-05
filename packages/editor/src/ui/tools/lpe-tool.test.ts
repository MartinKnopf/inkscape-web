// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/lpe-tool.cpp, src/ui/tools/pen-tool.cpp
// @vitest-environment happy-dom
import { EffectType, Preferences, type SPItem } from '@inkscape-web/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type LpeTool,
  lpesubtools,
  lpetool_item_has_construction,
  lpetool_mode_to_index,
  lpetool_try_construction,
  lpetool_type_is_available,
} from './lpe-tool.ts';
import { key, pointer, setupDesktop, useWasmBackend } from './tool-test-utils.ts';

await useWasmBackend();

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="layer1" inkscape:groupmode="layer"><path id="p" d="M 0,0 H 30"/></g></svg>';

const MIRROR = lpetool_mode_to_index(EffectType.MIRROR_SYMMETRY);

function setup() {
  const t = setupDesktop(SVG, 'LPETool');
  const tool = t.dt.getTool() as LpeTool;
  const layer = () => [...(t.doc.getObjectById('layer1')?.getRepr().children() ?? [])];
  /** The effect key of the path effect of a repr. */
  const effect = (id: string | null | undefined) =>
    t.doc
      .getObjectById((id ?? '').replace(/^#/, ''))
      ?.getRepr()
      .attribute('effect');
  return { ...t, tool, layer, effect };
}

/** A click at (x, y). */
function click(svg: Element, x: number, y: number) {
  pointer(svg, 'pointermove', x, y, 0);
  pointer(svg, 'pointerdown', x, y, 1);
  pointer(svg, 'pointerup', x, y, 0);
}

// No layout in happy-dom: nothing is under the pointer.
beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(document, 'elementsFromPoint');
  Preferences.get().remove('/tools/lpetool/mode');
});

describe('lpesubtools', () => {
  it('has the upstream constructions; those without a ported path effect are not available', () => {
    expect(lpesubtools.map((s) => s.icon_name)).toEqual([
      'draw-geometry-inactive',
      'draw-geometry-line-segment',
      'draw-geometry-circle-from-three-points',
      'draw-geometry-circle-from-radius',
      'draw-geometry-line-parallel',
      'draw-geometry-line-perpendicular',
      'draw-geometry-angle-bisector',
      'draw-geometry-mirror',
    ]);
    expect(lpetool_type_is_available(EffectType.INVALID_LPE)).toBe(true);
    expect(lpetool_type_is_available(EffectType.MIRROR_SYMMETRY)).toBe(true);
    // Not a construction, and not in the registry.
    expect(lpetool_type_is_available(EffectType.DOEFFECTSTACK_TEST)).toBe(false);
  });
});

describe('LpeTool', () => {
  it('is inactive at start: a click clears the selection and draws nothing', () => {
    const { dt, svg, tool, layer, item } = setup();
    expect(tool.lpe_mode).toBe(EffectType.INVALID_LPE);
    expect(Preferences.get().getInt('/tools/lpetool/mode', -1)).toBe(0);
    dt.getSelection().set(item('p'));
    click(svg, 50, 50);
    expect(dt.getSelection().isEmpty()).toBe(true);
    expect(layer()).toHaveLength(1);
  });

  it('draws a path with the construction of the mode, then switches back to inactive', () => {
    const { svg, tool, layer, effect, undoSteps } = setup();
    Preferences.get().setInt('/tools/lpetool/mode', MIRROR);
    tool.lpe_mode = EffectType.MIRROR_SYMMETRY;
    click(svg, 50, 50);
    click(svg, 90, 50);
    key(svg, 'Enter');
    const path = layer()[1];
    expect(effect(path?.attribute('inkscape:path-effect'))).toBe('mirror_symmetry');
    expect(tool.lpe_mode).toBe(EffectType.INVALID_LPE);
    expect(Preferences.get().getInt('/tools/lpetool/mode', -1)).toBe(0);
    expect(undoSteps()).toEqual(['Draw path']);
  });

  it('a construction of n clicks finishes the path after the n-th click', () => {
    const { svg, tool, layer, effect } = setup();
    tool.waitForLPEMouseClicks(EffectType.MIRROR_SYMMETRY, 2);
    click(svg, 50, 50);
    expect(layer()).toHaveLength(1);
    click(svg, 90, 60);
    const path = layer()[1];
    expect(path?.attribute('inkscape:original-d')).toBe('M 50,50 90,60');
    expect(effect(path?.attribute('inkscape:path-effect'))).toBe('mirror_symmetry');
    expect(tool.hasWaitingLPE()).toBe(false);
  });

  it('shows the limiting bounding box and the length of the selected paths', () => {
    const { dt, tool, item } = setup();
    expect(tool.has_limiting_bbox()).toBe(true);
    dt.getSelection().set(item('p'));
    expect(dt.getCanvasTemp().element.querySelector('text')?.textContent).toBe('30.00 px');
  });
});

describe('lpetool_try_construction', () => {
  it('applies a construction without clicks to the selected path', () => {
    const { dt, item } = setup();
    expect(lpetool_try_construction(dt, EffectType.MIRROR_SYMMETRY)).toBe(false);
    dt.getSelection().set(item('p'));
    expect(lpetool_try_construction(dt, EffectType.CIRCLE_3PTS)).toBe(false);
    expect(lpetool_try_construction(dt, EffectType.MIRROR_SYMMETRY)).toBe(true);
    expect(lpetool_item_has_construction(item('p') as SPItem)).toBe(MIRROR);
  });
});
