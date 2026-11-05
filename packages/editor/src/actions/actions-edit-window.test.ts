// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-edit-window.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { ClipboardManager } from '../ui/clipboard.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';
import { output_signal } from './actions-helper.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path id="p" d="M0,0 L10,5"/></svg>';

function setup() {
  const s = setupDesktop(SVG, 'Select');
  const app = InkscapeApplication.instance();
  app.set_active_desktop(s.dt);
  return { ...s, app };
}

afterEach(() => {
  InkscapeApplication.instance().set_active_desktop(null);
  vi.restoreAllMocks();
});

describe('win.paste-on-page', () => {
  it('pastes in place, on the selected page', () => {
    const { app, dt } = setup();
    const paste = vi.spyOn(ClipboardManager.get(), 'paste').mockResolvedValue(false);
    expect(app.activate_action('win.paste')).toBe(true);
    expect(app.activate_action('win.paste-in-place')).toBe(true);
    expect(app.activate_action('win.paste-on-page')).toBe(true);
    expect(paste.mock.calls).toEqual([
      [dt, false, false],
      [dt, true, false],
      [dt, true, true],
    ]);
  });
});

describe('win.path-effect-parameter-next', () => {
  it('says when the selection has no path effect', () => {
    const { app, dt, item } = setup();
    dt.getSelection().set(item('p'));
    const lines: string[] = [];
    const off = output_signal.connect((l) => lines.push(l));
    expect(app.activate_action('win.path-effect-parameter-next')).toBe(true);
    off();
    expect(lines).toContain('The selection has no applied path effect.');
  });
});
