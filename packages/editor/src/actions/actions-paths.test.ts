// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-paths.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('win.path-reverse', () => {
  it('reverses the path and its node types, with one undo step', () => {
    const { dt, item, undoSteps } = setupDesktop(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="400" height="300">' +
        '<path id="p" d="M 0,0 L 10,0 L 10,10" sodipodi:nodetypes="ccs"/></svg>',
      'Select',
    );
    const app = InkscapeApplication.instance();
    app.set_active_desktop(dt);
    dt.getSelection().set(item('p'));
    expect(app.activate_action('win.path-reverse')).toBe(true);
    expect(item('p').getAttribute('d')).toBe('M 10,10 V 0 H 0');
    expect(item('p').getAttribute('sodipodi:nodetypes')).toBe('scc');
    expect(undoSteps()).toEqual(['Reverse path']);
  });
});
