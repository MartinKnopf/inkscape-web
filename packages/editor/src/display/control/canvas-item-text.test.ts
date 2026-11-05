// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/text.cpp, src/display/control/canvas-item-text.cpp
// @vitest-environment happy-dom
import { Effect, type SPShape } from '@inkscape-web/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../../inkscape-application.ts';
import { setupDesktop, useWasmBackend } from '../../ui/tools/tool-test-utils.ts';

beforeAll(useWasmBackend);
afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('text of path effects on the canvas', () => {
  it('draws the Path length text and removes it with the effect object', () => {
    const s = setupDesktop(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="100"><defs/><path id="p" d="M 0,0 L 30,40"/></svg>',
      'Select',
    );
    InkscapeApplication.instance().set_active_desktop(s.dt);
    const texts = () =>
      [...s.dt.getCanvasTemp().element.querySelectorAll('text')].map((t) => t.textContent);
    const shape = s.item('p') as unknown as SPShape;
    Effect.createAndApply('path_length', s.doc, shape);
    s.doc.ensureUpToDate();
    expect(texts()).toEqual(['50.00 px']);
    const lpe_id = shape.getCurrentLPE()?.getRepr().attribute('id') ?? '';
    shape.removeAllPathEffects(false);
    // The effect object stays in the defs until it is deleted.
    s.doc.getObjectById(lpe_id)?.deleteObject();
    s.doc.ensureUpToDate();
    expect(texts()).toEqual([]);
  });
});
