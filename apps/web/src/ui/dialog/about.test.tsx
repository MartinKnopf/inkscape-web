// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AboutDialogHost, REPOSITORY_URL, show_about } from './about.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
beforeEach(() => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(AboutDialogHost)));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('AboutDialogHost', () => {
  it('shows the port note below a line, with the repository link, and closes on Escape', () => {
    act(() => show_about());
    const dialog = document.querySelector('.about-dialog')!;
    const note = dialog.querySelector('hr + p')!;
    expect(note.textContent).toContain('port of Inkscape');
    expect(note.querySelector(`a[href="${REPOSITORY_URL}"]`)).not.toBeNull();

    act(() => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.about-dialog')).toBeNull();
  });
});
