// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-element-a.cpp
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100">' +
  '<a id="a" xlink:href="https://inkscape.org/"><rect id="r" width="10" height="10"/></a>' +
  '<a id="b" xlink:href="https://example.org/doc"><rect width="10" height="10"/></a>' +
  '<rect id="plain" width="5" height="5"/></svg>';

afterEach(() => {
  InkscapeApplication.instance().set_active_desktop(null);
  vi.restoreAllMocks();
});

describe('app.element-a-open-link', () => {
  it('opens the link of each selected anchor in a new tab and does not change the document', () => {
    const { dt, item, doc } = setupDesktop(SVG, 'Select');
    const app = InkscapeApplication.instance();
    app.set_active_desktop(dt);
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    dt.getSelection().setList([item('a'), item('b'), item('plain')]);
    expect(app.activate_action('app.element-a-open-link')).toBe(true);
    expect(open.mock.calls.map((c) => c[0])).toEqual(['https://inkscape.org/', 'https://example.org/doc']);
    expect(open.mock.calls[0]?.[1]).toBe('_blank');
    expect(doc.undoStack.undo).toHaveLength(0);
  });
});
