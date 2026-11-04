// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-canvas-transform.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('canvas zoom actions', () => {
  it('zoom relative multiplies the zoom and zoom absolute sets it', () => {
    const { dt } = setupDesktop(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"/>',
      'Select',
    );
    const app = InkscapeApplication.instance();
    app.set_active_desktop(dt);
    const z0 = dt.current_zoom();
    expect(app.activate_action('win.canvas-zoom-relative(2.0)')).toBe(true);
    expect(dt.current_zoom()).toBeCloseTo(2 * z0, 9);
    expect(app.activate_action('win.canvas-zoom-absolute(0.5)')).toBe(true);
    // The zoom correction preference scales "absolute" zoom to the real world; it is 1 by default.
    expect(dt.current_zoom()).toBeCloseTo(0.5, 9);
  });
});
