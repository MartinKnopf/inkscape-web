// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-transform.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect id="r" x="10" y="20" width="40" height="20" transform="rotate(10)"/></svg>';

function setup() {
  const s = setupDesktop(SVG, 'Select');
  s.dt.getSelection().set(s.item('r'));
  const app = InkscapeApplication.instance();
  app.set_active_desktop(s.dt);
  const run = (a: string) => expect(app.activate_action(a)).toBe(true);
  return { ...s, run };
}

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('transform actions', () => {
  it('translates by "dx,dy" and rejects other input', () => {
    const { item, run, undoSteps } = setup();
    const before = item('r').desktopVisualBounds();
    run('app.transform-translate("5,7")');
    const after = item('r').desktopVisualBounds();
    expect(after?.left()).toBeCloseTo((before?.left() ?? 0) + 5, 6);
    expect(after?.top()).toBeCloseTo((before?.top() ?? 0) + 7, 6);
    expect(undoSteps()).toEqual(['Move']);
    run('app.transform-translate("1")'); // invalid: ignored
    expect(item('r').desktopVisualBounds()?.left()).toBeCloseTo((before?.left() ?? 0) + 5, 6);
  });

  it('scales by a factor and grows by pixels', () => {
    const { item, run } = setup();
    const w0 = item('r').desktopVisualBounds()?.width() ?? 0;
    run('app.transform-scale(2.0)');
    expect(item('r').desktopVisualBounds()?.width()).toBeCloseTo(2 * w0, 6);
    const big = item('r').desktopVisualBounds();
    const side = Math.max(big?.width() ?? 0, big?.height() ?? 0);
    run('app.transform-grow(10.0)');
    const grown = item('r').desktopVisualBounds();
    expect(Math.max(grown?.width() ?? 0, grown?.height() ?? 0)).toBeCloseTo(side + 10, 6);
  });

  it('removes the transform attribute with one undo step', () => {
    const { item, run, undoSteps } = setup();
    run('app.transform-remove');
    expect(item('r').getAttribute('transform')).toBeNull();
    expect(undoSteps()).toEqual(['Remove transform']);
  });

  it('rotates the page by 90 degree steps', () => {
    const { doc, run } = setup();
    run('app.page-rotate(1)');
    expect(doc.getDimensions().x).toBe(300);
  });
});
