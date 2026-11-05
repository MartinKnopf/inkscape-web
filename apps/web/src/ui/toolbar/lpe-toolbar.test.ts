// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/lpe-toolbar.cpp
// @vitest-environment happy-dom
import { EffectType, Preferences, SPDocument, type SPItem } from '@inkscape-web/core';
import {
  Canvas,
  type LpeTool,
  lpetool_mode_to_index,
  lpetool_type_is_available,
  SPDesktop,
  tool_switch,
} from '@inkscape-web/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { mode_changed, toggle_set_bbox } from './lpe-toolbar.tsx';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<path id="p" d="M 10,20 H 50 V 60"/></svg>';

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const dt = new SPDesktop(new Canvas(document.createElement('div')), doc);
  tool_switch('LPETool', dt);
  return { doc, dt, tool: dt.getTool() as LpeTool, path: doc.getObjectById('p') as SPItem };
}

const MIRROR = lpetool_mode_to_index(EffectType.MIRROR_SYMMETRY);
const mode = () => Preferences.get().getInt('/tools/lpetool/mode', -1);

afterEach(() => {
  const prefs = Preferences.get();
  for (const p of ['mode', 'bbox_upperleftx', 'bbox_upperlefty', 'bbox_lowerrightx', 'bbox_lowerrighty'])
    prefs.remove(`/tools/lpetool/${p}`);
});

describe('LPEToolbar', () => {
  it('switches to a subtool, or applies a construction without clicks to the selected path', () => {
    const { dt, tool, path } = setup();
    mode_changed(dt, MIRROR);
    expect([tool.lpe_mode, mode()]).toEqual([EffectType.MIRROR_SYMMETRY, MIRROR]);

    dt.getSelection().set(path);
    mode_changed(dt, MIRROR);
    expect(path.getAttribute('inkscape:path-effect')).toBeTruthy();
    expect([tool.lpe_mode, mode()]).toEqual([EffectType.INVALID_LPE, 0]);
  });

  it('ignores the subtools whose path effect is not ported', () => {
    const { dt, tool } = setup();
    const unported = [EffectType.LINE_SEGMENT, EffectType.CIRCLE_3PTS, EffectType.PARALLEL].find(
      (t) => !lpetool_type_is_available(t),
    );
    if (unported === undefined) return; // all ported: nothing to check
    mode_changed(dt, lpetool_mode_to_index(unported));
    expect([tool.lpe_mode, mode()]).toEqual([EffectType.INVALID_LPE, 0]);
  });

  it('sets the limiting bounding box to the selection', () => {
    const { dt, path } = setup();
    dt.getSelection().set(path);
    toggle_set_bbox(dt);
    const prefs = Preferences.get();
    expect(prefs.getDouble('/tools/lpetool/bbox_upperleftx')).toBe(10);
    expect(prefs.getDouble('/tools/lpetool/bbox_lowerrighty')).toBe(60);
  });
});
