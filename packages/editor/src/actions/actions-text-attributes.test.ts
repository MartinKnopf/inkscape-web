// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-text-attributes.cpp
// @vitest-environment happy-dom
import type { SPText } from '@inkscape-web/core';
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';
import { text_decoration_line_set } from './actions-text-attributes.ts';

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('text decoration actions', () => {
  it('toggle the lines of text-decoration-line of the selection, with one merged undo step', () => {
    const s = setupDesktop(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><text id="t" x="10" y="50">Hi</text></svg>',
      'Select',
    );
    const app = InkscapeApplication.instance();
    app.set_active_desktop(s.dt);
    const text = s.item('t') as SPText;
    s.dt.getSelection().set(text);
    text_decoration_line_set(app, text.style);

    app.activate_action('win.text-decoration-line-underline');
    app.activate_action('win.text-decoration-line-overline');
    expect(text.style.text_decoration_line.write()).toBe('text-decoration-line:underline overline;');
    expect(app.actions.lookup_action('win.text-decoration-line-underline')?.get_state()).toBe(true);

    app.activate_action('win.text-decoration-line-underline');
    app.activate_action('win.text-decoration-line-overline');
    expect(text.getRepr().attribute('style')).toContain('text-decoration-line:none');
    expect(s.undoSteps()).toEqual(['Text: Change text-decoration']);
  });
});
