// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/text.cpp, src/display/control/canvas-item-text.cpp
// @vitest-environment happy-dom
import { DocumentUndo, Effect, type SPShape } from '@inkscape-web/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../../inkscape-application.ts';
import { setupDesktop, useWasmBackend } from '../../ui/tools/tool-test-utils.ts';

beforeAll(useWasmBackend);

const NS = 'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';
const PLAIN = `<svg xmlns="http://www.w3.org/2000/svg" ${NS} width="100" height="100"><defs/><path id="p" d="M 0,0 L 30,40"/></svg>`;
const WITH_LPE = `<svg xmlns="http://www.w3.org/2000/svg" ${NS} width="100" height="100"><defs><inkscape:path-effect id="e1" effect="path_length"/></defs><path id="p" d="M 0,0 L 30,40" inkscape:original-d="M 0,0 L 30,40" inkscape:path-effect="#e1"/></svg>`;

type Setup = ReturnType<typeof setupDesktop>;
const texts = (s: Setup) =>
  [...s.dt.getCanvasTemp().element.querySelectorAll('text')].map((t) => t.textContent);

describe('text of path effects on the canvas', () => {
  it('draws the text of an effect on the desktop of its own document', () => {
    const a = setupDesktop(PLAIN, 'Select');
    InkscapeApplication.instance().set_active_desktop(a.dt);
    // Document B opens while A is active; its label belongs on B's canvas.
    const b = setupDesktop(WITH_LPE, 'Select');
    b.doc.ensureUpToDate();
    expect(texts(b)).toEqual(['50.00 px']);
    expect(texts(a)).toEqual([]);
    InkscapeApplication.instance().set_active_desktop(null);
  });

  it('hides the text when the effect is removed from the item and shows it again on undo', () => {
    const s = setupDesktop(PLAIN, 'Select');
    const shape = s.item('p') as unknown as SPShape;
    Effect.createAndApply('path_length', s.doc, shape);
    s.doc.ensureUpToDate();
    DocumentUndo.done(s.doc, 'Apply effect', '');
    expect(texts(s)).toEqual(['50.00 px']);
    // The effect object stays in the defs after the removal.
    shape.removeAllPathEffects(false);
    s.doc.ensureUpToDate();
    DocumentUndo.done(s.doc, 'Remove effect', '');
    expect(texts(s)).toEqual([]);
    DocumentUndo.undo(s.doc);
    s.doc.ensureUpToDate();
    expect(texts(s)).toEqual(['50.00 px']);
  });
});
